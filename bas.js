/*
 * Clubhouse IQ: everything else on the BAS.
 *
 * The plant gateway's BAS scanner (gateway/ciq_bas_scan.py) walks every
 * BACnet device it can see and posts each device's objects (type, instance,
 * name, present value, units) to /api/plant/bas. This module:
 *   - keeps the latest value of every object on every device (bas_points)
 *   - knows the club's equipment (fan coils, exhaust fans, walk-ins, zones)
 *     and which BAS device each one lives on
 *   - maps device objects to roles (space temp, valve, fan status...) by
 *     object name, with manager overrides (bas_map)
 *   - writes mapped values into plant_readings so they trend and alarm
 *     like the plant points
 *
 * Device numbers come from Compass (bas-zone-findings, todo 10/29, gateway
 * notes). verify:true marks a number inferred from the numbering pattern
 * and not yet seen on its Compass page.
 */
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS bas_devices (
  dev       INTEGER PRIMARY KEY,
  name      TEXT DEFAULT '',
  model     TEXT DEFAULT '',
  vendor    TEXT DEFAULT '',
  address   TEXT DEFAULT '',
  points    INTEGER DEFAULT 0,
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS bas_points (
  dev    INTEGER NOT NULL,
  obj    TEXT NOT NULL,
  name   TEXT DEFAULT '',
  value  REAL,
  text   TEXT,
  units  TEXT DEFAULT '',
  ts     TEXT,
  PRIMARY KEY (dev, obj)
);
CREATE TABLE IF NOT EXISTS bas_map (
  eid   TEXT NOT NULL,
  role  TEXT NOT NULL,
  dev   INTEGER,
  obj   TEXT,
  by    TEXT,
  at    TEXT,
  PRIMARY KEY (eid, role)
);
`);

const iso = d => (d || new Date()).toISOString();
const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
const f1 = v => v == null ? '?' : (+v).toFixed(1);
const STALE_MIN = 15;

/* ---------------- roles by kind ---------------- */
const ROLES = {
  fcu: [
    ['occ', 'Occupied', ''], ['fan_cmd', 'Fan command', ''], ['fan_status', 'Fan status', ''],
    ['space_sp', 'Space setpoint', '°F'], ['space', 'Space temp', '°F'], ['sat', 'Supply air', '°F'],
    ['chw_vlv', 'CHW valve', '%'], ['hw_vlv', 'HW valve', '%'], ['rh', 'Space humidity', '%']
  ],
  ef: [['cmd', 'Fan command', ''], ['status', 'Fan status', ''], ['temp', 'Room temp', '°F']],
  ref: [['temp', 'Box temp', '°F'], ['sp', 'Setpoint', '°F']],
  zone: [
    ['occ', 'Occupied', ''], ['space_sp', 'Space setpoint', '°F'], ['space', 'Space temp', '°F'],
    ['sat', 'Supply air', '°F'], ['damper', 'Damper (% hot)', '%'], ['htg', 'Heating signal', '%'], ['clg', 'Cooling signal', '%']
  ]
};
ROLES.other = ROLES.zone;
// Name patterns. Order matters: setpoints are claimed before the temps they resemble.
const NOT_VALUE = /set\s*point|stpt|\bsp\b|offset|limit|alarm|\bhi\b|\blo\b|min|max|delay|reset|deadband|runtime|run time|hours/i;
const PAT = {
  occ: { re: /\bocc(upied|upancy)?\b|command mode|system mode/i, types: ['BV', 'BI', 'MSV'], not: /set\s*point|stpt|offset|\bsp\b/i },
  fan_cmd: { re: /fan.*(cmd|command|start|enable|s\/s)|\bsf\b.*(cmd|c\/s)/i, types: ['BO', 'BV'] },
  fan_status: { re: /fan.*(status|sts|proof|proven)|\bsf\b.*(sts|status)/i, types: ['BI', 'BV'] },
  cmd: { re: /(cmd|command|start|enable|s\/s)/i, types: ['BO', 'BV'] },
  status: { re: /(status|sts|proof|proven)/i, types: ['BI', 'BV'] },
  space_sp: { re: /(space|zone|room|occ|eff|active).*(set\s*point|stpt|\bsp\b)|^(set\s*point|stpt)$/i, types: ['AV'] },
  sp: { re: /set\s*point|stpt|\bsp\b/i, types: ['AV'] },
  space: { re: /space\s*t|zone\s*t|room\s*t|\bspace\b|\bznt\b|wall sensor/i, types: ['AI', 'AV'], value: true },
  sat: { re: /(supply|discharge|leaving)\s*(air)?\s*t|\bsat\b|\bdat\b|\bsa\s*temp/i, types: ['AI', 'AV'], value: true },
  temp: { re: /temp|freezer|cooler|\bbox\b/i, types: ['AI', 'AV'], value: true },
  chw_vlv: { re: /(chw|chilled|cool(ing)?|clg).*(valve|vlv)/i, types: ['AO', 'AV'] },
  hw_vlv: { re: /(hw|hot water|heat(ing)?|htg|reheat).*(valve|vlv)/i, types: ['AO', 'AV'] },
  rh: { re: /humid|\brh\b/i, types: ['AI', 'AV'], value: true },
  damper: { re: /damper|dmpr/i, types: ['AO', 'AV'] },
  htg: { re: /(heat(ing)?|htg).*(signal|demand|%)/i, types: ['AV'] },
  clg: { re: /(cool(ing)?|clg).*(signal|demand|%)/i, types: ['AV'] }
};

/* ---------------- the club's BAS equipment ---------------- */
const fcu = (n, dev, name, building, verify) => ({ id: `fcu.${dev}`, kind: 'fcu', dev, tag: `FCU-${n}`, name, building, verify: !!verify });
const EQUIP = [
  fcu(1, 201081, 'Youth Center', 'Family & Teen Center', true),
  fcu(2, 201082, 'Laundry', 'Fitness Center', true),
  fcu(3, 201083, 'Pool Side Cafe', 'Pool Pavilion', true),
  fcu(4, 201084, 'Pastry', 'Clubhouse'),
  fcu(5, 201085, 'Commons Entry', 'Fitness Center', true),
  fcu(6, 201086, 'West Studio', 'Fitness Center'),
  fcu(7, 201087, 'Main Gym', 'Fitness Center'),
  fcu(8, 201088, 'Gym Office', 'Fitness Center'),
  fcu(9, 201089, 'Gym North Studio', 'Fitness Center', true),
  fcu(10, 101090, 'Pool Kitchen', 'Pool Pavilion', true),
  fcu(11, 101091, 'Main Grill Kitchen', 'Clubhouse'),
  fcu(12, 101092, 'Main Grill Kitchen', 'Clubhouse', true),
  fcu(13, 101093, 'Main Grill Kitchen', 'Clubhouse'),
  // Exhaust fans. EF-7 to EF-11 share the New Wing controller 201099; the
  // rest are found by name on whatever device carries them.
  { id: 'ef.201099-7', kind: 'ef', dev: 201099, match: /\bEF[\s-]*0?7\b/i, tag: 'EF-7', name: "Men's Locker Room", building: 'Clubhouse' },
  { id: 'ef.201099-8', kind: 'ef', dev: 201099, match: /\bEF[\s-]*0?8\b/i, tag: 'EF-8', name: 'New wing exhaust', building: 'Clubhouse' },
  { id: 'ef.201099-9', kind: 'ef', dev: 201099, match: /\bEF[\s-]*0?9\b/i, tag: 'EF-9', name: 'Restrooms', building: 'Clubhouse' },
  { id: 'ef.201099-10', kind: 'ef', dev: 201099, match: /\bEF[\s-]*10\b/i, tag: 'EF-10', name: 'New wing exhaust', building: 'Clubhouse' },
  { id: 'ef.201099-11', kind: 'ef', dev: 201099, match: /\bEF[\s-]*11\b/i, tag: 'EF-11', name: 'New wing exhaust', building: 'Clubhouse' },
  { id: 'ef.any-5', kind: 'ef', dev: null, match: /\bEF[\s-]*0?5\b/i, tag: 'EF-5', name: 'Restrooms (attic, Greenheck SQ-130)', building: 'Clubhouse' },
  { id: 'ef.any-6', kind: 'ef', dev: null, match: /\bEF[\s-]*0?6\b/i, tag: 'EF-6', name: 'Exhaust', building: 'Clubhouse' },
  { id: 'ef.any-12', kind: 'ef', dev: null, match: /\bEF[\s-]*12\b|dryer/i, tag: 'EF-12', name: 'Dryer booster', building: 'Fitness Center' },
  { id: 'ef.120-mech', kind: 'ef', dev: 120, tag: 'EF-MR', name: 'Mechanical room exhaust', building: 'Central Plant', fixed: { temp: 'AI 2009', cmd: 'BO 2009' } },
  // Refrigeration temps that ride on AHU controllers (Compass walk-in display).
  { id: 'ref.101105-8', kind: 'ref', dev: 101105, tag: 'WI-FRZ', name: 'Lower level walk-in freezer', building: 'Clubhouse', fixed: { temp: 'AI 8' }, hi: 10 },
  { id: 'ref.101105-9', kind: 'ref', dev: 101105, tag: 'WI-CLR', name: 'Lower level walk-in cooler', building: 'Clubhouse', fixed: { temp: 'AI 9' }, hi: 41 },
  { id: 'ref.101105-10', kind: 'ref', dev: 101105, tag: 'WI-BEER', name: 'Beer cooler', building: 'Clubhouse', fixed: { temp: 'AI 10' }, hi: 41 },
  { id: 'ref.101107-8', kind: 'ref', dev: 101107, tag: 'REF-2', name: 'Main kitchen refrigerator ("Freezer 2" on the BAS)', building: 'Clubhouse', fixed: { temp: 'AI 8' }, hi: 41 },
  // Zones with known device numbers. Other zone controllers show up from the scan.
  { id: 'zone.101031', kind: 'zone', dev: 101031, tag: 'Z-5-1', name: 'Vegetable Prep (AHU-5 zone 1)', building: 'Clubhouse' },
  { id: 'zone.101032', kind: 'zone', dev: 101032, tag: 'Z-5-2', name: "Ladies' Locker Room (AHU-5 zone 2)", building: 'Clubhouse' }
];
// Devices the plant monitor already reads point by point; the scanner skips
// their bulk object lists. AHU controllers are read by ahu.<dev> mapping.
const PLANT_DEVS = new Set([120, 5001, 505002]);
const AHU_DEVS = new Set([101101, 101102, 101103, 101104, 101105, 101106, 101107, 101109, 101110, 101111, 201101]);

/* AHU point names on the Alerton AZ60 pages -> plant.js ahu.<dev>.<key> */
const AHU_PAT = [
  ['occ', /^(?!.*(set\s*point|stpt|offset)).*(\bocc(upied)?\b|system mode)/i, ['BV', 'BI', 'MSV']],
  ['fan_cmd', /supply fan.*(cmd|command|start|enable)|\bsf\b.*(cmd|enable)/i, ['BO', 'BV']],
  ['fan_status', /supply fan.*(status|proof)|\bsf\b.*(sts|status)/i, ['BI', 'BV']],
  ['cd_sp', /cold deck.*(set\s*point|stpt|sp)|supply.*(set\s*point|stpt)|clg.*sat.*sp|current supply temp.*\bsp\b/i, ['AV']],
  ['hd_sp', /hot deck.*(set\s*point|stpt|sp)/i, ['AV']],
  ['cd', /cold deck|supply air t|discharge air t|\bsat\b|\bdat\b/i, ['AI', 'AV'], true],
  ['hd', /hot deck/i, ['AI', 'AV'], true],
  ['mat', /mixed air|\bmat\b/i, ['AI', 'AV'], true],
  ['chw_vlv', /(chw|chilled|cool(ing)?).*(valve|vlv)/i, ['AO', 'AV']],
  ['hw_vlv', /(hw|hot water|heat(ing)?|reheat).*(valve|vlv)/i, ['AO', 'AV']],
  ['oa_dmp', /(oa|osa|outside air).*damper/i, ['AO', 'AV']],
  ['chw_req', /chilled water req|chw req|needs chilled/i, ['BV', 'BI']],
  ['space', /space\s*t|return air t|\brat\b/i, ['AI', 'AV'], true],
  ['sf_hours', /(sf|fan).*(runtime|run time|hours)/i, ['AV']],
  ['filter_dp', /filter.*(dp|press|diff)/i, ['AI', 'AV']]
];

/* ---------------- discovered devices -> equipment ---------------- */
function guessKind(dev, name, pts) {
  const n = (name || '').toLowerCase();
  if (/fcu|fan coil/.test(n)) return 'fcu';
  if (/\bef\b|exhaust/.test(n)) return 'ef';
  if (/freez|cooler|walk/.test(n)) return 'ref';
  if (pts.some(p => /damper/i.test(p.name)) && pts.some(p => /space|zone|room/i.test(p.name))) return 'zone';
  return 'other';
}
function allEquip() {
  const known = new Set(EQUIP.filter(e => e.dev).map(e => e.dev));
  const out = EQUIP.slice();
  const devs = db.prepare('SELECT * FROM bas_devices ORDER BY dev').all();
  for (const d of devs) {
    if (known.has(d.dev) || PLANT_DEVS.has(d.dev) || AHU_DEVS.has(d.dev)) continue;
    const pts = db.prepare('SELECT obj, name FROM bas_points WHERE dev=?').all(d.dev);
    const kind = guessKind(d.dev, d.name, pts);
    out.push({ id: `dev.${d.dev}`, kind, dev: d.dev, tag: d.name || `Dev ${d.dev}`, name: d.model || 'Found on the BAS', building: '', discovered: true });
  }
  return out;
}

/* ---------------- mapping ---------------- */
function mapEquip(e, ptsByDev, overrides) {
  const roles = (ROLES[e.kind] || ROLES.other).map(r => r[0]);
  const m = {};
  const ov = overrides[e.id] || {};
  for (const role of roles) if (ov[role]) m[role] = ov[role];
  if (e.fixed) for (const [role, obj] of Object.entries(e.fixed)) if (!m[role]) m[role] = { dev: e.dev, obj };
  // candidate objects
  let cands = [];
  if (e.dev != null) cands = (ptsByDev[e.dev] || []).map(p => Object.assign({ dev: e.dev }, p));
  else if (e.match) for (const [d, pts] of Object.entries(ptsByDev)) for (const p of pts) if (e.match.test(p.name)) cands.push(Object.assign({ dev: +d }, p));
  if (e.match && e.dev != null) cands = cands.filter(p => e.match.test(p.name));
  if (e.fixed && !e.match && Object.keys(e.fixed).length) cands = []; // fixed-object entries don't guess
  const used = new Set(Object.values(m).map(x => x.dev + ':' + x.obj));
  for (const role of roles) {
    if (m[role]) continue;
    const pat = PAT[role]; if (!pat) continue;
    const hit = cands.find(p => !used.has(p.dev + ':' + p.obj) && pat.types.includes(p.obj.split(' ')[0]) && pat.re.test(p.name) && !(pat.not && pat.not.test(p.name)) && !(pat.value && NOT_VALUE.test(p.name)));
    if (hit) { m[role] = { dev: hit.dev, obj: hit.obj, auto: true }; used.add(hit.dev + ':' + hit.obj); }
  }
  return m;
}
function mapAhu(dev, pts) {
  const m = {}, used = new Set();
  for (const [key, re, types, isVal] of AHU_PAT) {
    const hit = pts.find(p => !used.has(p.obj) && types.includes(p.obj.split(' ')[0]) && re.test(p.name) && !(isVal && NOT_VALUE.test(p.name)));
    if (hit) { m[key] = hit.obj; used.add(hit.obj); }
  }
  return m;
}
function overridesAll() {
  const o = {};
  for (const r of db.prepare('SELECT * FROM bas_map').all()) (o[r.eid] = o[r.eid] || {})[r.role] = r.obj ? { dev: r.dev, obj: r.obj, manual: true } : null;
  return o;
}

/* ---------------- ingest ---------------- */
const OBJ_RE = /^(AI|AO|AV|BI|BO|BV|MSV|MSI|MSO)\s+\d+$/;
function ingest(body) {
  const devices = Array.isArray(body.devices) ? body.devices : [];
  if (!devices.length || devices.length > 300) throw new Error('Send 1 to 300 devices');
  const now = iso();
  const tsOf = t => t && !isNaN(Date.parse(t)) ? iso(new Date(t)) : now;
  const upDev = db.prepare(`INSERT INTO bas_devices (dev, name, model, vendor, address, points, last_seen) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(dev) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''),name), model=COALESCE(NULLIF(excluded.model,''),model),
    vendor=COALESCE(NULLIF(excluded.vendor,''),vendor), address=COALESCE(NULLIF(excluded.address,''),address), points=excluded.points, last_seen=excluded.last_seen`);
  const upPt = db.prepare(`INSERT INTO bas_points (dev, obj, name, value, text, units, ts) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(dev, obj) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''),name), value=excluded.value, text=excluded.text,
    units=COALESCE(NULLIF(excluded.units,''),units), ts=excluded.ts`);
  let n = 0;
  const touched = new Set();
  db.transaction(() => {
    for (const d of devices) {
      const dev = parseInt(d.dev, 10); if (!(dev >= 0 && dev < 4194303)) continue;
      const pts = Array.isArray(d.points) ? d.points.slice(0, 5000) : [];
      const t = tsOf(d.ts || body.ts);
      for (const p of pts) {
        const [obj, name, value, units] = Array.isArray(p) ? p : [p.obj, p.name, p.value, p.units];
        if (!OBJ_RE.test(String(obj || ''))) continue;
        const v = typeof value === 'boolean' ? (value ? 1 : 0) : num(value);
        const txt = v == null && value != null ? String(value).slice(0, 60) : null;
        upPt.run(dev, String(obj), String(name || '').slice(0, 80), v, txt, String(units || '').slice(0, 24), t); n++;
      }
      const cnt = db.prepare('SELECT COUNT(*) c FROM bas_points WHERE dev=?').get(dev).c;
      upDev.run(dev, String(d.name || '').slice(0, 80), String(d.model || '').slice(0, 80), String(d.vendor || '').slice(0, 60), String(d.address || '').slice(0, 60), cnt, t);
      touched.add(dev);
    }
  })();
  const mapped = writeReadings(touched);
  return { devices: touched.size, points: n, readings: mapped };
}
function pointsByDev(devs) {
  const out = {};
  const rows = devs ? db.prepare(`SELECT * FROM bas_points WHERE dev IN (${[...devs].map(() => '?').join(',')})`).all(...devs) : db.prepare('SELECT * FROM bas_points').all();
  for (const r of rows) (out[r.dev] = out[r.dev] || []).push(r);
  return out;
}
// Copy mapped values into plant_readings (trends + alarms).
function writeReadings(touched) {
  if (!touched.size) return 0;
  const byDev = pointsByDev();
  const ov = overridesAll();
  const ins = db.prepare('INSERT INTO plant_readings (ts, key, value, text) VALUES (?,?,?,?)');
  let n = 0;
  db.transaction(() => {
    for (const e of allEquip()) {
      const m = mapEquip(e, byDev, ov);
      for (const [role, ref] of Object.entries(m)) {
        if (!ref || !touched.has(ref.dev)) continue;
        const p = (byDev[ref.dev] || []).find(x => x.obj === ref.obj); if (!p || p.value == null) continue;
        ins.run(p.ts || iso(), `${e.id}.${role}`, p.value, null); n++;
      }
    }
    for (const dev of touched) {
      if (!AHU_DEVS.has(dev)) continue;
      const pts = byDev[dev] || [], am = mapAhu(dev, pts), o = ov['ahu.' + dev] || {};
      for (const [key, obj] of Object.entries(am)) {
        const use = o[key] ? o[key].obj : obj;
        const p = pts.find(x => x.obj === use); if (!p || p.value == null) continue;
        ins.run(p.ts || iso(), `ahu.${dev}.${key}`, p.value, null); n++;
      }
    }
  })();
  return n;
}

/* ---------------- views ---------------- */
const KEY_RE = /^(fcu|ef|ref|zone|dev)\.[\w-]+\.\w+$/;
function validKey(k) { return KEY_RE.test(k); }
function equipment(v) {
  v = v || {};
  return allEquip().map(e => {
    const roles = ROLES[e.kind] || ROLES.other, x = {}; let ts = '';
    roles.forEach(([r]) => { const rd = v[`${e.id}.${r}`]; x[r] = rd ? num(rd.value) : null; if (rd && rd.ts > ts) ts = rd.ts; });
    return { id: e.id, kind: e.kind, dev: e.dev, tag: e.tag, name: e.name, building: e.building, verify: !!e.verify, discovered: !!e.discovered, hi: e.hi || null, values: x, ts: ts || null };
  });
}
function hits(v) {
  const out = [], now = Date.now();
  for (const e of equipment(v)) {
    if (!e.ts || now - Date.parse(e.ts) > STALE_MIN * 60000) continue;
    const x = e.values, add = (r, level, title, detail) => out.push({ id: `${e.id}.${r}`, level, eq: e.tag, title, detail });
    const sensorBad = t => t != null && (t < 10 || t > 120);
    if (e.kind === 'fcu' || e.kind === 'zone') {
      if (x.fan_cmd === 1 && x.fan_status === 0) add('fan', 'critical', `${e.tag} fan commanded on but not running`, `${e.name}. Fan status off with the command on.`);
      if (sensorBad(x.space)) add('sensor', 'warn', `${e.tag} space sensor reads ${f1(x.space)}°F`, `${e.name}. A reading like this is a failed or open wall sensor, not the room.`);
      else if (x.space != null && x.space_sp != null && Math.abs(x.space - x.space_sp) > 5 && x.occ !== 0)
        add('temp', 'warn', `${e.tag} space ${Math.round(Math.abs(x.space - x.space_sp))}°F ${x.space > x.space_sp ? 'over' : 'under'} setpoint`, `${e.name}: ${f1(x.space)}°F against ${f1(x.space_sp)}°F.`);
      if (x.chw_vlv >= 95 && x.sat != null && x.sat > 62 && x.fan_status !== 0) add('nocool', 'warn', `${e.tag} CHW valve wide open, supply ${f1(x.sat)}°F`, `${e.name}. The coil isn't cooling: check CHW flow, isolation valves, actuator, or an override holding the valve.`);
    }
    if (e.kind === 'ef' && x.cmd === 1 && x.status === 0) add('fan', 'warn', `${e.tag} commanded on but not proven`, `${e.name}. Fan status off with the command on.`);
    if (e.kind === 'ref' && x.temp != null && e.hi != null) {
      if (sensorBad(x.temp) && x.temp > 120) add('sensor', 'warn', `${e.tag} sensor reads ${f1(x.temp)}°F`, `${e.name}. Check the sensor.`);
      else if (x.temp > e.hi + 10) add('hot', 'critical', `${e.tag} at ${f1(x.temp)}°F`, `${e.name} is ${Math.round(x.temp - e.hi)}°F over its ${e.hi}°F limit. Check the box and move product if it's real.`);
      else if (x.temp > e.hi) add('hot', 'warn', `${e.tag} at ${f1(x.temp)}°F`, `${e.name} is over its ${e.hi}°F limit. Could be defrost; check again in 30 minutes.`);
    }
  }
  return out;
}

/* ---------------- routes ---------------- */
function mount(app, auth, { keyOk, evaluate, prune }) {
  const canSee = req => req.user.role !== 'staff';
  const isMgr = req => ['admin', 'manager'].includes(req.user.role);

  app.post('/api/plant/bas', (req, res) => {
    if (!keyOk(req)) return res.status(401).json({ error: 'Bad or missing plant key' });
    try { const r = ingest(req.body || {}); evaluate(); prune(); res.json(Object.assign({ ok: true }, r)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/plant/bas', auth, (req, res) => {
    if (!canSee(req)) return res.status(403).json({ error: 'Not available for department staff' });
    const devs = db.prepare('SELECT * FROM bas_devices ORDER BY dev').all();
    res.json({ devices: devs, roles: ROLES, known: EQUIP.map(e => ({ id: e.id, dev: e.dev, tag: e.tag, verify: !!e.verify })) });
  });
  app.get('/api/plant/bas/:dev', auth, (req, res) => {
    if (!canSee(req)) return res.status(403).json({ error: 'Not available for department staff' });
    const dev = parseInt(req.params.dev, 10);
    res.json({ device: db.prepare('SELECT * FROM bas_devices WHERE dev=?').get(dev) || null,
      points: db.prepare('SELECT obj, name, value, text, units, ts FROM bas_points WHERE dev=? ORDER BY obj').all(dev) });
  });
  // Points for one piece of equipment, with which object feeds each role.
  app.get('/api/plant/equip/:id', auth, (req, res) => {
    if (!canSee(req)) return res.status(403).json({ error: 'Not available for department staff' });
    const id = String(req.params.id);
    const ov = overridesAll();
    if (id.startsWith('ahu.')) {
      const dev = parseInt(id.slice(4), 10), pts = db.prepare('SELECT obj, name, value, text, units, ts FROM bas_points WHERE dev=? ORDER BY obj').all(dev);
      const am = mapAhu(dev, pts), o = ov[id] || {}, map = {};
      Object.keys(am).forEach(k => map[k] = { dev, obj: am[k], auto: true });
      Object.entries(o).forEach(([k, r]) => { if (r) map[k] = r; });
      return res.json({ id, map, points: pts.map(p => Object.assign({ dev }, p)) });
    }
    const e = allEquip().find(x => x.id === id); if (!e) return res.status(404).json({ error: 'Not found' });
    const byDev = pointsByDev();
    const map = mapEquip(e, byDev, ov);
    let pts = [];
    if (e.dev != null) pts = (byDev[e.dev] || []).map(p => Object.assign({ dev: e.dev }, p));
    else for (const r of Object.values(map)) if (r) { const p = (byDev[r.dev] || []).find(x => x.obj === r.obj); if (p) pts.push(Object.assign({ dev: r.dev }, p)); }
    if (e.dev != null && e.match) pts = pts.filter(p => e.match.test(p.name) || Object.values(map).some(r => r && r.obj === p.obj));
    if (e.fixed && e.dev === 120) pts = pts.filter(p => Object.values(e.fixed).includes(p.obj));
    res.json({ id, map, roles: ROLES[e.kind] || ROLES.other, points: pts.slice(0, 400) });
  });
  app.post('/api/plant/bas/map', auth, (req, res) => {
    if (!isMgr(req)) return res.status(403).json({ error: 'Managers and admins only' });
    const { eid, role, dev, obj } = req.body || {};
    if (!/^[\w.-]+$/.test(String(eid || '')) || !/^\w+$/.test(String(role || ''))) return res.status(400).json({ error: 'Bad equipment or role' });
    if (obj === undefined) db.prepare('DELETE FROM bas_map WHERE eid=? AND role=?').run(eid, role);
    else {
      if (obj !== null && !OBJ_RE.test(String(obj))) return res.status(400).json({ error: 'Object must look like AI 8' });
      db.prepare(`INSERT INTO bas_map (eid, role, dev, obj, by, at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(eid, role) DO UPDATE SET dev=excluded.dev, obj=excluded.obj, by=excluded.by, at=excluded.at`)
        .run(eid, role, dev == null ? null : parseInt(dev, 10), obj, req.user.name || '', iso());
    }
    writeReadings(new Set(db.prepare('SELECT dev FROM bas_devices').all().map(r => r.dev)));
    res.json({ ok: true });
  });
}

module.exports = { mount, equipment, hits, validKey, ROLES, EQUIP, ingest };
