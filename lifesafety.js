/**
 * Life safety program: fire extinguishers, emergency lights and exit signs,
 * AEDs, fire doors, sprinkler risers, the fire alarm panel, the generator,
 * and elevators.
 *
 * Two kinds of work live here:
 *   1. In-house checks on each device (monthly walk, weekly generator
 *      inspection, annual 90-minute light test). A failed item opens a
 *      work order and marks the device out of service until it passes.
 *   2. Contractor inspections with a certificate (NFPA 72 fire alarm,
 *      NFPA 25 sprinklers, NFPA 10 extinguisher service, NFPA 110 generator,
 *      state elevator inspection). These are compliance items with
 *      area = 'Life safety', the same table the kitchen uses.
 *
 * Reports are built by one generator with options (type, dates, buildings,
 * device types, sections). The fire marshal binder is one preset.
 *
 * Mounted from server.js:  require('./lifesafety').mount(app, auth)
 */
const { db } = require('./db');
const ops = require('./ops');

const DEMO_MODE = process.env.DEMO_MODE === 'true';
const TZ = process.env.TZ_NAME || 'America/Chicago';

/* =================================================================
   SCHEMA
   ================================================================= */
db.exec(`
CREATE TABLE IF NOT EXISTS ls_devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  tag         TEXT NOT NULL UNIQUE,
  building    TEXT DEFAULT '',
  location    TEXT DEFAULT '',
  details     TEXT DEFAULT '{}',
  notes       TEXT DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lsd_kind ON ls_devices(kind, building);

CREATE TABLE IF NOT EXISTS ls_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   INTEGER NOT NULL,
  check_key   TEXT NOT NULL,
  done_on     TEXT NOT NULL,
  result      TEXT NOT NULL DEFAULT 'pass',
  items       TEXT DEFAULT '[]',
  note        TEXT DEFAULT '',
  by          TEXT DEFAULT '',
  wo_id       INTEGER,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(device_id) REFERENCES ls_devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lsc_dev ON ls_checks(device_id, check_key, done_on);
`);

/* ---------------- helpers ---------------- */
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const num = (v, d = null) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function addDays(d, n) { const x = new Date((d || today()) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clubName = () => (db.prepare('SELECT name FROM properties WHERE id=1').get() || {}).name || 'Country Club of Little Rock';
const parseJ = (s, d) => { try { return JSON.parse(s || '') || d; } catch (e) { return d; } };

/* =================================================================
   DEVICE TYPES
   Each type has the details worth tracking and one or more in-house
   checks. A checklist line ending in [unit min X max Y] takes a reading.
   ================================================================= */
const KINDS = {
  extinguisher: {
    label: 'Fire extinguisher', plural: 'Fire extinguishers', prefix: 'FE', code: 'NFPA 10',
    details: [['type', 'Extinguisher class', 'text', 'ABC, K, CO2'], ['size', 'Size (lb)', 'text', '10'], ['annual_service', 'Last annual service', 'date'],
              ['six_year', 'Last 6-year maintenance', 'date'], ['hydro_due', 'Hydrotest due', 'date']],
    checks: [{ key: 'monthly', label: 'Monthly inspection', every: 30, items: [
      'In its place, mounted, and the sign is visible', 'Nothing blocking access', 'Gauge needle in the green',
      'Pin and tamper seal intact', 'No damage, corrosion, or clogged hose or nozzle', 'Instructions face out and readable',
      'Tag initialed and dated'] }],
    alertDates: [['hydro_due', 'Hydrotest due']]
  },
  emergency_light: {
    label: 'Emergency light / exit sign', plural: 'Emergency lights and exit signs', prefix: 'EL', code: 'NFPA 101 7.9.3',
    details: [['style', 'Style', 'text', 'Exit sign, bug-eye light, combo'], ['battery_date', 'Battery installed', 'date']],
    checks: [
      { key: 'monthly', label: 'Monthly 30-second test', every: 30, items: [
        'Pushed test button: lamps stayed lit 30 seconds', 'Exit sign lit and readable from the path', 'Lens, heads, and mounting OK'] },
      { key: 'annual', label: 'Annual 90-minute test', every: 365, items: [
        'Ran on battery 90 minutes', 'Lamps stayed bright the full 90 minutes', 'Charging light back on after the test'] }]
  },
  aed: {
    label: 'AED', plural: 'AEDs', prefix: 'AED', code: 'Manufacturer / Arkansas AED rules',
    details: [['model', 'Make and model', 'text', 'Philips HeartStart FRx'], ['pads_exp', 'Pads expire', 'date'], ['battery_exp', 'Battery expires', 'date'],
              ['child_pads', 'Child pads or key', 'text', 'Yes / No']],
    checks: [{ key: 'monthly', label: 'Monthly readiness check', every: 30, items: [
      'Status light shows ready (no chirp or warning)', 'Pads sealed and in date', 'Battery in date',
      'Rescue kit present: razor, scissors, gloves, CPR mask', 'Cabinet alarm sounds when opened', 'Sign visible, nothing blocking it'] }],
    alertDates: [['pads_exp', 'Pads expire'], ['battery_exp', 'Battery expires']]
  },
  fire_door: {
    label: 'Fire door', plural: 'Fire doors', prefix: 'FD', code: 'NFPA 80',
    details: [['rating', 'Rating', 'text', '90 min'], ['hold_open', 'Magnetic hold-open', 'text', 'Yes / No']],
    checks: [{ key: 'monthly', label: 'Monthly walk', every: 30, items: [
      'Closes and latches on its own from full open', 'Not propped or wedged open', 'Hold-open releases on alarm (if equipped)',
      'Label intact, no holes or added hardware', 'Gaps and seals OK'] }]
  },
  sprinkler: {
    label: 'Sprinkler riser', plural: 'Sprinkler risers', prefix: 'SPR', code: 'NFPA 25',
    details: [['system', 'System type', 'text', 'Wet, dry, preaction'], ['serves', 'Serves', 'text', 'Clubhouse'], ['spare_heads', 'Spare heads on hand', 'text', '12']],
    checks: [{ key: 'monthly', label: 'Monthly riser inspection', every: 30, items: [
      'Supply pressure below valve [psi]', 'System pressure above valve [psi]',
      'Control valves open, sealed or locked, tamper switches on', 'No leaks or corrosion at the riser',
      'Spare head cabinet stocked with the wrench', 'Fire department connection caps on and clear', 'Riser room above 40°F'] }]
  },
  fire_alarm: {
    label: 'Fire alarm panel', plural: 'Fire alarm panels', prefix: 'FACP', code: 'NFPA 72',
    details: [['make', 'Make and model', 'text', 'Gamewell-FCI E3'], ['monitoring', 'Monitoring company', 'text', ''], ['battery_date', 'Panel batteries installed', 'date']],
    checks: [{ key: 'monthly', label: 'Monthly panel check', every: 30, items: [
      'Panel shows normal: no trouble, supervisory, or alarm', 'AC power light on', 'Batteries under 4 years old and not swollen',
      'Monitoring company receiving signals (called and confirmed)', 'Annunciator and zone map posted'] }],
    alertDates: [['battery_date', 'Panel batteries installed', 1460]]
  },
  generator: {
    label: 'Generator', plural: 'Generators', prefix: 'GEN', code: 'NFPA 110',
    details: [['make', 'Make and model', 'text', 'Generac SD150'], ['kw', 'Size (kW)', 'text', '150'], ['fuel', 'Fuel', 'text', 'Diesel, natural gas'],
              ['serves', 'Serves', 'text', 'Emergency lights, fire alarm']],
    checks: [
      { key: 'weekly', label: 'Weekly inspection', every: 7, items: [
        'Switch in AUTO, no alarms on the controller', 'Oil level OK', 'Coolant level OK and block heater warm',
        'Battery voltage [V]', 'Fuel level [% min 50]', 'No leaks, belts and hoses OK'] },
      { key: 'monthly', label: 'Monthly load run', every: 30, items: [
        'Run time under load [min min 30]', 'Load during run [%]', 'Hour meter [hrs]',
        'Transfer switch transferred and returned', 'No alarms or shutdowns during the run'] }]
  },
  elevator: {
    label: 'Elevator', plural: 'Elevators', prefix: 'ELV', code: 'ASME A17.1 / Arkansas elevator safety',
    details: [['type', 'Drive', 'text', 'Hydraulic, traction'], ['state_no', 'State number', 'text', ''], ['cert_exp', 'State certificate expires', 'date'],
              ['contractor', 'Maintenance contractor', 'text', '']],
    checks: [{ key: 'monthly', label: 'Monthly owner check', every: 30, items: [
      'Emergency phone reaches a live person', 'Alarm bell works', 'State certificate posted in the cab and current',
      'Cab lights and fan work', 'Doors reopen when the edge is blocked', 'Car stops level with each floor',
      'Firefighter recall (Phase I) key test works', 'Machine room locked, clear of storage, no oil on the floor'] }],
    alertDates: [['cert_exp', 'State certificate expires']]
  }
};
const KIND_KEYS = Object.keys(KINDS);

// "Battery voltage [V min 12.4]" -> { label, unit, lo, hi }
function parseItem(s) {
  const m = String(s).match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
  if (!m) return { label: s, reading: false };
  const parts = m[2].trim().split(/\s+/);
  const o = { label: m[1].trim(), reading: true, unit: '', lo: null, hi: null };
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'min') o.lo = num(parts[++i]);
    else if (parts[i] === 'max') o.hi = num(parts[++i]);
    else if (/^-?\d/.test(parts[i]) && parts[i].includes('-')) { const [a, b] = parts[i].split('-'); o.lo = num(a); o.hi = num(b); }
    else o.unit += (o.unit ? ' ' : '') + parts[i];
  }
  return o;
}
function kindsPublic() {
  const out = {};
  KIND_KEYS.forEach(k => {
    const K = KINDS[k];
    out[k] = { key: k, label: K.label, plural: K.plural, prefix: K.prefix, code: K.code, details: K.details,
               checks: K.checks.map(c => ({ key: c.key, label: c.label, every: c.every, items: c.items.map(parseItem) })) };
  });
  return out;
}

/* =================================================================
   CONTRACTOR INSPECTIONS (compliance_items, area 'Life safety')
   ================================================================= */
const LS_ITEMS = [
  ['Fire alarm annual inspection and test (NFPA 72)', 365, 'Licensed fire alarm contractor tests every device and the panel. Keep the report and the panel tag current.', 'fire_alarm'],
  ['Sprinkler quarterly inspection (NFPA 25)', 90, 'Contractor checks alarm devices, gauges, valves, and the FDC. Report goes in the binder.', 'sprinkler'],
  ['Sprinkler annual inspection and main drain test (NFPA 25)', 365, 'Annual trip and drain test with a written report. The fire marshal asks for this first.', 'sprinkler'],
  ['Sprinkler 5-year internal pipe and FDC check (NFPA 25)', 1825, 'Internal obstruction check, gauge replacement or calibration, and the fire department connection.', 'sprinkler'],
  ['Fire line backflow preventer test', 365, 'Annual test by a certified tester, report filed with the water utility.', 'sprinkler'],
  ['Fire extinguisher annual service (NFPA 10)', 365, 'Licensed company services and re-tags every extinguisher. Six-year and hydrotest dates come due from this.', 'extinguisher'],
  ['Fire door annual inspection (NFPA 80)', 365, 'Every rated door opened, closed, and latched, with a signed record of each one.', 'fire_door'],
  ['Generator annual service and load bank test (NFPA 110)', 365, 'Oil, filters, coolant, battery, and a load bank run if monthly runs are under 30% load.', 'generator'],
  ['Transfer switch annual maintenance', 365, 'Clean, torque, and exercise the automatic transfer switch.', 'generator'],
  ['Elevator state inspection and certificate', 365, 'Arkansas elevator safety inspection. The certificate must be posted in the cab or machine room.', 'elevator'],
  ['Elevator contractor maintenance visit', 30, 'Monthly service visit under the maintenance contract. Keep the log in the machine room.', 'elevator'],
  ['Elevator annual Category 1 test', 365, 'Contractor safety test witnessed for the state inspection (relief valve, safeties, buffers).', 'elevator'],
  ['Elevator Category 5 full-load test (traction only)', 1825, 'Five-year full-load safety test. Hydraulic cars can skip this; delete it if none are traction.', 'elevator'],
  ['AED program review and staff CPR/AED training', 365, 'Confirm trained responders on staff and the medical oversight letter is current.', 'aed']
];
function ensureItems() {
  addKindCol();
  const have = new Set(db.prepare(`SELECT title FROM compliance_items WHERE area='Life safety'`).all().map(r => r.title));
  const ins = db.prepare(`INSERT INTO compliance_items (title, area, freq_days, why, next_due, sort, ls_kind) VALUES (?,?,?,?,?,?,?)`);
  if (getSetting('ls_items_loaded')) return;
  LS_ITEMS.forEach((c, i) => { if (!have.has(c[0])) ins.run(c[0], 'Life safety', c[1], c[2], today(), 100 + i, c[3]); });
  setSetting('ls_items_loaded', '1');
}
function addKindCol() {
  const cols = db.prepare('PRAGMA table_info(compliance_items)').all().map(c => c.name);
  if (!cols.includes('ls_kind')) db.exec(`ALTER TABLE compliance_items ADD COLUMN ls_kind TEXT DEFAULT ''`);
}
const getSetting = (k, d = null) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : d; };
const setSetting = (k, v) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v == null ? null : String(v));

function itemsState() {
  ensureItems();
  const t = today();
  return db.prepare(`SELECT i.*, v.name vendor_name, v.phone vendor_phone FROM compliance_items i LEFT JOIN vendors v ON v.id=i.vendor_id
    WHERE i.active=1 AND i.area='Life safety' ORDER BY i.sort, i.id`).all()
    .map(i => {
      const days = i.next_due ? daysBetween(t, i.next_due) : null;
      return Object.assign(i, { days, state: !i.last_done ? 'never' : days < 0 ? 'late' : days <= 30 ? 'soon' : 'ok' });
    });
}

/* =================================================================
   DEVICE STATE
   ================================================================= */
function deviceRows(filter = {}) {
  let rows = db.prepare('SELECT * FROM ls_devices WHERE active=1 ORDER BY kind, building, tag').all();
  if (filter.kinds && filter.kinds.length) rows = rows.filter(d => filter.kinds.includes(d.kind));
  if (filter.buildings && filter.buildings.length) rows = rows.filter(d => filter.buildings.includes(d.building));
  return rows;
}
function lastChecks() {
  const m = {};
  db.prepare(`SELECT c.* FROM ls_checks c JOIN (SELECT device_id, check_key, MAX(id) mid FROM ls_checks GROUP BY device_id, check_key) x ON x.mid=c.id`).all()
    .forEach(c => { m[c.device_id + ':' + c.check_key] = c; });
  return m;
}
function deviceState(d, last, t) {
  const K = KINDS[d.kind]; if (!K) return null;
  const details = parseJ(d.details, {});
  const checks = K.checks.map(c => {
    const l = last[d.id + ':' + c.key];
    const next = l ? addDays(l.done_on, c.every) : null;
    const days = next ? daysBetween(t, next) : null;
    return { key: c.key, label: c.label, every: c.every, last_on: l ? l.done_on : null, last_result: l ? l.result : null, last_by: l ? l.by : '',
             wo_id: l ? l.wo_id : null, next_due: next, days, state: !l ? 'never' : days < 0 ? 'late' : days <= Math.min(7, c.every / 4) ? 'soon' : 'ok' };
  });
  const failed = checks.some(c => c.last_result === 'fail');
  const expiring = (K.alertDates || []).map(([k, label, lifeDays]) => {
    let v = details[k]; if (!isDate(v)) return null;
    const due = lifeDays ? addDays(v, lifeDays) : v;
    const days = daysBetween(t, due);
    return days <= 45 ? { field: k, label: lifeDays ? label.replace('installed', 'due for replacement') : label, date: due, days } : null;
  }).filter(Boolean);
  const rank = { never: 3, late: 4, soon: 1, ok: 0 };
  let state = checks.reduce((s, c) => rank[c.state] > rank[s] ? c.state : s, 'ok');
  if (failed) state = 'failed';
  return { id: d.id, kind: d.kind, kind_label: K.label, tag: d.tag, building: d.building, location: d.location, notes: d.notes, details,
           checks, state, failed, expiring, due_now: checks.some(c => c.state === 'late' || c.state === 'never') };
}
function lsState() {
  ensureItems();
  const t = today(), last = lastChecks();
  const devices = deviceRows().map(d => deviceState(d, last, t)).filter(Boolean);
  const items = itemsState();
  const byKind = KIND_KEYS.map(k => {
    const list = devices.filter(d => d.kind === k);
    return { kind: k, label: KINDS[k].plural, count: list.length, due: list.filter(d => d.due_now).length,
             failed: list.filter(d => d.failed).length };
  });
  const totalChecks = devices.reduce((s, d) => s + d.checks.length, 0);
  const current = devices.reduce((s, d) => s + d.checks.filter(c => c.state === 'ok' || c.state === 'soon').length, 0);
  const itemsCur = items.filter(i => i.state === 'ok' || i.state === 'soon').length;
  const devPct = totalChecks ? current / totalChecks : 1, itemPct = items.length ? itemsCur / items.length : 1;
  const failed = devices.filter(d => d.failed);
  let score = Math.round(100 * (devPct * 0.55 + itemPct * 0.45));
  if (failed.length) score = Math.max(0, score - 5 * failed.length);
  return {
    today: t, kinds: kindsPublic(), devices, items, by_kind: byKind,
    score, device_pct: Math.round(100 * devPct), item_pct: Math.round(100 * itemPct),
    due_now: devices.filter(d => d.due_now).length, failed: failed.length,
    expiring: devices.flatMap(d => d.expiring.map(e => Object.assign({ tag: d.tag, device_id: d.id, kind_label: d.kind_label }, e))),
    buildings: [...new Set(db.prepare(`SELECT DISTINCT building FROM units WHERE building!='' UNION SELECT DISTINCT building FROM ls_devices WHERE building!=''`).all().map(r => r.building))].sort()
  };
}

/* =================================================================
   RECORDING A CHECK
   ================================================================= */
function recordCheck(device, checkKey, body, user) {
  const K = KINDS[device.kind];
  const C = K && K.checks.find(c => c.key === checkKey);
  if (!C) throw new Error('Unknown check for this device');
  const given = Array.isArray(body.items) ? body.items : [];
  const items = C.items.map((raw, i) => {
    const p = parseItem(raw), g = given[i] || {};
    if (p.reading) {
      const v = num(g.value);
      const ok = v == null ? g.ok !== false : !((p.lo != null && v < p.lo) || (p.hi != null && v > p.hi));
      return { label: p.label, unit: p.unit, value: v, ok };
    }
    return { label: p.label, ok: g.ok !== false };
  });
  const fails = items.filter(x => !x.ok);
  const result = fails.length ? 'fail' : 'pass';
  const done = isDate(body.done_on) && body.done_on <= today() ? body.done_on : today();
  let woId = null;
  if (fails.length) {
    const open = db.prepare(`SELECT c.wo_id FROM ls_checks c JOIN work_orders w ON w.id=c.wo_id WHERE c.device_id=? AND w.status IN ('new','open','in_progress','on_hold') ORDER BY c.id DESC LIMIT 1`).get(device.id);
    if (open) woId = open.wo_id;
    else {
      const what = fails.map(f => f.label + (f.value != null ? ` (${f.value}${f.unit ? ' ' + f.unit : ''})` : '')).join('; ');
      const pri = ['fire_alarm', 'sprinkler', 'generator', 'elevator', 'aed'].includes(device.kind) ? 'high' : 'normal';
      const info = db.prepare(`INSERT INTO work_orders (building, location, title, description, category, priority, status, source,
          requested_by, requester_dept, due_date, created_by, created_by_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(device.building || '', device.location || '', clip(`Life safety: ${device.tag} ${K.label} failed ${C.label.toLowerCase()}`, 160),
          `Failed: ${what}` + (body.note ? `\nNote: ${clip(body.note, 400)}` : '') + `\nLogged by ${user.name} on the life safety check. ${K.code}.`,
          'Life safety', pri, 'new', 'request', user.name, 'Maintenance', addDays(today(), pri === 'high' ? 1 : 7), user.name, user.id > 0 ? user.id : null);
      woId = info.lastInsertRowid;
      db.prepare(`INSERT INTO wo_notes (wo_id, kind, body, by) VALUES (?, 'status', ?, ?)`).run(woId, 'Opened automatically from a failed life safety check.', user.name);
      try { ops.kick(); } catch (e) {}
    }
  }
  db.prepare('INSERT INTO ls_checks (device_id, check_key, done_on, result, items, note, by, wo_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(device.id, C.key, done, result, JSON.stringify(items), clip(body.note, 400), user.name, woId);
  // Keep the date fields current when the check says so
  const det = parseJ(device.details, {});
  let changed = false;
  if (body.details && typeof body.details === 'object') {
    (K.details || []).forEach(([k, , type]) => {
      if (body.details[k] === undefined) return;
      const v = type === 'date' ? (isDate(body.details[k]) ? body.details[k] : '') : clip(body.details[k], 80);
      if (v !== (det[k] || '')) { det[k] = v; changed = true; }
    });
  }
  if (changed) db.prepare('UPDATE ls_devices SET details=? WHERE id=?').run(JSON.stringify(det), device.id);
  return { result, wo_id: woId, fails: fails.length };
}

/* =================================================================
   REPORT GENERATOR
   One builder, many shapes. Options:
     type      binder | deficiencies | due | inventory | history | aed | elevator | summary
     from, to  date range for history and deficiencies
     buildings list, empty = all
     kinds     list of device types, empty = all
     sections  overrides for the preset: summary, contractor, inventory,
               history, deficiencies, expiring, upcoming, signature
     group     building | kind
   ================================================================= */
const PRESETS = {
  binder:       { title: 'Fire Marshal Binder', days: 365, breaks: true, sections: ['cover', 'summary', 'contractor', 'inventory', 'deficiencies', 'expiring', 'history', 'signature'] },
  summary:      { title: 'Life Safety Program Summary', days: 30, sections: ['summary', 'contractor', 'deficiencies', 'expiring', 'upcoming'] },
  deficiencies: { title: 'Deficiencies and Corrective Actions', days: 90, sections: ['deficiencies', 'signature'] },
  due:          { title: 'Inspections Due', days: 0, sections: ['upcoming'] },
  inventory:    { title: 'Life Safety Device Inventory', days: 0, sections: ['inventory'] },
  history:      { title: 'Inspection History', days: 90, sections: ['history', 'signature'] },
  aed:          { title: 'AED Readiness Report', days: 90, kinds: ['aed'], sections: ['summary', 'inventory', 'expiring', 'history', 'deficiencies'] },
  logsheet:     { title: 'Monthly Inspection Log Sheets', days: 0, breaks: true, sections: ['logsheet'] },
  elevator:     { title: 'Elevator Compliance Report', days: 365, kinds: ['elevator'], sections: ['summary', 'contractor', 'inventory', 'history', 'deficiencies'] }
};
const SECTION_NAMES = { cover: 'Cover page and contents', logsheet: 'Paper log sheets', summary: 'Summary', contractor: 'Contractor inspections and certificates', inventory: 'Device inventory and status',
  deficiencies: 'Deficiencies and corrective actions', expiring: 'Expiring parts and certificates', history: 'Inspection history',
  upcoming: 'Coming due', signature: 'Sign-off' };

function reportOptions(q) {
  const preset = PRESETS[q.type] ? q.type : 'binder';
  const P = PRESETS[preset];
  const t = today();
  const list = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => String(s).trim()).filter(Boolean);
  const to = isDate(q.to) ? q.to : t;
  const from = isDate(q.from) ? q.from : addDays(to, -(P.days || 30));
  let kinds = list(q.kinds).filter(k => KINDS[k]);
  if (!kinds.length && P.kinds) kinds = P.kinds.slice();
  const sections = list(q.sections).filter(s => SECTION_NAMES[s]);
  return { type: preset, title: clip(q.title, 120) || P.title, from: from > to ? to : from, to, kinds, buildings: list(q.buildings).map(b => clip(b, 80)),
           sections: sections.length ? sections : P.sections, group: q.group === 'kind' ? 'kind' : 'building',
           ahead: Math.max(7, Math.min(365, parseInt(q.ahead, 10) || 60)),
           breaks: q.breaks === undefined || q.breaks === '' ? !!P.breaks : (q.breaks === '1' || q.breaks === 'true'),
           year: parseInt(q.year, 10) || parseInt((isDate(q.to) ? q.to : t).slice(0, 4), 10), prefill: q.prefill !== '0', prepared_by: clip(q.prepared_by, 80), notes: clip(q.notes, 1000) };
}

function buildReport(o, user) {
  ensureItems();
  const t = today(), last = lastChecks();
  const devs = deviceRows({ kinds: o.kinds, buildings: o.buildings }).map(d => deviceState(d, last, t)).filter(Boolean);
  const ids = new Set(devs.map(d => d.id));
  const kindSet = o.kinds.length ? new Set(o.kinds) : null;
  const items = itemsState().filter(i => !kindSet || !i.ls_kind || kindSet.has(i.ls_kind));
  const hist = db.prepare(`SELECT c.*, d.tag, d.kind, d.building, d.location, w.status wo_status, w.updated_at wo_updated
      FROM ls_checks c JOIN ls_devices d ON d.id=c.device_id LEFT JOIN work_orders w ON w.id=c.wo_id
      WHERE date(c.done_on) BETWEEN date(?) AND date(?) ORDER BY c.done_on DESC, c.id DESC`).all(o.from, o.to)
    .filter(c => ids.has(c.device_id)).map(c => Object.assign(c, { items: parseJ(c.items, []) }));
  const itemLog = db.prepare(`SELECT l.*, i.title FROM compliance_log l JOIN compliance_items i ON i.id=l.item_id
      WHERE i.area='Life safety' AND date(l.done_on) BETWEEN date(?) AND date(?) ORDER BY l.done_on DESC`).all(addDays(o.from, -730), o.to);
  const fails = hist.filter(c => c.result === 'fail');
  const S = new Set(o.sections);
  const groupKey = d => o.group === 'kind' ? d.kind_label : (d.building || 'No building');
  const groups = {}; devs.forEach(d => { (groups[groupKey(d)] = groups[groupKey(d)] || []).push(d); });
  const stateWord = { ok: 'Current', soon: 'Due soon', late: 'Overdue', never: 'Never checked', failed: 'Failed, out of service' };
  const stCls = s => s === 'ok' ? 'ok' : s === 'soon' ? 'soon' : 'bad';
  const fmt = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  const scope = [o.kinds.length ? o.kinds.map(k => KINDS[k].plural).join(', ') : 'All device types', o.buildings.length ? o.buildings.join(', ') : 'All buildings'].join(' · ');

  let h = '';
  const marks = [];
  const mark = k => marks.push([k, h.length]);
  mark('summary');
  if (S.has('summary')) {
    const cur = devs.filter(d => d.state === 'ok' || d.state === 'soon').length;
    const itCur = items.filter(i => i.state === 'ok' || i.state === 'soon').length;
    const kinds = KIND_KEYS.map(k => ({ k, list: devs.filter(d => d.kind === k) })).filter(x => x.list.length);
    h += `<div class="eb">${SECTION_NAMES.summary}</div><div class="kpis">
      <span class="k"><b>${devs.length}</b>Devices</span><span class="k"><b class="${cur === devs.length ? 'g' : 'r'}">${devs.length ? Math.round(100 * cur / devs.length) : 100}%</b>Checks current</span>
      <span class="k"><b class="${devs.some(d => d.failed) ? 'r' : 'g'}">${devs.filter(d => d.failed).length}</b>Out of service</span>
      <span class="k"><b class="${itCur === items.length ? 'g' : 'r'}">${itCur}/${items.length}</b>Contractor inspections current</span>
      <span class="k"><b>${hist.length}</b>Checks logged in period</span><span class="k"><b class="${fails.length ? 'r' : 'g'}">${fails.length}</b>Failed checks in period</span></div>
      <table><tr><th>Device type</th><th class="r">Count</th><th class="r">Current</th><th class="r">Overdue</th><th class="r">Out of service</th><th>Code</th></tr>
      ${kinds.map(x => `<tr><td><b>${escH(KINDS[x.k].plural)}</b></td><td class="r">${x.list.length}</td><td class="r">${x.list.filter(d => d.state === 'ok' || d.state === 'soon').length}</td>
        <td class="r${x.list.some(d => d.state === 'late' || d.state === 'never') ? ' bad' : ''}">${x.list.filter(d => d.state === 'late' || d.state === 'never').length}</td>
        <td class="r${x.list.some(d => d.failed) ? ' bad' : ''}">${x.list.filter(d => d.failed).length}</td><td class="dim">${escH(KINDS[x.k].code)}</td></tr>`).join('')}</table>`;
  }
  mark('contractor');
  if (S.has('contractor')) {
    h += `<div class="eb">${SECTION_NAMES.contractor}</div>${items.length ? `<table><tr><th>Inspection</th><th>Every</th><th>Last done</th><th>Next due</th><th>By / record</th></tr>
      ${items.map(i => { const lg = itemLog.filter(l => l.item_id === i.id).slice(0, 3);
        return `<tr><td><b>${escH(i.title)}</b></td><td>${i.freq_days >= 365 ? Math.round(i.freq_days / 365) + ' yr' : i.freq_days + ' days'}</td><td>${escH(fmt(i.last_done) || 'No record')}</td>
        <td class="${i.state === 'late' || i.state === 'never' ? 'bad' : i.state === 'soon' ? 'soon' : ''}">${escH(fmt(i.next_due))}</td>
        <td>${lg.map(l => escH(fmt(l.done_on)) + (l.vendor ? ' · ' + escH(l.vendor) : '') + (l.note ? ': ' + escH(l.note) : '')).join('<br>') || (i.vendor_name ? escH(i.vendor_name) : '')}</td></tr>`; }).join('')}</table>` : '<p class="dim">None for this scope.</p>'}`;
  }
  mark('inventory');
  if (S.has('inventory')) {
    h += `<div class="eb">${SECTION_NAMES.inventory}</div>` + (devs.length ? Object.keys(groups).sort().map(g => `<div class="gh">${escH(g)} <span class="dim">(${groups[g].length})</span></div>
      <table><tr><th>Tag</th><th>${o.group === 'kind' ? 'Building' : 'Type'}</th><th>Location</th><th>Details</th><th>Last check</th><th>Next due</th><th>Status</th></tr>
      ${groups[g].map(d => { const dets = (KINDS[d.kind].details || []).filter(([k]) => d.details[k]).map(([k, l, ty]) => escH(l) + ': ' + escH(ty === 'date' ? fmt(d.details[k]) : d.details[k])).join('<br>');
        const nx = d.checks.filter(c => c.next_due).sort((a, b) => a.next_due < b.next_due ? -1 : 1)[0];
        const ls = d.checks.filter(c => c.last_on).sort((a, b) => a.last_on > b.last_on ? -1 : 1)[0];
        return `<tr><td class="mono"><b>${escH(d.tag)}</b></td><td>${escH(o.group === 'kind' ? d.building : d.kind_label)}</td><td>${escH(d.location)}</td><td class="sm">${dets}</td>
        <td>${ls ? escH(fmt(ls.last_on)) + '<br><span class="dim">' + escH(ls.last_by) + '</span>' : 'None'}</td><td>${nx ? escH(fmt(nx.next_due)) : 'Now'}</td>
        <td class="${stCls(d.state)}">${stateWord[d.state]}</td></tr>`; }).join('')}</table>`).join('') : '<p class="dim">No devices for this scope.</p>');
  }
  mark('deficiencies');
  if (S.has('deficiencies')) {
    h += `<div class="eb">${SECTION_NAMES.deficiencies} · ${escH(fmt(o.from))} to ${escH(fmt(o.to))}</div>` + (fails.length ? `<table><tr><th>Date</th><th>Device</th><th>What failed</th><th>Corrective action</th><th>Status</th></tr>
      ${fails.map(c => { const fixed = db.prepare(`SELECT done_on FROM ls_checks WHERE device_id=? AND check_key=? AND result='pass' AND id>? ORDER BY id LIMIT 1`).get(c.device_id, c.check_key, c.id);
        return `<tr><td>${escH(fmt(c.done_on))}</td><td class="mono"><b>${escH(c.tag)}</b><br><span class="dim">${escH(c.building)} ${escH(c.location)}</span></td>
        <td>${c.items.filter(x => !x.ok).map(x => escH(x.label) + (x.value != null ? ` (${x.value}${x.unit ? ' ' + escH(x.unit) : ''})` : '')).join('<br>')}${c.note ? '<br><i>' + escH(c.note) + '</i>' : ''}</td>
        <td>${c.wo_id ? 'Work order #' + c.wo_id + (c.wo_status ? ' (' + escH(c.wo_status.replace('_', ' ')) + ')' : '') : ''}</td>
        <td class="${fixed ? 'ok' : 'bad'}">${fixed ? 'Passed ' + escH(fmt(fixed.done_on)) : 'Open'}</td></tr>`; }).join('')}</table>` : '<p class="dim">No failed checks in this period.</p>');
  }
  mark('expiring');
  if (S.has('expiring')) {
    const ex = devs.flatMap(d => (KINDS[d.kind].alertDates || []).map(([k, label, life]) => {
      const v = d.details[k]; if (!isDate(v)) return null;
      const due = life ? addDays(v, life) : v; const days = daysBetween(t, due);
      return days <= 120 ? { tag: d.tag, building: d.building, label: life ? label.replace('installed', 'due for replacement') : label, due, days } : null;
    })).filter(Boolean).sort((a, b) => a.days - b.days);
    h += `<div class="eb">${SECTION_NAMES.expiring} · next 120 days</div>` + (ex.length ? `<table><tr><th>Device</th><th>Item</th><th>Date</th><th>When</th></tr>
      ${ex.map(e => `<tr><td class="mono"><b>${escH(e.tag)}</b> <span class="dim">${escH(e.building)}</span></td><td>${escH(e.label)}</td><td>${escH(fmt(e.due))}</td>
      <td class="${e.days < 0 ? 'bad' : e.days <= 30 ? 'soon' : ''}">${e.days < 0 ? (-e.days) + ' days past' : 'in ' + e.days + ' days'}</td></tr>`).join('')}</table>` : '<p class="dim">Nothing expiring.</p>');
  }
  mark('upcoming');
  if (S.has('upcoming')) {
    const end = addDays(t, o.ahead);
    const up = [];
    devs.forEach(d => d.checks.forEach(c => { if (!c.next_due || c.next_due <= end) up.push({ date: c.next_due || t, what: c.label, who: 'In-house', tag: d.tag, where: [d.building, d.location].filter(Boolean).join(', '), late: !c.next_due || c.next_due < t }); }));
    items.forEach(i => { if (!i.next_due || i.next_due <= end) up.push({ date: i.next_due || t, what: i.title, who: i.vendor_name || 'Contractor', tag: '', where: '', late: i.state === 'late' || i.state === 'never' }); });
    up.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.tag < b.tag ? -1 : 1));
    h += `<div class="eb">${SECTION_NAMES.upcoming} · through ${escH(fmt(end))}</div>` + (up.length ? `<table><tr><th>Due</th><th>Task</th><th>Device</th><th>Where</th><th>By</th><th class="c">Done</th></tr>
      ${up.map(u => `<tr><td class="${u.late ? 'bad' : ''}">${u.late ? 'Overdue' : escH(fmt(u.date))}</td><td>${escH(u.what)}</td><td class="mono">${escH(u.tag)}</td><td>${escH(u.where)}</td><td>${escH(u.who)}</td><td class="c box"></td></tr>`).join('')}</table>` : '<p class="dim">Nothing due in this window.</p>');
  }
  mark('logsheet');
  if (S.has('logsheet')) {
    const yr = o.year, months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const yrChecks = o.prefill ? db.prepare(`SELECT c.device_id, c.check_key, c.done_on, c.result, c.by FROM ls_checks c WHERE substr(c.done_on,1,4)=?`).all(String(yr)) : [];
    const initials = n => String(n || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
    const sheets = []; // one block per building; each building starts a new page
    Object.keys(groups).sort().forEach(g => {
      sheets.push(`<div class="ls-bld">`);
      const byKind = {};
      groups[g].forEach(d => (byKind[d.kind] = byKind[d.kind] || []).push(d));
      Object.keys(byKind).forEach(k => {
        const K = KINDS[k];
        K.checks.filter(c => c.every <= 31).forEach(c => {
          sheets.push(`<div class="ls-sheet"><div class="gh">${escH(K.plural)} · ${escH(c.label)} · ${escH(g)} · ${yr}</div>
          <div class="dim sm">Check each item: ${escH(c.items.map(i => parseItem(i).label).join('; '))}. Initial the box when it passes. Write F and open a work order if anything fails.</div>
          <table class="grid"><tr><th>Tag</th><th>Location</th>${months.map(m => `<th class="c">${m}</th>`).join('')}</tr>
          ${byKind[k].map(d => `<tr><td class="mono"><b>${escH(d.tag)}</b></td><td class="sm">${escH(o.group === 'kind' ? d.building + ' ' : '')}${escH(d.location)}</td>${months.map((m, i) => {
            const hit = yrChecks.filter(x => x.device_id === d.id && x.check_key === c.key && +x.done_on.slice(5, 7) === i + 1).pop();
            return `<td class="c cell${hit && hit.result === 'fail' ? ' bad' : ''}">${hit ? (hit.result === 'fail' ? 'F ' : '') + escH(initials(hit.by)) + '<br><span class="tiny">' + +hit.done_on.slice(8) + '</span>' : ''}</td>`; }).join('')}</tr>`).join('')}</table></div>`);
        });
      });
      sheets.push(`</div>`);
    });
    h += `<div class="eb">${SECTION_NAMES.logsheet}</div>` + (sheets.length ? sheets.join('') : '<p class="dim">No devices for this scope.</p>');
  }
  mark('history');
  if (S.has('history')) {
    h += `<div class="eb">${SECTION_NAMES.history} · ${escH(fmt(o.from))} to ${escH(fmt(o.to))}</div>` + (hist.length ? `<table><tr><th>Date</th><th>Device</th><th>Check</th><th>Result</th><th>Readings</th><th>By</th></tr>
      ${hist.map(c => { const C = (KINDS[c.kind].checks.find(x => x.key === c.check_key) || {}).label || c.check_key;
        const rd = c.items.filter(x => x.value != null).map(x => escH(x.label) + ': ' + x.value + (x.unit ? ' ' + escH(x.unit) : '')).join('<br>');
        return `<tr><td>${escH(fmt(c.done_on))}</td><td class="mono"><b>${escH(c.tag)}</b> <span class="dim">${escH(c.building)}</span></td><td>${escH(C)}</td>
        <td class="${c.result === 'pass' ? 'ok' : 'bad'}">${c.result === 'pass' ? 'Pass' : 'Fail'}</td><td class="sm">${rd}</td><td>${escH(c.by)}</td></tr>`; }).join('')}</table>` : '<p class="dim">No checks logged in this period.</p>');
  }
  mark('notes');
  if (o.notes) h += `<div class="eb">Notes</div><p>${escH(o.notes).replace(/\n/g, '<br>')}</p>`;
  mark('signature');
  if (S.has('signature')) {
    h += `<div class="eb">${SECTION_NAMES.signature}</div><div class="sig"><div><span></span>Prepared by${o.prepared_by ? ': ' + escH(o.prepared_by) : ''}</div><div><span></span>Date</div></div>
      <div class="sig"><div><span></span>Reviewed by (Director of Facilities)</div><div><span></span>Date</div></div>
      <div class="sig"><div><span></span>Fire marshal / AHJ</div><div><span></span>Date</div></div>`;
  }
  mark('end');
  const secs = marks.slice(0, -1).map((m, i) => ({ key: m[0], html: h.slice(m[1], marks[i + 1][1]) })).filter(x => x.html);
  // Order the parts the way the reader expects: notes and sign-off last.
  const body = secs.map((x, i) => `<section id="s-${x.key}" class="sec${o.breaks && i > 0 && x.key !== 'signature' && x.key !== 'notes' ? ' brk' : ''}${x.key === 'logsheet' && o.breaks ? ' sheets' : ''}">${x.html}</section>`).join('');
  let cover = '';
  if (S.has('cover')) {
    const toc = secs.filter(x => x.key !== 'notes').map((x, i) => `<tr><td class="n">${i + 1}</td><td>${escH(SECTION_NAMES[x.key] || x.key)}</td></tr>`).join('');
    cover = `<section class="cover"><img src="/crest.png" alt=""><div class="club">${escH(clubName())}</div><h1>${escH(o.title)}</h1>
      <div class="cv-sub">Life Safety Program · Facilities Department</div><div class="cv-rule"></div>
      <table class="cv-meta"><tr><td>Period</td><td>${escH(fmt(o.from))} to ${escH(fmt(o.to))}</td></tr><tr><td>Scope</td><td>${escH(scope)}</td></tr>
      <tr><td>Prepared</td><td>${escH(fmt(t))}${o.prepared_by || user ? ' by ' + escH(o.prepared_by || user.name) : ''}</td></tr></table>
      <div class="eb" style="text-align:left">Contents</div><table class="toc">${toc}</table></section>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(o.title)}</title><style>
body{margin:0;background:#F3EFE5;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1A2436;font-size:12px}
.page{max-width:1000px;margin:0 auto;background:#fff;padding:26px 28px 40px}
h1{font-family:Georgia,serif;color:#1F3A63;margin:4px 0 0;font-size:25px}.club{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4F6F99}
.hd{border-bottom:3px solid #B79B5B;padding-bottom:10px;margin-bottom:14px;display:flex;gap:14px;align-items:center}.hd img{height:64px}
.eb{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4F6F99;margin:22px 0 8px;border-bottom:1px solid #DDD5C3;padding-bottom:4px;page-break-after:avoid}
.gh{font-weight:bold;color:#1F3A63;margin:12px 0 4px;font-size:13px}
table{border-collapse:collapse;width:100%;margin-bottom:6px}th,td{border-bottom:1px solid #EEE8DA;padding:4px 6px;vertical-align:top;text-align:left}
th{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#7C8494;border-bottom:1px solid #DDD5C3}tr{page-break-inside:avoid}
.r{text-align:right}.c{text-align:center}.mono{font-family:Menlo,Consolas,monospace;white-space:nowrap}.sm{font-size:11px}.dim{color:#7C8494}
.ok{color:#2E7D4F;font-weight:600}.soon{color:#A36A00;font-weight:600}.bad{color:#B3362D;font-weight:700;background:#FDF1EF}
.box{width:40px}.box:after{content:'';display:inline-block;width:14px;height:14px;border:1.5px solid #1F3A63}
.kpis{margin-bottom:10px}.k{display:inline-block;margin:0 26px 8px 0;color:#4F5A6B}.k b{display:block;font-family:Georgia,serif;font-size:22px;color:#1F3A63}.k b.r{color:#B3362D}.k b.g{color:#2E7D4F}
.sig{display:flex;gap:30px;margin-top:26px}.sig div{flex:1;color:#7C8494;font-size:11px}.sig span{display:block;border-bottom:1px solid #1A2436;height:26px;margin-bottom:4px}.sig div:last-child{flex:0 0 160px}
.bar{position:sticky;top:0;background:#1F3A63;padding:10px;text-align:center}.bar button{background:#D8BE7C;border:0;color:#1F3A63;font-weight:bold;padding:9px 18px;border-radius:3px;font-size:14px}
.foot{margin-top:26px;color:#7C8494;font-size:10px;border-top:1px solid #DDD5C3;padding-top:6px}

.cover{text-align:center;padding:40px 10px 20px;page-break-after:always}.cover img{height:150px}.cover h1{font-size:34px;margin:10px 0 6px}
.cover .club{margin-top:16px}.cv-sub{color:#4F6F99;font-size:13px;letter-spacing:1px}.cv-rule{width:120px;height:3px;background:#B79B5B;margin:22px auto}
.cv-meta{width:auto;margin:0 auto 34px}.cv-meta td{border:0;padding:3px 10px;font-size:13px;text-align:left}.cv-meta td:first-child{color:#7C8494;text-transform:uppercase;font-size:10px;letter-spacing:1.5px;text-align:right}
.toc{max-width:420px;margin:0 auto}.toc td{font-size:13px;padding:6px}.toc .n{width:30px;color:#B79B5B;font-family:Georgia,serif;font-weight:bold}
.grid td,.grid th{border:1px solid #D9D1BE}.grid .cell{height:30px;min-width:34px;font-size:11px;font-weight:600}.tiny{font-size:8px;color:#7C8494;font-weight:400}
.ls-sheet{margin-bottom:16px;page-break-inside:avoid}.sheets .ls-bld{page-break-after:always}.sheets .ls-bld:last-child{page-break-after:auto}
.rh{display:none}
@media print{.bar{display:none}.page{padding:0;max-width:none}.brk{page-break-before:always}.rh{display:flex;justify-content:space-between;font-size:9px;color:#7C8494;border-bottom:1px solid #DDD5C3;padding-bottom:3px;margin-bottom:8px}
@page{margin:0.6in 0.55in}}</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save PDF</button></div><div class="page">
${cover}
<div class="hd"><img src="/crest.png" alt=""><div><div class="club">${escH(clubName())} · Life Safety Program</div><h1>${escH(o.title)}</h1>
<div class="dim">${escH(scope)} · ${o.from && !S.has('logsheet') ? escH(fmt(o.from)) + ' to ' + escH(fmt(o.to)) + ' · ' : ''}prepared ${escH(fmt(t))}${user ? ' by ' + escH(o.prepared_by || user.name) : ''}</div></div></div>
${body}
<div class="foot">Generated by Clubhouse IQ. In-house checks follow ${escH([...new Set(devs.map(d => KINDS[d.kind].code))].join(', ') || 'NFPA')}. Contractor reports and certificates are kept on file with Facilities.</div>
</div></body></html>`;
}

/* =================================================================
   DEMO DATA
   ================================================================= */
function seedDemo() {
  if (!DEMO_MODE) return;
  ensureItems();
  if (db.prepare('SELECT COUNT(*) c FROM ls_devices').get().c) return;
  const t = today();
  const ins = db.prepare('INSERT INTO ls_devices (kind, tag, building, location, details) VALUES (?,?,?,?,?)');
  const add = (kind, tag, b, loc, det) => ins.run(kind, tag, b, loc, JSON.stringify(det || {})).lastInsertRowid;
  const devs = [];
  [['Clubhouse', 'CH', ['Main kitchen by fryers', 'Ballroom east exit', 'Grill Room', 'Lobby', 'Men\'s locker room', 'Women\'s locker room', 'Boiler room']],
   ['Indoor Tennis Center', 'TN', ['Front desk', 'Court 3 exit']], ['Fitness Center', 'FC', ['Entry']], ['Pool Pavilion', 'PP', ['Snack bar']],
   ['Golf Shop', 'GS', ['Register']], ['Central Plant', 'CP', ['Chiller room door']]].forEach(([b, code, locs]) =>
    locs.forEach((l, i) => devs.push(add('extinguisher', `FE-${code}-${String(i + 1).padStart(2, '0')}`, b, l,
      { type: /fryer/.test(l) ? 'K' : 'ABC', size: /fryer/.test(l) ? '6 L' : '10', annual_service: addDays(t, -200), hydro_due: i === 2 ? addDays(t, 40) : addDays(t, 900) }))));
  [['Clubhouse', 'CH', 8], ['Indoor Tennis Center', 'TN', 3], ['Fitness Center', 'FC', 2], ['Family & Teen Center', 'FT', 2]].forEach(([b, code, n]) => {
    for (let i = 1; i <= n; i++) devs.push(add('emergency_light', `EL-${code}-${String(i).padStart(2, '0')}`, b, i % 2 ? 'Exit sign, corridor ' + i : 'Bug-eye light, stair ' + i, { style: i % 2 ? 'Exit sign' : 'Bug-eye light' }));
  });
  devs.push(add('aed', 'AED-CH-01', 'Clubhouse', 'Lobby by front desk', { model: 'Philips HeartStart FRx', pads_exp: addDays(t, 21), battery_exp: addDays(t, 600), child_pads: 'Yes' }));
  devs.push(add('aed', 'AED-FC-01', 'Fitness Center', 'Front desk', { model: 'ZOLL AED 3', pads_exp: addDays(t, 400), battery_exp: addDays(t, 300), child_pads: 'Yes' }));
  devs.push(add('aed', 'AED-PP-01', 'Pool Pavilion', 'Guard stand', { model: 'Philips HeartStart FRx', pads_exp: addDays(t, 180), battery_exp: addDays(t, 820) }));
  devs.push(add('aed', 'AED-GS-01', 'Golf Shop', 'Behind counter', { model: 'Cardiac Science G5', pads_exp: addDays(t, 250), battery_exp: addDays(t, 30) }));
  ['Ballroom to kitchen', 'Kitchen to dock', 'Stair 1, main floor', 'Stair 2, main floor', 'Boiler room'].forEach((l, i) =>
    devs.push(add('fire_door', `FD-CH-${String(i + 1).padStart(2, '0')}`, 'Clubhouse', l, { rating: i < 2 ? '90 min' : '60 min', hold_open: i < 2 ? 'Yes' : 'No' })));
  devs.push(add('sprinkler', 'SPR-CH-1', 'Clubhouse', 'Riser room off the dock', { system: 'Wet', serves: 'Clubhouse', spare_heads: '12' }));
  devs.push(add('sprinkler', 'SPR-TN-1', 'Indoor Tennis Center', 'Mechanical room', { system: 'Dry', serves: 'Tennis courts and lobby', spare_heads: '6' }));
  devs.push(add('fire_alarm', 'FACP-CH-1', 'Clubhouse', 'Back office hall', { make: 'Gamewell-FCI E3', monitoring: 'Central station', battery_date: addDays(t, -1430) }));
  devs.push(add('generator', 'GEN-1', 'Clubhouse', 'Behind the kitchen dock', { make: 'Generac SD150', kw: '150', fuel: 'Diesel', serves: 'Kitchen coolers, emergency lights, fire alarm' }));
  devs.push(add('elevator', 'ELV-CH-1', 'Clubhouse', 'Lobby to ballroom level', { type: 'Hydraulic', state_no: 'AR-04412', cert_exp: addDays(t, 35), contractor: 'Sample Elevator Co.' }));
  // History: about 4 months of checks, a few late or failed
  const all = db.prepare('SELECT * FROM ls_devices').all();
  const user = { name: 'Demo Tech', id: 0 };
  all.forEach((d, n) => {
    KINDS[d.kind].checks.forEach(c => {
      const cycles = c.every >= 365 ? 1 : c.every === 7 ? 12 : 4;
      for (let k = cycles; k >= 1; k--) {
        let when = addDays(t, -c.every * k + (n % 5));
        if (c.every >= 365) when = addDays(t, -200);
        if (k === 1 && n % 11 === 3) continue; // a few missed
        const items = c.items.map(raw => { const p = parseItem(raw); return p.reading ? { value: /Supply/.test(p.label) ? 68 : /System/.test(p.label) ? 74 : /Battery/.test(p.label) ? 13.1 : /Fuel/.test(p.label) ? 80 : /Run time/.test(p.label) ? 30 : /Load/.test(p.label) ? 35 : 1200 + k * 2 } : { ok: true }; });
        if (k === 1 && d.tag === 'FE-CH-03') items[2] = { ok: false };
        if (k === 1 && d.tag === 'EL-CH-05' && c.key === 'monthly') items[0] = { ok: false };
        if (k === 1 && d.tag === 'FD-CH-01') items[1] = { ok: false };
        recordCheck(d, c.key, { done_on: when, items, note: d.tag === 'FD-CH-01' && k === 1 ? 'Wedged open with a rubber stop during banquet setup' : '' }, user);
      }
    });
  });
  // FD-CH-01 was fixed and passed afterwards
  const fd = all.find(d => d.tag === 'FD-CH-01');
  recordCheck(fd, 'monthly', { done_on: addDays(t, -1) }, user);
  const lags = { 'Fire alarm annual': 120, 'Sprinkler quarterly': 100, 'Sprinkler annual': 250, 'Sprinkler 5-year': 900, 'Fire line backflow': 300, 'Fire extinguisher annual': 200,
                 'Fire door annual': 330, 'Generator annual': 150, 'Transfer switch': 150, 'Elevator state': 330, 'Elevator contractor': 20, 'Elevator annual': 330, 'Elevator Category 5': 1000, 'AED program': 60 };
  db.prepare(`SELECT * FROM compliance_items WHERE area='Life safety'`).all().forEach(i => {
    const key = Object.keys(lags).find(k => i.title.startsWith(k)); if (!key) return;
    const done = addDays(t, -lags[key]);
    db.prepare('UPDATE compliance_items SET last_done=?, next_due=? WHERE id=?').run(done, addDays(done, i.freq_days), i.id);
    db.prepare('INSERT INTO compliance_log (item_id, done_on, by, note, vendor) VALUES (?,?,?,?,?)').run(i.id, done, 'Demo', 'Report on file', /Elevator/.test(i.title) ? 'Sample Elevator Co.' : 'Sample Fire Protection');
  });
}

/* =================================================================
   ROUTES
   ================================================================= */
function mount(app, auth) {
  const canWrite = u => ['admin', 'manager', 'tech'].includes(u.role);
  const mgr = u => u.role === 'admin' || u.role === 'manager';
  const deny = res => res.status(403).json({ error: 'Maintenance staff only' });
  ensureItems();

  app.get('/api/ls', auth, (req, res) => { if (req.user.role === 'staff') return deny(res); res.json(lsState()); });

  app.get('/api/ls/tag/:tag', auth, (req, res) => {
    const d = db.prepare('SELECT id FROM ls_devices WHERE tag=? AND active=1').get(String(req.params.tag).trim().toUpperCase());
    if (!d) return res.status(404).json({ error: 'Not a life safety tag' });
    res.json({ id: d.id });
  });

  app.get('/api/ls/devices/:id', auth, (req, res) => {
    const d = db.prepare('SELECT * FROM ls_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Device not found' });
    const st = deviceState(d, lastChecks(), today());
    const log = db.prepare('SELECT * FROM ls_checks WHERE device_id=? ORDER BY done_on DESC, id DESC LIMIT 40').all(d.id).map(c => Object.assign(c, { items: parseJ(c.items, []) }));
    res.json({ device: st, log });
  });

  const fields = b => {
    const kind = KINDS[b.kind] ? b.kind : null;
    const det = {};
    if (kind) (KINDS[kind].details || []).forEach(([k, , type]) => { const v = (b.details || {})[k]; if (v != null && v !== '') det[k] = type === 'date' ? (isDate(v) ? v : '') : clip(v, 80); });
    return { kind, building: clip(b.building, 80), location: clip(b.location, 120), notes: clip(b.notes, 500), details: JSON.stringify(det) };
  };
  const tagOk = s => /^[A-Z0-9][A-Z0-9_.\-]{0,23}$/.test(s);
  const taken = (tag, id) => db.prepare('SELECT id FROM ls_devices WHERE tag=? AND id!=?').get(tag, id || 0) || db.prepare('SELECT id FROM units WHERE apt=?').get(tag);

  app.post('/api/ls/devices', auth, (req, res) => {
    if (!canWrite(req.user)) return deny(res);
    const b = req.body || {}, f = fields(b);
    if (!f.kind) return res.status(400).json({ error: 'Pick the device type' });
    const count = Math.max(1, Math.min(60, parseInt(b.count, 10) || 1));
    let tags = [];
    if (count === 1) {
      const tag = clip(b.tag, 24).toUpperCase();
      if (!tagOk(tag)) return res.status(400).json({ error: 'Give it a tag, like FE-CH-01' });
      if (taken(tag)) return res.status(400).json({ error: `${tag} is already in use` });
      tags = [tag];
    } else {
      // "Add several": FE-CH-01, FE-CH-02 ... skipping tags in use
      const base = (clip(b.tag, 20).toUpperCase().replace(/[-_]?\d+$/, '') || KINDS[f.kind].prefix).replace(/[^A-Z0-9_.\-]/g, '');
      let n = 1;
      while (tags.length < count && n < 999) { const t = `${base}-${String(n).padStart(2, '0')}`; if (!taken(t)) tags.push(t); n++; }
    }
    const ins = db.prepare('INSERT INTO ls_devices (kind, tag, building, location, details, notes) VALUES (?,?,?,?,?,?)');
    db.transaction(() => tags.forEach((t, i) => ins.run(f.kind, t, f.building, count > 1 && f.location ? `${f.location} ${i + 1}` : f.location, f.details, f.notes)))();
    res.json(Object.assign(lsState(), { added: tags }));
  });

  app.put('/api/ls/devices/:id', auth, (req, res) => {
    if (!canWrite(req.user)) return deny(res);
    const d = db.prepare('SELECT * FROM ls_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Device not found' });
    const b = Object.assign({ kind: d.kind }, req.body || {}), f = fields(b);
    const tag = b.tag ? clip(b.tag, 24).toUpperCase() : d.tag;
    if (!tagOk(tag)) return res.status(400).json({ error: 'Tags use letters, numbers, and dashes' });
    if (tag !== d.tag && taken(tag, d.id)) return res.status(400).json({ error: `${tag} is already in use` });
    db.prepare('UPDATE ls_devices SET kind=?, tag=?, building=?, location=?, details=?, notes=? WHERE id=?').run(f.kind || d.kind, tag, f.building, f.location, f.details, f.notes, d.id);
    res.json(lsState());
  });

  app.delete('/api/ls/devices/:id', auth, (req, res) => {
    if (!mgr(req.user)) return res.status(403).json({ error: 'Only a manager can remove a device' });
    db.prepare('UPDATE ls_devices SET active=0 WHERE id=?').run(req.params.id);
    res.json(lsState());
  });

  app.post('/api/ls/devices/:id/check', auth, (req, res) => {
    if (!canWrite(req.user)) return deny(res);
    const d = db.prepare('SELECT * FROM ls_devices WHERE id=? AND active=1').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Device not found' });
    try {
      const r = recordCheck(d, clip((req.body || {}).check, 20), req.body || {}, req.user);
      res.json(Object.assign(r, { state: lsState() }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Contractor inspections
  app.post('/api/ls/items/:id/done', auth, (req, res) => {
    if (!canWrite(req.user)) return deny(res);
    const it = db.prepare(`SELECT * FROM compliance_items WHERE id=? AND area='Life safety'`).get(req.params.id);
    if (!it) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const d = isDate(b.done_on) ? b.done_on : today();
    db.prepare('INSERT INTO compliance_log (item_id, done_on, by, note, vendor) VALUES (?,?,?,?,?)').run(it.id, d, req.user.name, clip(b.note, 300), clip(b.vendor, 80));
    const last = db.prepare('SELECT MAX(done_on) d FROM compliance_log WHERE item_id=?').get(it.id).d;
    db.prepare('UPDATE compliance_items SET last_done=?, next_due=? WHERE id=?').run(last, addDays(last, it.freq_days), it.id);
    res.json(lsState());
  });
  app.post('/api/ls/items', auth, (req, res) => {
    if (!canWrite(req.user)) return deny(res);
    const b = req.body || {};
    const title = clip(b.title, 120); if (!title) return res.status(400).json({ error: 'Name the inspection' });
    const freq = Math.max(1, parseInt(b.freq_days, 10) || 365);
    const vid = parseInt(b.vendor_id, 10) || null;
    const kind = KINDS[b.ls_kind] ? b.ls_kind : '';
    if (b.id) {
      const it = db.prepare(`SELECT * FROM compliance_items WHERE id=? AND area='Life safety'`).get(b.id);
      if (!it) return res.status(404).json({ error: 'Not found' });
      db.prepare('UPDATE compliance_items SET title=?, freq_days=?, vendor_id=?, why=?, ls_kind=?, next_due=? WHERE id=?')
        .run(title, freq, vid, clip(b.why, 400), kind, it.last_done ? addDays(it.last_done, freq) : it.next_due, it.id);
    } else db.prepare(`INSERT INTO compliance_items (title, area, freq_days, vendor_id, why, ls_kind, next_due, sort) VALUES (?,?,?,?,?,?,?,199)`)
      .run(title, 'Life safety', freq, vid, clip(b.why, 400), kind, today());
    res.json(lsState());
  });
  app.delete('/api/ls/items/:id', auth, (req, res) => {
    if (!canWrite(req.user)) return deny(res);
    db.prepare(`UPDATE compliance_items SET active=0 WHERE id=? AND area='Life safety'`).run(req.params.id);
    res.json(lsState());
  });
  app.get('/api/ls/items/:id/log', auth, (req, res) => {
    res.json({ log: db.prepare('SELECT * FROM compliance_log WHERE item_id=? ORDER BY done_on DESC LIMIT 30').all(req.params.id) });
  });

  // Printable QR tags for life safety devices
  app.get('/api/ls/tags', auth, (req, res) => {
    const kinds = String(req.query.kinds || '').split(',').filter(k => KINDS[k]);
    const b = clip(req.query.building, 80);
    res.json({ tags: deviceRows({ kinds, buildings: b ? [b] : [] }).map(d => ({ apt: d.tag, building: d.building, type: KINDS[d.kind].label, route: 'Life safety', location: d.location, serves: '' })) });
  });

  // Report generator
  app.get('/api/ls/report-options', auth, (req, res) => {
    res.json({ presets: Object.keys(PRESETS).map(k => ({ key: k, title: PRESETS[k].title, days: PRESETS[k].days, sections: PRESETS[k].sections, kinds: PRESETS[k].kinds || [] })),
               sections: Object.keys(SECTION_NAMES).map(k => ({ key: k, label: SECTION_NAMES[k] })), kinds: KIND_KEYS.map(k => ({ key: k, label: KINDS[k].plural })) });
  });
  app.get('/api/ls/report', auth, (req, res) => {
    if (req.user.role === 'staff') return deny(res);
    res.json({ html: buildReport(reportOptions(req.query), req.user) });
  });

  seedDemo();
}

/* Alerts contributed to the alert center. */
function alerts(user) {
  if (!user || user.role === 'staff') return [];
  const out = [];
  try {
    const s = lsState();
    if (s.failed) out.push({ level: 'warn', kind: 'lifesafety', title: `${s.failed} life safety device${s.failed > 1 ? 's' : ''} out of service`,
      detail: s.devices.filter(d => d.failed).slice(0, 3).map(d => d.tag).join(', '), go: { tab: 'lifesafety' } });
    if (s.due_now) out.push({ level: 'info', kind: 'lifesafety', title: `${s.due_now} life safety check${s.due_now > 1 ? 's' : ''} due`, detail: 'Extinguishers, lights, AEDs, doors, risers, generator, elevator', go: { tab: 'lifesafety' } });
    const late = s.items.filter(i => i.state === 'late' || i.state === 'never');
    if (late.length) out.push({ level: 'warn', kind: 'lifesafety', title: `${late.length} life safety inspection${late.length > 1 ? 's' : ''} past due`, detail: late.slice(0, 2).map(i => i.title).join(', '), go: { tab: 'lifesafety' } });
    s.expiring.filter(e => e.days <= 30).forEach(e => out.push({ level: e.days < 0 ? 'warn' : 'info', kind: 'lifesafety',
      title: `${e.tag}: ${e.label.toLowerCase()} ${e.days < 0 ? (-e.days) + ' days ago' : 'in ' + e.days + ' days'}`, detail: e.kind_label, go: { tab: 'lifesafety' } }));
  } catch (e) { /* alerts are best-effort */ }
  return out;
}

/* One line for the monthly facilities report. */
function monthSummary(start, end) {
  try {
    const n = db.prepare(`SELECT COUNT(*) c, SUM(result='fail') f FROM ls_checks WHERE date(done_on) BETWEEN date(?) AND date(?)`).get(start, end);
    const s = lsState();
    return { checks: n.c || 0, failed: n.f || 0, score: s.score, out_of_service: s.failed, items_late: s.items.filter(i => i.state === 'late' || i.state === 'never').length };
  } catch (e) { return null; }
}

module.exports = { mount, alerts, lsState, monthSummary, KINDS };
