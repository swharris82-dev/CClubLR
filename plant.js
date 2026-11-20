/**
 * Central plant monitor: York YK chiller, cooling tower and VFD, PHX-1,
 * building chilled water loop, and the water-cooled walk-in.
 *
 * Readings come in from the read-only BACnet gateway on the plant network.
 * The gateway POSTs to /api/plant/ingest with the X-Plant-Key header
 * (env PLANT_INGEST_KEY). Nothing in the app ever writes to the BAS.
 *
 * Every batch is checked against the alarm rules below. Alarms open and
 * clear on their own, show on the dashboard alert list, and can be turned
 * into a work order from the Plant screen.
 *
 * When no gateway is connected yet, the Plant screen runs a demo simulation
 * in the browser (public/plant-ui.js). Demo data never reaches this table.
 *
 * Mounted from server.js:  require('./plant').mount(app, auth)
 */
const crypto = require('crypto');
const { db } = require('./db');

/* ---------------- points ---------------- */
// key, label, BACnet device, object, units
const POINTS = [
  ['lchwt', 'Leaving chilled water', 5001, 'AV 5', '°F'],
  ['echwt', 'Entering chilled water', 5001, 'AV 6', '°F'],
  ['ecwt', 'Condenser water to chiller', 5001, 'AV 10', '°F'],
  ['lcwt', 'Condenser water from chiller', 5001, 'AV 11', '°F'],
  ['evap_psi', 'Evaporator pressure', 5001, 'AV 7', 'psig'],
  ['cond_psi', 'Condenser pressure', 5001, 'AV 8', 'psig'],
  ['fla_pct', 'Motor current', 5001, 'AV 12', '% FLA'],
  ['chw_sp', 'Leaving CHW active setpoint', 5001, 'AV 19', '°F'],
  ['starts', 'Number of starts', 5001, 'AV 27', ''],
  ['comp_running', 'Compressor running', 5001, 'BV 5', ''],
  ['fault_text', 'Panel fault message', 5001, 'AV 402/403', ''],
  ['tower_hz', 'Tower VFD output', 505002, 'AV 1', 'Hz'],
  ['tower_signal', 'BAS signal to tower fan', 120, '', '%'],
  ['chws', 'CHW supply to building', 120, '', '°F'],
  ['chwr', 'CHW return from building', 120, '', '°F'],
  ['chw_gpm', 'CHW flow', 120, '', 'gpm'],
  ['oa_db', 'Outside air', 120, '', '°F'],
  ['oa_wb', 'Outside wet bulb', 120, '', '°F'],
  ['cw_pump', 'Condenser water pump', 120, '', ''],
  ['chw_pump', 'Building CHW pump', 120, '', ''],
  ['phx_on', 'PHX-1 free cooling', 120, '', ''],
  ['phx_chw_in', 'PHX-1 CHW in', 120, '', '°F'],
  ['phx_chw_out', 'PHX-1 CHW out', 120, '', '°F'],
  ['walkin_temp', 'Walk-in cooler', 120, '', '°F']
].map(([key, label, device, object, units]) => ({ key, label, device, object, units }));
const KEYS = new Set(POINTS.map(p => p.key));
const STALE_MIN = 10;

db.exec(`
CREATE TABLE IF NOT EXISTS plant_readings (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL,
  key    TEXT NOT NULL,
  value  REAL,
  text   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pr_key_ts ON plant_readings(key, ts);

CREATE TABLE IF NOT EXISTS plant_alarms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule        TEXT NOT NULL,
  level       TEXT NOT NULL,
  equipment   TEXT DEFAULT '',
  title       TEXT NOT NULL,
  detail      TEXT DEFAULT '',
  fault       TEXT DEFAULT '',
  started_at  TEXT NOT NULL,
  cleared_at  TEXT,
  acked_by    TEXT,
  acked_at    TEXT,
  wo_id       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pa_open ON plant_alarms(cleared_at, rule);
`);

/* ---------------- helpers ---------------- */
const iso = d => (d || new Date()).toISOString();
const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
const f1 = v => v == null ? '?' : (+v).toFixed(1);

function latest() {
  const rows = db.prepare(`
    SELECT r.key, r.value, r.text, r.ts FROM plant_readings r
    JOIN (SELECT key, MAX(ts) ts FROM plant_readings GROUP BY key) m ON m.key = r.key AND m.ts = r.ts`).all();
  const v = {};
  for (const r of rows) v[r.key] = r;
  return v;
}

// Compressor starts = off-to-on changes of comp_running since `sinceIso`.
function startsSince(sinceIso) {
  const rows = db.prepare(`SELECT value FROM plant_readings WHERE key='comp_running' AND ts >= ? ORDER BY ts`).all(sinceIso);
  let n = 0, prev = null;
  for (const r of rows) { if (prev === 0 && r.value === 1) n++; prev = r.value; }
  return n;
}

/* ---------------- alarm rules ---------------- */
// Each rule looks at the latest values (x) and returns null or { detail }.
const RULES = [
  { id: 'trip', level: 'critical', eq: 'Chiller (York YK)',
    test: x => x.fault ? { title: 'Chiller shutdown: ' + x.fault, detail: `Leaving chilled water ${f1(x.lchwt)}°F, flow ${x.chw_gpm == null ? '?' : Math.round(x.chw_gpm)} gpm.`, fault: x.fault } : null },
  { id: 'short', level: 'warn', eq: 'Chiller (York YK)',
    test: x => x.starts2h >= 4 ? { title: 'Chiller short cycling', detail: `${x.starts2h} starts in the last 2 hours.`, fault: 'LEAVING CHILLED LIQUID - LOW TEMPERATURE' } : null },
  { id: 'walkin', level: 'critical', eq: 'Walk-in cooler',
    test: x => x.walkin_temp > 41 ? { title: 'Walk-in cooler above 41°F', detail: `Box at ${f1(x.walkin_temp)}°F. Condenser water pump is ${x.cw_pump === 1 ? 'on' : 'off'}. Tell the chef so product can be moved.` } : null },
  { id: 'tower', level: 'warn', eq: 'Tower VFD 505002',
    test: x => (x.tower_signal != null && x.tower_hz != null && Math.abs(x.tower_signal * 0.6 - x.tower_hz) > 10)
      ? { title: 'Tower VFD not following the BAS', detail: `BAS signal ${Math.round(x.tower_signal)}% (about ${Math.round(x.tower_signal * 0.6)} Hz) but the drive runs ${Math.round(x.tower_hz)} Hz.` } : null },
  { id: 'coldcw', level: 'warn', eq: 'Condenser water',
    test: x => (x.comp_running === 1 && x.ecwt != null && x.ecwt < 55) ? { title: 'Condenser water too cold for the chiller', detail: `Entering condenser water ${f1(x.ecwt)}°F.` } : null },
  { id: 'lowdt', level: 'warn', eq: 'Chilled water loop',
    test: x => {
      const dt = (x.echwt != null && x.lchwt != null) ? x.echwt - x.lchwt : null;
      return (x.comp_running === 1 && x.fla_pct > 45 && x.chw_gpm > 300 && dt != null && dt < 5)
        ? { title: 'Low chilled water delta T', detail: `Delta T ${dt.toFixed(1)}°F at ${Math.round(x.chw_gpm)} gpm.` } : null;
    } },
  { id: 'phx', level: 'critical', eq: 'PHX-1 heat exchanger',
    test: x => (x.phx_on === 1 && x.chws > 50) ? { title: 'PHX-1 on but chilled water is not cooling', detail: `CHW supply ${f1(x.chws)}°F. PHX-1 CHW in/out ${f1(x.phx_chw_in)}/${f1(x.phx_chw_out)}°F.` } : null },
  { id: 'stale', level: 'warn', eq: 'Plant gateway',
    test: x => x.staleMin != null && x.staleMin > STALE_MIN ? { title: 'No plant data from the gateway', detail: `Last reading ${Math.round(x.staleMin)} minutes ago. Check the gateway box and the BAS network.` } : null }
];

function evaluate() {
  const v = latest();
  const x = {};
  for (const k of KEYS) x[k] = v[k] ? num(v[k].value) : null;
  x.fault = v.fault_text && v.fault_text.text ? String(v.fault_text.text).trim() : '';
  const lastTs = Object.values(v).reduce((m, r) => r.ts > m ? r.ts : m, '');
  x.staleMin = lastTs ? (Date.now() - Date.parse(lastTs)) / 60000 : null;
  x.starts2h = startsSince(iso(new Date(Date.now() - 2 * 3600e3)));
  const now = iso();
  const open = db.prepare('SELECT * FROM plant_alarms WHERE cleared_at IS NULL').all();
  for (const r of RULES) {
    const hit = r.test(x);
    const cur = open.find(a => a.rule === r.id);
    if (hit && !cur) {
      db.prepare(`INSERT INTO plant_alarms (rule, level, equipment, title, detail, fault, started_at) VALUES (?,?,?,?,?,?,?)`)
        .run(r.id, r.level, r.eq, hit.title, hit.detail, hit.fault || '', now);
    } else if (hit && cur) {
      db.prepare('UPDATE plant_alarms SET detail=?, title=? WHERE id=?').run(hit.detail, hit.title, cur.id);
    } else if (!hit && cur) {
      db.prepare('UPDATE plant_alarms SET cleared_at=? WHERE id=?').run(now, cur.id);
    }
  }
  return x;
}

let lastPrune = 0;
function prune() {
  if (Date.now() - lastPrune < 3600e3) return;
  lastPrune = Date.now();
  db.prepare(`DELETE FROM plant_readings WHERE ts < ?`).run(iso(new Date(Date.now() - 90 * 86400e3)));
}

function keyOk(req) {
  const want = process.env.PLANT_INGEST_KEY || '';
  const got = String(req.get('x-plant-key') || '');
  if (want.length < 24 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function status() {
  const v = latest();
  const lastTs = Object.values(v).reduce((m, r) => r.ts > m ? r.ts : m, '');
  const live = !!lastTs && (Date.now() - Date.parse(lastTs)) < STALE_MIN * 60000;
  return {
    live, last_ts: lastTs || null, gateway_key_set: (process.env.PLANT_INGEST_KEY || '').length >= 24,
    points: POINTS.map(p => Object.assign({}, p, v[p.key] ? { value: v[p.key].value, text: v[p.key].text, ts: v[p.key].ts } : {})),
    starts_1h: startsSince(iso(new Date(Date.now() - 3600e3))),
    starts_2h: startsSince(iso(new Date(Date.now() - 2 * 3600e3))),
    alarms: db.prepare('SELECT * FROM plant_alarms WHERE cleared_at IS NULL ORDER BY level, started_at DESC').all(),
    history: db.prepare('SELECT * FROM plant_alarms ORDER BY started_at DESC LIMIT 40').all()
  };
}

/* ---------------- routes ---------------- */
function mount(app, auth) {
  // Gateway feed. Not behind staff login: uses the plant key instead.
  app.post('/api/plant/ingest', (req, res) => {
    if (!keyOk(req)) return res.status(401).json({ error: 'Bad or missing plant key' });
    const b = req.body || {};
    let rows = [];
    if (Array.isArray(b.readings)) rows = b.readings;
    else if (b.values && typeof b.values === 'object') rows = Object.entries(b.values).map(([key, value]) => ({ key, value, ts: b.ts }));
    if (!rows.length || rows.length > 500) return res.status(400).json({ error: 'Send 1 to 500 readings' });
    const ins = db.prepare('INSERT INTO plant_readings (ts, key, value, text) VALUES (?,?,?,?)');
    let n = 0, skipped = [];
    db.transaction(() => {
      for (const r of rows) {
        if (!r || !KEYS.has(r.key)) { skipped.push(r && r.key); continue; }
        const t = r.ts && !isNaN(Date.parse(r.ts)) ? iso(new Date(r.ts)) : iso();
        const isText = r.key === 'fault_text';
        ins.run(t, r.key, isText ? null : num(r.value), isText ? String(r.value == null ? '' : r.value).slice(0, 120) : (r.text ? String(r.text).slice(0, 120) : null));
        n++;
      }
    })();
    evaluate(); prune();
    res.json({ ok: true, stored: n, skipped: skipped.filter(Boolean) });
  });

  app.get('/api/plant', auth, (req, res) => {
    if (req.user.role === 'staff') return res.status(403).json({ error: 'Not available for department staff' });
    if (status().last_ts) evaluate(); // also catches the gateway going quiet
    res.json(status());
  });

  // Trend: 5-minute averages for the asked points.
  app.get('/api/plant/trend', auth, (req, res) => {
    if (req.user.role === 'staff') return res.status(403).json({ error: 'Not available for department staff' });
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 4, 1), 168);
    const keys = String(req.query.keys || '').split(',').filter(k => KEYS.has(k)).slice(0, 6);
    if (!keys.length) return res.json({ series: {} });
    const bucket = hours > 24 ? 1800 : 300;
    const since = iso(new Date(Date.now() - hours * 3600e3));
    const out = {};
    const q = db.prepare(`SELECT (CAST(strftime('%s', ts) AS INTEGER) / ${bucket}) * ${bucket} b, AVG(value) v
                          FROM plant_readings WHERE key=? AND ts>=? AND value IS NOT NULL GROUP BY b ORDER BY b`);
    for (const k of keys) out[k] = q.all(k, since).map(r => [r.b * 1000, Math.round(r.v * 10) / 10]);
    res.json({ hours, series: out });
  });

  app.post('/api/plant/alarms/:id/ack', auth, (req, res) => {
    const a = db.prepare('SELECT id FROM plant_alarms WHERE id=?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Alarm not found' });
    db.prepare('UPDATE plant_alarms SET acked_by=?, acked_at=? WHERE id=?').run(req.user.name, iso(), a.id);
    res.json(status());
  });

  app.post('/api/plant/alarms/:id/wo', auth, (req, res) => {
    const a = db.prepare('SELECT id FROM plant_alarms WHERE id=?').get(req.params.id);
    const wo = parseInt((req.body || {}).wo_id, 10);
    if (!a || !wo) return res.status(400).json({ error: 'Alarm or work order missing' });
    db.prepare('UPDATE plant_alarms SET wo_id=? WHERE id=?').run(wo, a.id);
    res.json({ ok: true });
  });
}

/* Dashboard alert list hook (ops.js). */
function alerts(user) {
  if (!user || user.role === 'staff') return [];
  try {
    return db.prepare('SELECT * FROM plant_alarms WHERE cleared_at IS NULL').all().map(a => ({
      level: a.level === 'critical' ? 'critical' : 'warn', kind: 'plant', title: a.title, detail: a.detail, go: { tab: 'plant' }
    }));
  } catch (e) { return []; }
}

module.exports = { mount, alerts, POINTS, RULES, evaluate };
