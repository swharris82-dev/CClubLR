/*
 * Remote BAS controls for the central plant loop.
 *
 * The app never talks BACnet. A signed-in admin, manager or tech asks for a
 * change here; it is saved as a pending command. The control program on the
 * HVAC PC (gateway/ciq_bas_control.py) polls for pending commands with the
 * plant key, writes them to the BAS, reads the point back, and reports.
 *
 * Safety:
 *   - Off until an admin or manager turns remote control on in the app.
 *   - Only points in the catalog below can be written, inside their limits.
 *   - Commands older than 10 minutes when the PC asks are expired, not sent.
 *   - One pending command per point; a newer one replaces it.
 *   - Every request is kept with who, when, why, the old value and the result.
 *   - The PC program has its own switch (allow_writes) and device allowlist.
 */
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS bas_ctl_map (key TEXT PRIMARY KEY, device INTEGER, object TEXT, updated_by TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS bas_ctl_values (key TEXT PRIMARY KEY, value REAL, text TEXT, priority INTEGER, ts TEXT);
CREATE TABLE IF NOT EXISTS bas_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, device INTEGER, object TEXT,
  action TEXT, value REAL, prev REAL, priority INTEGER, reason TEXT,
  requested_by TEXT, requested_by_id INTEGER, status TEXT DEFAULT 'pending',
  result TEXT, readback REAL, created_at TEXT, sent_at TEXT, done_at TEXT);
CREATE TABLE IF NOT EXISTS bas_ctl_state (k TEXT PRIMARY KEY, v TEXT);
`);

const iso = d => (d || new Date()).toISOString();
const getS = k => { const r = db.prepare('SELECT v FROM bas_ctl_state WHERE k=?').get(k); return r ? r.v : null; };
const setS = (k, v) => db.prepare('INSERT INTO bas_ctl_state (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

/* kind: 'sp' analog setpoint (written directly), 'ao' analog output override
   (priority 8, Auto releases it), 'bin' on/off command (priority 8, Auto releases).
   obj: known object on plant controller 120 from the Compass graphic, or '' if
   it still needs to be found in Compass and entered on the Controls screen.
   read: plant reading key to show as the current value when the PC hasn't read the object yet. */
const CATALOG = [
  { key: 'chw_sp', group: 'Chilled water', label: 'Chilled water supply setpoint', kind: 'sp', units: '°F', min: 40, max: 50, step: 0.5, dev: 120, obj: '', read: 'chw_sp',
    help: 'What the chiller makes. Raising it 1 to 2°F on mild days saves energy; too low drives low-temperature short cycling.' },
  { key: 'chiller_en', group: 'Chilled water', label: 'Chiller enable', kind: 'bin', dev: 120, obj: 'BO 3', read: 'comp_running',
    help: 'BAS run permission to the chiller. Auto gives control back to the BAS program (polling / Manual Run).' },
  { key: 'chw_pump', group: 'Chilled water', label: 'Building CHW pump', kind: 'bin', dev: 120, obj: 'BO 1', read: 'chw_pump',
    help: 'Turning this off with the chiller running trips it on the flow switch.' },
  { key: 'cw_pump', group: 'Condenser water', label: 'Condenser water pump', kind: 'bin', dev: 120, obj: 'BO 2', read: 'cw_pump',
    help: 'The water-cooled walk-in needs this pump even when the chiller is off.' },
  { key: 'tower_approach', group: 'Cooling tower', label: 'Tower approach (setpoint above wet bulb)', kind: 'sp', units: '°F', min: 3, max: 12, step: 0.5, dev: 120, obj: '',
    help: 'Tower supply setpoint = outside wet bulb + this. The BAS was set to 5°F on 10/13.' },
  { key: 'tower_min', group: 'Cooling tower', label: 'Minimum condenser water to chiller', kind: 'sp', units: '°F', min: 55, max: 85, step: 1, dev: 120, obj: '',
    help: 'Floor on the tower setpoint. Under about 55°F the York trips on low evaporator pressure.' },
  { key: 'tower_fan_en', group: 'Cooling tower', label: 'Tower fan enable', kind: 'bin', dev: 120, obj: 'BO 0',
    help: 'Run permission to the tower VFD.' },
  { key: 'tower_fan_sig', group: 'Cooling tower', label: 'Tower fan speed override', kind: 'ao', units: '%', min: 0, max: 100, step: 5, dev: 120, obj: 'AO 0', read: 'tower_signal',
    help: 'Holds the fan signal at a fixed speed. Use Auto to hand it back to the tower loop.' },
  { key: 'tower_bypass', group: 'Cooling tower', label: 'Tower bypass valve override', kind: 'ao', units: '%', min: 0, max: 100, step: 5, dev: 120, obj: 'AO 1',
    help: 'Percent to bypass. Auto gives it back to the BAS.' },
  { key: 'phx_wb', group: 'PHX-1 free cooling', label: 'PHX-1 enable below wet bulb', kind: 'sp', units: '°F', min: 35, max: 56, step: 0.5, dev: 120, obj: '',
    help: 'Free cooling starts when the outside wet bulb drops below this. Original setting 52°F.' },
  { key: 'phx_cond_vlv', group: 'PHX-1 free cooling', label: 'PHX-1 condenser valve', kind: 'bin', dev: 120, obj: 'BO 1000',
    help: 'Changeover valve on the condenser side. Normally Auto.' },
  { key: 'phx_chw_vlv', group: 'PHX-1 free cooling', label: 'PHX-1 chilled water valve', kind: 'bin', dev: 120, obj: 'BO 1001',
    help: 'Changeover valve on the chilled water side. With PHX-1 on and no flow, water bypasses the evaporator (11/7 trip).' },
  { key: 'hw_sp', group: 'Heating hot water', label: 'Hot water supply setpoint', kind: 'sp', units: '°F', min: 110, max: 180, step: 1, dev: 120, obj: '', read: 'hws',
    help: 'Top of the outdoor reset. Lower it on mild days; hot decks need about 115°F or more.' },
  { key: 'hw_pump', group: 'Heating hot water', label: 'Hot water pump', kind: 'bin', dev: 120, obj: '', read: 'hw_pump',
    help: 'Boilers lock out on no flow (error 59) if this stops.' },
  { key: 'boiler_en', group: 'Heating hot water', label: 'Boiler enable', kind: 'bin', dev: 120, obj: '',
    help: 'BAS enable to the boilers.' },
  { key: 'mech_ef', group: 'Mechanical room', label: 'Mechanical room exhaust fan', kind: 'bin', dev: 120, obj: 'BO 2009',
    help: 'Room temperature control normally runs this.' }
];
const BY = Object.fromEntries(CATALOG.map(c => [c.key, c]));
const OBJ_RE = /^(AI|AO|AV|BI|BO|BV|MSV|MSO) \d{1,7}$/;
const WRITE_ROLES = ['admin', 'manager', 'tech'];
const MAP_ROLES = ['admin', 'manager'];

function mapped(c) {
  const m = db.prepare('SELECT * FROM bas_ctl_map WHERE key=?').get(c.key);
  return { device: m && m.device ? m.device : c.dev, object: m ? (m.object || '') : c.obj };
}
function priorityFor(c, obj) {
  // Commandable outputs get the manual operator priority. AV setpoints are
  // written straight to present value, which is how Compass changes them.
  if (/^(AO|BO|BV|MSO)\b/.test(obj) && c.kind !== 'sp') return 8;
  return null;
}
function expire() {
  db.prepare(`UPDATE bas_commands SET status='expired', done_at=?, result='The HVAC PC did not pick it up within 10 minutes. Nothing was written.'
              WHERE status='pending' AND created_at < ?`).run(iso(), iso(new Date(Date.now() - 10 * 60000)));
  db.prepare(`UPDATE bas_commands SET status='failed', done_at=?, result='Sent to the HVAC PC but no result came back.'
              WHERE status='sent' AND sent_at < ?`).run(iso(), iso(new Date(Date.now() - 5 * 60000)));
}
function plantVal(key) {
  if (!key) return null;
  const r = db.prepare('SELECT value, ts FROM plant_readings WHERE key=? ORDER BY ts DESC LIMIT 1').get(key);
  return r ? r : null;
}
function view(user) {
  expire();
  const gw = getS('gw_last_poll');
  const gwAge = gw ? (Date.now() - Date.parse(gw)) / 60000 : null;
  const list = CATALOG.map(c => {
    const m = mapped(c);
    const cv = db.prepare('SELECT * FROM bas_ctl_values WHERE key=?').get(c.key);
    const pv = plantVal(c.read);
    const last = db.prepare('SELECT * FROM bas_commands WHERE key=? ORDER BY id DESC LIMIT 1').get(c.key);
    return Object.assign({}, c, { dev: undefined, obj: undefined, device: m.device, object: m.object, mapped: !!m.object,
      priority: m.object ? priorityFor(c, m.object) : null,
      current: cv ? { value: cv.value, text: cv.text, priority: cv.priority, ts: cv.ts, src: 'bas' } : pv ? { value: pv.value, ts: pv.ts, src: 'plant' } : null,
      last: last || null });
  });
  return {
    enabled: getS('enabled') === '1', enabled_by: getS('enabled_by'), enabled_at: getS('enabled_at'),
    gateway: { last_poll: gw, online: gwAge != null && gwAge < 3, writes_allowed: getS('gw_allow') === '1', version: getS('gw_version') },
    can_write: WRITE_ROLES.includes(user.role), can_map: MAP_ROLES.includes(user.role),
    controls: list,
    log: db.prepare('SELECT * FROM bas_commands ORDER BY id DESC LIMIT 40').all()
  };
}

function mount(app, auth, keyOk) {
  app.get('/api/plant/controls', auth, (req, res) => {
    if (req.user.role === 'staff') return res.status(403).json({ error: 'Not available for department staff' });
    res.json(view(req.user));
  });

  app.post('/api/plant/controls/enable', auth, (req, res) => {
    if (!MAP_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Only an admin or manager can turn remote control on or off' });
    const on = !!(req.body || {}).enabled;
    setS('enabled', on ? '1' : '0'); setS('enabled_by', req.user.name); setS('enabled_at', iso());
    if (!on) db.prepare(`UPDATE bas_commands SET status='cancelled', done_at=?, result='Remote control turned off' WHERE status='pending'`).run(iso());
    res.json(view(req.user));
  });

  app.post('/api/plant/controls/:key/map', auth, (req, res) => {
    if (!MAP_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Only an admin or manager can change which BAS point a control writes' });
    const c = BY[req.params.key]; if (!c) return res.status(404).json({ error: 'Unknown control' });
    const b = req.body || {};
    const object = String(b.object || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const device = parseInt(b.device, 10) || c.dev;
    if (object && !OBJ_RE.test(object)) return res.status(400).json({ error: 'Object looks like "AV 23" or "BO 3"' });
    if (c.kind === 'bin' && object && !/^(BO|BV)/.test(object)) return res.status(400).json({ error: 'An on/off control needs a BO or BV object' });
    if (c.kind !== 'bin' && object && !/^(AO|AV)/.test(object)) return res.status(400).json({ error: 'A value control needs an AO or AV object' });
    db.prepare(`INSERT INTO bas_ctl_map (key, device, object, updated_by, updated_at) VALUES (?,?,?,?,?)
                ON CONFLICT(key) DO UPDATE SET device=excluded.device, object=excluded.object, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .run(c.key, device, object, req.user.name, iso());
    db.prepare('DELETE FROM bas_ctl_values WHERE key=?').run(c.key);
    res.json(view(req.user));
  });

  app.post('/api/plant/controls/:key', auth, (req, res) => {
    if (!WRITE_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Your role can view controls but not change them' });
    if (getS('enabled') !== '1') return res.status(400).json({ error: 'Remote control is off. An admin or manager can turn it on at the top of this screen.' });
    const c = BY[req.params.key]; if (!c) return res.status(404).json({ error: 'Unknown control' });
    const m = mapped(c);
    if (!m.object) return res.status(400).json({ error: 'This control is not tied to a BAS point yet. Enter the object from Compass first.' });
    const b = req.body || {};
    const reason = String(b.reason || '').trim().slice(0, 300);
    if (reason.length < 3) return res.status(400).json({ error: 'Say why, so the log makes sense later' });
    let action = b.action === 'release' ? 'release' : 'write', value = null;
    if (action === 'write') {
      value = Number(b.value);
      if (c.kind === 'bin') { if (value !== 0 && value !== 1) return res.status(400).json({ error: 'On or off only' }); }
      else {
        if (!isFinite(value)) return res.status(400).json({ error: 'Enter a number' });
        if (value < c.min || value > c.max) return res.status(400).json({ error: `Allowed range is ${c.min} to ${c.max} ${c.units || ''}`.trim() });
        value = Math.round(value / c.step) * c.step;
      }
    } else if (c.kind === 'sp') return res.status(400).json({ error: 'Setpoints are changed, not released. Enter the value you want.' });
    // rate limit: 20 commands per person per hour
    const n = db.prepare('SELECT COUNT(*) n FROM bas_commands WHERE requested_by_id=? AND created_at>?').get(req.user.id, iso(new Date(Date.now() - 3600e3))).n;
    if (n >= 20) return res.status(429).json({ error: 'Too many changes in the last hour. Wait a bit or make the change in Compass.' });
    db.prepare(`UPDATE bas_commands SET status='cancelled', done_at=?, result='Replaced by a newer change' WHERE key=? AND status='pending'`).run(iso(), c.key);
    const cv = db.prepare('SELECT value FROM bas_ctl_values WHERE key=?').get(c.key);
    const pv = plantVal(c.read);
    const prev = cv ? cv.value : pv ? pv.value : null;
    db.prepare(`INSERT INTO bas_commands (key, device, object, action, value, prev, priority, reason, requested_by, requested_by_id, status, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?)`)
      .run(c.key, m.device, m.object, action, value, prev, priorityFor(c, m.object), reason, req.user.name, req.user.id, iso());
    res.json(view(req.user));
  });

  app.post('/api/plant/commands/:id/cancel', auth, (req, res) => {
    if (!WRITE_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed' });
    db.prepare(`UPDATE bas_commands SET status='cancelled', done_at=?, result=? WHERE id=? AND status='pending'`).run(iso(), 'Cancelled by ' + req.user.name, req.params.id);
    res.json(view(req.user));
  });

  /* ---- HVAC PC side (plant key, no login) ---- */
  app.post('/api/plant/gateway/commands', (req, res) => {
    if (!keyOk(req)) return res.status(401).json({ error: 'Bad or missing plant key' });
    const b = req.body || {};
    setS('gw_last_poll', iso()); setS('gw_allow', b.allow_writes ? '1' : '0'); if (b.version) setS('gw_version', String(b.version).slice(0, 30));
    // values it read since last time
    if (b.values && typeof b.values === 'object') {
      const up = db.prepare(`INSERT INTO bas_ctl_values (key, value, text, priority, ts) VALUES (?,?,?,?,?)
                             ON CONFLICT(key) DO UPDATE SET value=excluded.value, text=excluded.text, priority=excluded.priority, ts=excluded.ts`);
      for (const [k, v] of Object.entries(b.values)) if (BY[k] && v && typeof v === 'object') up.run(k, v.value == null || isNaN(+v.value) ? null : +v.value, v.text ? String(v.text).slice(0, 60) : null, v.priority == null ? null : +v.priority, iso());
    }
    // results of writes it did
    if (Array.isArray(b.results)) {
      const up = db.prepare(`UPDATE bas_commands SET status=?, result=?, readback=?, done_at=? WHERE id=? AND status='sent'`);
      for (const r of b.results.slice(0, 50)) up.run(r.ok ? 'done' : 'failed', String(r.message || (r.ok ? 'Written and read back' : 'Write failed')).slice(0, 300), r.readback == null || isNaN(+r.readback) ? null : +r.readback, iso(), parseInt(r.id, 10));
    }
    expire();
    let cmds = [];
    if (getS('enabled') === '1') {
      cmds = db.prepare(`SELECT id, key, device, object, action, value, priority FROM bas_commands WHERE status='pending' ORDER BY id LIMIT 10`).all();
      const mark = db.prepare(`UPDATE bas_commands SET status='sent', sent_at=? WHERE id=?`);
      for (const c of cmds) mark.run(iso(), c.id);
    }
    const watch = CATALOG.map(c => Object.assign({ key: c.key }, mapped(c))).filter(m => m.object);
    res.json({ enabled: getS('enabled') === '1', commands: cmds, watch,
      limits: Object.fromEntries(CATALOG.filter(c => c.kind !== 'bin').map(c => [c.key, [c.min, c.max]])) });
  });
}

module.exports = { mount, CATALOG };
