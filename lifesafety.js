/**
 * Life safety walk: the monthly fire and life safety inspection.
 *
 * Every device on the walk has a tag (FE-001, EL-001, EX-001...) and a kind.
 * Each kind carries its own monthly checklist, taken from the code that
 * governs it:
 *
 *   Fire extinguisher          NFPA 10   monthly visual, annual service, 6-year, hydro
 *   Emergency light            NFPA 101  monthly 30-second test, annual 90-minute test
 *   Exit sign                  NFPA 101  monthly visual and battery test
 *   Exit sign / emergency combo           both of the above
 *   Fire alarm pull station    NFPA 72
 *   Fire alarm panel (FACP)    NFPA 72   monthly trouble check, annual vendor test
 *   Sprinkler riser / valve    NFPA 25   monthly valves and gauges, annual vendor test
 *   Fire door                  NFPA 80
 *   Exit door                  NFPA 101  egress hardware
 *   Kitchen hood suppression   NFPA 96 / 17A, semiannual vendor service
 *   AED
 *   Eyewash station            ANSI Z358.1
 *
 * On top of the devices, each area gets a general walk-through each month
 * (exits clear, 18 in. below sprinklers, 36 in. at electrical panels...).
 *
 * A failed item opens one maintenance work order per device (or area), so
 * nothing found on the walk gets lost. GET /api/ls/sheet returns the paper
 * route sheet to print and carry.
 *
 * Mounted from server.js with require('./lifesafety').mount(app, auth).
 */
const { db } = require('./db');
const ops = require('./ops');

const TZ = process.env.TZ_NAME || 'America/Chicago';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OPEN_SQL = `('new','open','in_progress','on_hold')`;
const canWork = u => u && ['admin', 'manager', 'tech'].includes(u.role);
const isMgr = u => u && ['admin', 'manager'].includes(u.role);

function addMonths(ym, n) {
  if (!/^\d{4}-\d{2}/.test(String(ym || ''))) return null;
  const [y, m] = ym.slice(0, 7).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/* ================= kinds and checklists ================= */
// key, label, tag prefix, short label for paper, checklist [key, text, short],
// recurring vendor or annual service: months and label.
const KINDS = [
  { key: 'extinguisher', label: 'Fire extinguisher', prefix: 'FE', svc: 12, svcLabel: 'Annual service',
    checks: [
      ['place', 'In its place, mounted, top 5 ft or less off the floor', 'Mounted'],
      ['access', 'Visible and unobstructed, sign posted if hidden', 'Clear'],
      ['label', 'Instructions legible and facing out', 'Label'],
      ['gauge', 'Gauge in the green (CO2: weight OK)', 'Gauge'],
      ['pin', 'Pin and tamper seal intact', 'Pin/seal'],
      ['full', 'Full by heft, not discharged', 'Full'],
      ['damage', 'No dents, rust, leaks, or clogged nozzle', 'Damage'],
      ['hose', 'Hose and nozzle in good shape', 'Hose'],
      ['tag', 'Service tag attached and current', 'Tag']] },
  { key: 'emlight', label: 'Emergency light', prefix: 'EL', svc: 12, svcLabel: 'Annual 90-minute test',
    checks: [
      ['test30', 'Pressed test: lamps lit a full 30 seconds', '30-sec test'],
      ['aim', 'Heads aimed down the path of exit', 'Aimed'],
      ['charge', 'Charge or ready light on', 'Charge LED'],
      ['damage', 'No damage, lens clean, mounted secure', 'Damage']] },
  { key: 'exit', label: 'Exit sign', prefix: 'EX', svc: 12, svcLabel: 'Annual 90-minute test',
    checks: [
      ['lit', 'Lit, every letter and face', 'Lit'],
      ['test30', 'Pressed test: stays lit 30 seconds on battery', '30-sec test'],
      ['arrow', 'Visible from the path, arrow points the right way', 'Visible'],
      ['damage', 'No damage, mounted secure', 'Damage']] },
  { key: 'combo', label: 'Exit sign / emergency light combo', plural: 'Exit sign / emergency light combos', prefix: 'EC', svc: 12, svcLabel: 'Annual 90-minute test',
    checks: [
      ['lit', 'Exit sign lit, every letter and face', 'Sign lit'],
      ['test30', 'Pressed test: sign and heads lit 30 seconds', '30-sec test'],
      ['aim', 'Heads aimed down the path of exit', 'Aimed'],
      ['charge', 'Charge or ready light on', 'Charge LED'],
      ['damage', 'No damage, mounted secure', 'Damage']] },
  { key: 'pull', label: 'Fire alarm pull station', prefix: 'PS', svc: 12, svcLabel: 'Annual alarm test (vendor)',
    checks: [
      ['access', 'Visible and unobstructed', 'Clear'],
      ['damage', 'No damage, cover or guard intact', 'Damage'],
      ['reset', 'Not pulled, not in alarm', 'Normal']] },
  { key: 'facp', label: 'Fire alarm panel (FACP)', plural: 'Fire alarm panels (FACP)', prefix: 'FA', svc: 12, svcLabel: 'Annual alarm test (vendor)',
    checks: [
      ['normal', 'Panel normal: no trouble, supervisory, or alarm', 'Normal'],
      ['power', 'AC power light on', 'Power'],
      ['battery', 'Batteries dated within 4 years, no swelling', 'Batteries'],
      ['access', 'Panel clear, door closed, key on hand', 'Access']] },
  { key: 'sprinkler', label: 'Sprinkler riser / control valve', plural: 'Sprinkler risers / control valves', prefix: 'SP', svc: 12, svcLabel: 'Annual sprinkler test (vendor)',
    checks: [
      ['valves', 'Control valves open and sealed or locked', 'Valves open'],
      ['gauge', 'Gauge pressure normal (write it down)', 'Gauge psi'],
      ['leaks', 'No leaks, corrosion, or damage', 'Leaks'],
      ['spares', 'Spare head cabinet stocked, wrench inside', 'Spare heads'],
      ['fdc', 'Fire dept. connection capped and reachable', 'FDC']] },
  { key: 'firedoor', label: 'Fire door', prefix: 'FD', svc: 12, svcLabel: 'Annual fire door inspection',
    checks: [
      ['closes', 'Closes and latches on its own', 'Latches'],
      ['propped', 'Not propped or wedged open', 'Not propped'],
      ['hardware', 'Closer, hinges, and hardware intact', 'Hardware'],
      ['label', 'Label visible, no holes or added hardware', 'Label']] },
  { key: 'exitdoor', label: 'Exit door', prefix: 'ED', svc: 0, svcLabel: '',
    checks: [
      ['opens', 'Opens freely, no chains or added locks', 'Opens free'],
      ['panic', 'Panic bar or lever works', 'Panic bar'],
      ['outside', 'Outside path clear to the public way', 'Path clear'],
      ['sign', 'Exit sign above or in view', 'Sign']] },
  { key: 'hood', label: 'Kitchen hood suppression', plural: 'Kitchen hood suppression systems', prefix: 'KH', svc: 6, svcLabel: 'Semiannual service (vendor)',
    checks: [
      ['gauge', 'Cylinder gauge in the green', 'Gauge'],
      ['pull', 'Manual pull station clear and marked', 'Pull clear'],
      ['tag', 'Service tag current (6 months)', 'Tag'],
      ['caps', 'Nozzle caps in place, nozzles aimed at appliances', 'Nozzles'],
      ['kext', 'Class K extinguisher within 30 ft', 'Class K']] },
  { key: 'aed', label: 'AED', plural: 'AEDs', prefix: 'AED', svc: 0, svcLabel: '',
    checks: [
      ['status', 'Status light shows ready', 'Ready'],
      ['pads', 'Pads in date (write the date)', 'Pads date'],
      ['battery', 'Battery in date', 'Battery'],
      ['cabinet', 'Cabinet clear, alarm works', 'Cabinet']] },
  { key: 'eyewash', label: 'Eyewash station', plural: 'Eyewash stations', prefix: 'EW', svc: 0, svcLabel: '',
    checks: [
      ['flush', 'Activated and flushed, water clear', 'Flushed'],
      ['caps', 'Caps on, bowl clean', 'Caps'],
      ['access', 'Clear path, sign posted', 'Clear']] }
];
const KIND = Object.fromEntries(KINDS.map(k => [k.key, k]));

// The general walk for each area, once a month.
const AREA_CHECKS = [
  ['exits', 'Exit routes and corridors clear', 'Exits clear'],
  ['stairs', 'Stairwells clear, no storage', 'Stairs'],
  ['sprk18', 'Nothing stored within 18 in. of sprinkler heads', '18 in.'],
  ['heads', 'Sprinkler heads and smoke detectors not painted, covered, or damaged', 'Heads'],
  ['panels', 'Electrical panels 36 in. clear, covers on', 'Panels'],
  ['cords', 'No daisy-chained power strips or cords as permanent wiring', 'Cords'],
  ['house', 'Housekeeping: no trash or combustibles built up', 'Clean'],
  ['maps', 'Evacuation maps posted and current', 'Evac maps']
];

/* ================= schema ================= */
db.exec(`
CREATE TABLE IF NOT EXISTS ls_devices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tag        TEXT UNIQUE NOT NULL,
  kind       TEXT NOT NULL,
  building   TEXT DEFAULT '',
  area       TEXT DEFAULT '',
  location   TEXT DEFAULT '',
  info       TEXT DEFAULT '{}',
  notes      TEXT DEFAULT '',
  sort       INTEGER DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ls_checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  INTEGER,
  building   TEXT DEFAULT '',
  area       TEXT DEFAULT '',
  done_on    TEXT NOT NULL,
  pass       INTEGER NOT NULL DEFAULT 1,
  failed     TEXT DEFAULT '[]',
  reading    TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  wo_id      INTEGER,
  by         TEXT DEFAULT '',
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lsc_dev ON ls_checks(device_id, done_on);
CREATE INDEX IF NOT EXISTS idx_lsc_area ON ls_checks(building, area, done_on);
CREATE TABLE IF NOT EXISTS ls_gaps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT DEFAULT 'extinguisher',
  building    TEXT DEFAULT '',
  area        TEXT DEFAULT '',
  location    TEXT NOT NULL,
  recommend   TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  resolved    INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  created_by  TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ================= starting inventory =================
   From Stephen's walk of the clubhouse, Nov 9-10 2026. Adds only tags that
   are not in the database yet, so edits made in the app are never overwritten. */
const START = [
  { tag: 'FE-001', building: 'Clubhouse', area: 'Lower level', location: 'Service stairwell', info: { type: 'ABC', mfr: 'Amerex' }, notes: 'Wall hook mount. Size, serial, and tag dates still to fill in.' },
  { tag: 'FE-002', building: 'Clubhouse', area: 'Lower level', location: 'Chiller / mechanical room, stairwell side', info: { type: 'Clean agent (Halotron)', mfr: 'Amerex', last_annual: '2026-04' }, notes: 'Room with the chiller and controls. Tag had one old monthly initial, rest blank.' },
  { tag: 'FE-003', building: 'Clubhouse', area: 'Lower level', location: 'Kitchen', info: { type: 'ABC' }, notes: 'Type not confirmed. Kitchen needs a Class K within 30 ft of the cooking line.' },
  { tag: 'FE-004', building: 'Clubhouse', area: 'Lower level', location: "Outside janitor's closet, near team center (recessed cabinet)", info: { type: 'ABC', mfr: 'Amerex', last_annual: '2026-04' }, notes: 'Tag owner ID 04. Annual 4/1/26 (MV). Green valve collar, check label for Halotron.',
    history: ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'] },
  { tag: 'FE-005', building: 'Clubhouse', area: 'Second floor', location: 'Outside elevator / stairwell', info: { type: 'ABC' }, notes: '' },
  { tag: 'FE-006', building: 'Clubhouse', area: 'Second floor', location: 'Near courtyard entrance (recessed cabinet off the lounge)', info: { type: 'ABC' }, notes: '' },
  { tag: 'FE-008', building: 'Clubhouse', area: 'Second floor', location: 'Mixed Grill (recessed cabinet in hall by bar seating)', info: { type: 'ABC', mfr: 'Amerex' }, notes: 'Cabinet door was standing open 11/9/26. Check it closes and latches.' },
  { tag: 'FE-010', building: 'Clubhouse', area: 'Second floor', location: 'Near entrance', info: { type: 'ABC' }, notes: 'Floor assumed from walk order. Confirm which entrance.' },
  { tag: 'FE-011', building: 'Clubhouse', area: 'Second floor', location: 'Adams Room', info: { type: 'ABC' }, notes: 'No service tag found 11/10/26. Needs vendor service and new tag.',
    fail: { date: '2026-11-10', failed: ['tag'], note: 'No service tag on unit. Vendor to service and tag.' } },
  { tag: 'FE-012', building: 'Clubhouse', area: 'Third floor', location: 'At the stairwell exit', info: { type: 'ABC' }, notes: '' },
  { tag: 'FE-013', building: 'Clubhouse', area: 'Second floor', location: 'Near service elevator', info: { type: 'ABC' }, notes: 'No service tag found 11/10/26. Number 13 written on the tank. Needs vendor service and new tag.',
    fail: { date: '2026-11-10', failed: ['tag'], note: 'No service tag on unit. Vendor to service and tag.' } },
  { tag: 'FE-014', building: 'Clubhouse', area: 'Third floor', location: 'Right outside Accounting', info: { type: 'ABC' }, notes: 'No service tag found 11/10/26. Needs vendor service and new tag.',
    fail: { date: '2026-11-10', failed: ['tag'], note: 'No service tag on unit. Vendor to service and tag.' } }
];
const START_GAPS = [
  { kind: 'extinguisher', building: 'Clubhouse', area: 'Lower level', location: 'New mechanical room (Commons AHU-1)', recommend: 'ABC dry chemical', note: 'No extinguisher found 11/9/26.' },
  { kind: 'extinguisher', building: 'Clubhouse', area: 'Lower level', location: 'Server room (next to the AHU-1 room)', recommend: 'Clean agent (Halotron)', note: 'No extinguisher found 11/9/26. Clean agent so powder does not reach the servers.' }
];
function loadStart() {
  const has = db.prepare('SELECT id FROM ls_devices WHERE tag=?');
  const ins = db.prepare(`INSERT INTO ls_devices (tag, kind, building, area, location, info, notes, created_by) VALUES (?,?,?,?,?,?,?, 'Walk 11/2026')`);
  const chk = db.prepare(`INSERT INTO ls_checks (device_id, done_on, pass, failed, note, by) VALUES (?,?,?,?,?,?)`);
  let n = 0;
  db.transaction(() => {
    for (const s of START) {
      if (has.get(s.tag)) continue;
      const id = ins.run(s.tag, 'extinguisher', s.building, s.area, s.location, JSON.stringify(s.info || {}), s.notes || '').lastInsertRowid;
      (s.history || []).forEach(d => chk.run(id, d, 1, '[]', 'Copied from the paper tag', 'Paper tag'));
      if (s.fail) chk.run(id, s.fail.date, 0, JSON.stringify(s.fail.failed), s.fail.note, 'Stephen Harris');
      n++;
    }
    if (!db.prepare('SELECT COUNT(*) c FROM ls_gaps').get().c) {
      const g = db.prepare('INSERT INTO ls_gaps (kind, building, area, location, recommend, note, created_by) VALUES (?,?,?,?,?,?,?)');
      START_GAPS.forEach(x => g.run(x.kind, x.building, x.area, x.location, x.recommend, x.note, 'Walk 11/2026'));
    }
  })();
  return n;
}

/* ================= state ================= */
function parse(s, d) { try { return JSON.parse(s || ''); } catch (e) { return d; } }

function deviceStatus(d, month) {
  const k = KIND[d.kind] || { checks: [], svc: 0 };
  const info = parse(d.info, {});
  const checks = db.prepare('SELECT * FROM ls_checks WHERE device_id=? ORDER BY done_on DESC, id DESC LIMIT 24').all(d.id)
    .map(c => Object.assign(c, { failed: parse(c.failed, []) }));
  const last = checks[0] || null;
  const thisMonth = checks.filter(c => c.done_on.slice(0, 7) === month);
  const yr = month.slice(0, 4);
  const punches = {};
  checks.forEach(c => { if (c.done_on.slice(0, 4) === yr) { const m = +c.done_on.slice(5, 7); punches[m] = punches[m] === 'fail' ? 'fail' : (c.pass ? 'ok' : 'fail'); } });
  // Recurring service: annual for most, semiannual for hoods.
  let svcDue = null, svcState = 'none';
  if (k.svc) {
    svcDue = info.last_annual ? addMonths(info.last_annual, k.svc) : null;
    if (!svcDue) svcState = 'unknown';
    else if (svcDue < month) svcState = 'late';
    else if (svcDue <= addMonths(month, 2)) svcState = 'soon';
    else svcState = 'ok';
  }
  // Extinguishers: hydrostatic test and 6-year maintenance by agent.
  let hydroDue = null, sixDue = null;
  if (d.kind === 'extinguisher') {
    const t = String(info.type || 'ABC');
    const hydroYrs = /co2|class k|wet|water|foam/i.test(t) ? 5 : 12;
    const six = /abc|bc|dry|halotron|clean/i.test(t);
    const base = String(info.last_hydro || info.mfg_year || '').slice(0, 4);
    if (/^\d{4}$/.test(base)) hydroDue = String(+base + hydroYrs);
    const sixBase = String(info.last_six || info.last_hydro || info.mfg_year || '').slice(0, 4);
    if (six && /^\d{4}$/.test(sixBase)) sixDue = String(+sixBase + 6);
  }
  const openWo = db.prepare(`SELECT w.id FROM ls_checks c JOIN work_orders w ON w.id=c.wo_id WHERE c.device_id=? AND w.status IN ${OPEN_SQL} ORDER BY c.id DESC LIMIT 1`).get(d.id);
  return Object.assign({}, d, {
    info, kind_label: k.label, last, done: thisMonth.length > 0,
    attention: !!(last && !last.pass), punches, svc_due: svcDue, svc_state: svcState, svc_label: k.svcLabel || '',
    hydro_due: hydroDue, six_due: sixDue, open_wo: openWo ? openWo.id : null, history: checks
  });
}

function state(month) {
  month = /^\d{4}-\d{2}$/.test(month || '') ? month : today().slice(0, 7);
  const devices = db.prepare('SELECT * FROM ls_devices WHERE active=1 ORDER BY building, area, sort, tag').all().map(d => deviceStatus(d, month));
  const areas = {};
  devices.forEach(d => { const k = d.building + '|' + d.area; areas[k] = areas[k] || { building: d.building, area: d.area, devices: 0 }; areas[k].devices++; });
  const areaChecks = db.prepare(`SELECT * FROM ls_checks WHERE device_id IS NULL AND substr(done_on,1,7)=? ORDER BY id DESC`).all(month)
    .map(c => Object.assign(c, { failed: parse(c.failed, []) }));
  Object.values(areas).forEach(a => { a.check = areaChecks.find(c => c.building === a.building && c.area === a.area) || null; });
  const gaps = db.prepare('SELECT * FROM ls_gaps WHERE resolved=0 ORDER BY created_at, id').all();
  const yr = month.slice(0, 4);
  const sum = {
    devices: devices.length,
    done: devices.filter(d => d.done).length,
    attention: devices.filter(d => d.attention).length,
    service: devices.filter(d => d.svc_state === 'late' || d.svc_state === 'soon' || (d.hydro_due && d.hydro_due <= yr) || (d.six_due && d.six_due <= yr)).length,
    gaps: gaps.length,
    areas: Object.keys(areas).length,
    areas_done: Object.values(areas).filter(a => a.check).length
  };
  return { month, today: today(), kinds: KINDS, area_checks: AREA_CHECKS, devices, areas: Object.values(areas), gaps, summary: sum };
}

/* ================= work orders from failed items ================= */
function openWorkOrder(user, { device, building, area, failedText, note }) {
  const where = device ? device.location : '';
  const title = device ? `${device.tag} ${(KIND[device.kind] || {}).label || ''}: ${failedText}` : `Life safety walk, ${area || building}: ${failedText}`;
  const info = db.prepare(`INSERT INTO work_orders (unit_id, building, location, title, description, category, priority, status, source,
      requested_by, requester_dept, due_date, created_by, created_by_id) VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(building || 'Clubhouse', [area, where].filter(Boolean).join(', '), clip(title, 160),
      `Found on the monthly life safety walk by ${user.name}.` + (note ? `\n${clip(note, 600)}` : ''),
      'Life safety', 'high', 'new', 'tech', user.name, 'Maintenance', today(), user.name, user.id > 0 ? user.id : null);
  const woId = info.lastInsertRowid;
  db.prepare(`INSERT INTO wo_notes (wo_id, kind, body, by) VALUES (?, 'status', ?, ?)`).run(woId, 'Opened automatically from the life safety walk.', user.name);
  try { ops.kick(); } catch (e) {}
  return woId;
}

/* ================= paper route sheet ================= */
function sheetHtml(opts = {}) {
  const st = state(opts.month);
  const monthName = new Date(st.month + '-15T12:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const blankRows = Math.max(0, Math.min(40, parseInt(opts.blank, 10) || 0));
  const byArea = {};
  st.devices.forEach(d => { const k = (d.building || '') + ' · ' + (d.area || ''); (byArea[k] = byArea[k] || []).push(d); });
  const box = '<span class="bx"></span>';
  // One table per kind present, so each table has that kind's own columns.
  const kindsUsed = KINDS.filter(k => st.devices.some(d => d.kind === k.key) || (opts.allKinds && k.key !== 'extinguisher'));
  let h = '';
  for (const k of kindsUsed) {
    const list = st.devices.filter(d => d.kind === k.key);
    const more = { emlight: 10, exit: 10, combo: 6, firedoor: 6, exitdoor: 6 }[k.key] || 3;
    const extra = k.key === 'extinguisher' ? blankRows : (opts.allKinds ? more : 0);
    h += `<section${list.length + extra > 14 ? '' : ' class="keep"'}><h2>${escH(k.plural || k.label + 's')} <span class="ct">${list.length ? list.length + ' on file' : 'none on file yet'}</span></h2>
<table class="grid"><thead><tr><th class="tg">Tag</th><th class="loc">Area / location</th>${k.checks.map(c => `<th class="ck">${escH(c[2])}</th>`).join('')}<th class="ini">Init.</th><th class="nt">Notes / corrective action</th></tr></thead><tbody>`;
    let lastArea = null;
    for (const d of list) {
      const ak = (d.building || '') + ' · ' + (d.area || '');
      if (ak !== lastArea) { h += `<tr class="ar"><td colspan="${k.checks.length + 4}">${escH(ak)}</td></tr>`; lastArea = ak; }
      const flag = d.attention ? ' ⚠' : '';
      h += `<tr><td class="tg"><b>${escH(d.tag)}</b>${flag}</td><td class="loc">${escH(d.location)}${d.info && d.info.type && k.key === 'extinguisher' ? `<div class="sm">${escH(d.info.type)}${d.info.size ? ' · ' + escH(d.info.size) + ' lb' : ''}</div>` : ''}</td>${k.checks.map(() => `<td class="ck">${box}</td>`).join('')}<td class="ini"></td><td class="nt"></td></tr>`;
    }
    for (let i = 0; i < extra; i++) h += `<tr class="bl"><td class="tg">${escH(k.prefix)}-</td><td class="loc"></td>${k.checks.map(() => `<td class="ck">${box}</td>`).join('')}<td class="ini"></td><td class="nt"></td></tr>`;
    h += `</tbody></table><div class="key">${k.checks.map(c => `<b>${escH(c[2])}</b> ${escH(c[1])}`).join(' &nbsp;·&nbsp; ')}</div></section>`;
  }
  // Area walk
  const areas = st.areas.length ? st.areas.map(a => (a.building || '') + ' · ' + (a.area || '')) : [];
  const areaRows = areas.concat(Array(Math.max(3, 8 - areas.length)).fill(''));
  h += `<section class="keep"><h2>Area walk-through <span class="ct">one row per area</span></h2>
<table class="grid"><thead><tr><th class="loc">Building · area</th>${AREA_CHECKS.map(c => `<th class="ck">${escH(c[2])}</th>`).join('')}<th class="ini">Init.</th><th class="nt">Notes</th></tr></thead><tbody>
${areaRows.map(a => `<tr${a ? '' : ' class="bl"'}><td class="loc">${escH(a)}</td>${AREA_CHECKS.map(() => `<td class="ck">${box}</td>`).join('')}<td class="ini"></td><td class="nt"></td></tr>`).join('')}
</tbody></table><div class="key">${AREA_CHECKS.map(c => `<b>${escH(c[2])}</b> ${escH(c[1])}`).join(' &nbsp;·&nbsp; ')}</div></section>`;
  // Missing equipment
  h += `<section class="keep"><h2>Missing or needed <span class="ct">rooms that should have a device and don't</span></h2>
<table class="grid"><thead><tr><th class="loc">Building · area · room</th><th class="nt" style="width:22%">Needs</th><th class="nt">Notes</th></tr></thead><tbody>
${st.gaps.map(g => `<tr><td class="loc">${escH([g.building, g.area, g.location].filter(Boolean).join(' · '))}</td><td class="nt">${escH(g.recommend || (KIND[g.kind] || {}).label || '')}</td><td class="nt">${escH(g.note)}</td></tr>`).join('')}
${Array(4).fill('<tr class="bl"><td class="loc"></td><td class="nt"></td><td class="nt"></td></tr>').join('')}
</tbody></table></section>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Life safety walk, ${escH(monthName)}</title><style>
*{box-sizing:border-box}
body{margin:0;background:#F3EFE5;font-family:-apple-system,"Segoe UI",Arial,sans-serif;color:#1A2436;font-size:10.5px}
.page{max-width:1100px;margin:0 auto;background:#fff;padding:22px 24px 30px}
.hd{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:3px solid #B79B5B;padding-bottom:8px;margin-bottom:6px}
.club{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#4F6F99}
h1{font-family:Georgia,serif;color:#1F3A63;margin:2px 0 0;font-size:22px}
.meta{display:grid;grid-template-columns:auto 150px;gap:4px 8px;font-size:10px;align-items:end}
.meta span{border-bottom:1px solid #1A2436;height:14px}
.how{font-size:9.5px;color:#4A5468;margin:6px 0 2px}
h2{font-family:Georgia,serif;color:#1F3A63;font-size:13.5px;margin:14px 0 4px;break-after:avoid}
h2 .ct{font-family:-apple-system,"Segoe UI",Arial,sans-serif;font-size:9px;color:#7C8494;font-weight:normal;letter-spacing:.5px;margin-left:6px}
table.grid{border-collapse:collapse;width:100%;table-layout:fixed}
.grid th,.grid td{border:1px solid #BDB5A3;padding:3px 4px;vertical-align:middle}
.grid th{background:#F4F0E6;font-size:8.5px;text-align:center;line-height:1.15;font-weight:600}
.grid tr{height:24px;break-inside:avoid}
.grid .tg{width:58px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px}
.grid .loc{width:23%;text-align:left}
.grid .ck{width:50px;text-align:center}
section.keep{break-inside:avoid}
.grid .ini{width:36px}
.grid .nt{text-align:left}
.grid tr.ar td{background:#1F3A63;color:#fff;font-size:8.5px;letter-spacing:1.4px;text-transform:uppercase;height:auto;padding:2px 5px}
.grid tr.bl .tg{color:#9AA0AB}
.sm{font-size:8.5px;color:#6A7282}
.bx{display:inline-block;width:12px;height:12px;border:1.3px solid #1A2436;border-radius:2px;vertical-align:middle}
.key{font-size:8.5px;color:#4A5468;margin:3px 0 0;line-height:1.45}
.foot{margin-top:14px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;font-size:10px}
.foot div{border-top:1px solid #1A2436;padding-top:3px}
.bar{position:sticky;top:0;background:#1F3A63;padding:10px;text-align:center}
.bar button{background:#D8BE7C;border:0;color:#1F3A63;font-weight:bold;padding:9px 18px;border-radius:3px;font-size:14px;cursor:pointer}
@media print{body{background:#fff}.bar{display:none}.page{padding:0;max-width:none}@page{size:letter landscape;margin:.4in}}
</style></head><body>
${opts.noBar ? '' : '<div class="bar"><button onclick="window.print()">Print or save PDF</button></div>'}<div class="page">
<div class="hd"><div><div class="club">The Country Club of Little Rock · Facilities</div><h1>Monthly Life Safety Walk</h1></div>
<div class="meta"><b>Month</b><span>${opts.blankMonth ? '' : escH(monthName)}</span><b>Inspector</b><span></span><b>Date(s)</b><span></span></div></div>
<div class="how">Check the box when the item passes. Write <b>X</b> in the box when it fails and note what you did. Every X gets a work order. Enter the sheet in Clubhouse IQ, Life safety tab, when the walk is done. ⚠ = failed last month.</div>
${h}
<div class="foot keep"><div>Inspector signature</div><div>Reviewed by (Director of Facilities)</div><div>Date entered in Clubhouse IQ</div></div>
</div></body></html>`;
}

/* ================= routes ================= */
function mount(app, auth) {
  try { const n = loadStart(); if (n) console.log(`  Added ${n} fire extinguisher(s) from the November walk.`); }
  catch (e) { console.log('  Could not load the life safety start list: ' + e.message); }

  const need = (req, res) => { if (!canWork(req.user)) { res.status(403).json({ error: 'Only maintenance can change the life safety walk' }); return false; } return true; };

  app.get('/api/ls', auth, (req, res) => res.json(state(req.query.month)));
  app.get('/api/ls/sheet', auth, (req, res) => res.json({ html: sheetHtml({ month: req.query.month, blank: req.query.blank || 6, allKinds: req.query.all === '1', blankMonth: req.query.blankmonth === '1' }) }));

  app.post('/api/ls/devices', auth, (req, res) => {
    if (!need(req, res)) return;
    const b = req.body || {};
    const kind = KIND[b.kind] ? b.kind : 'extinguisher';
    const tag = clip(b.tag, 20).toUpperCase();
    if (!tag) return res.status(400).json({ error: 'Give it a tag, like FE-013 or EL-004' });
    const info = {};
    ['type', 'size', 'mfr', 'serial', 'mfg_year', 'last_annual', 'last_hydro', 'last_six', 'vendor', 'battery_date', 'pads_date']
      .forEach(f => { if (b.info && b.info[f] != null && String(b.info[f]).trim()) info[f] = clip(b.info[f], 60); });
    const clash = db.prepare('SELECT id FROM ls_devices WHERE tag=? AND id<>?').get(tag, b.id || 0);
    if (clash) return res.status(400).json({ error: tag + ' is already used' });
    if (b.id) {
      db.prepare(`UPDATE ls_devices SET tag=?, kind=?, building=?, area=?, location=?, info=?, notes=?, active=1, updated_at=datetime('now') WHERE id=?`)
        .run(tag, kind, clip(b.building, 60), clip(b.area, 60), clip(b.location, 160), JSON.stringify(info), clip(b.notes, 800), b.id);
    } else {
      db.prepare(`INSERT INTO ls_devices (tag, kind, building, area, location, info, notes, created_by) VALUES (?,?,?,?,?,?,?,?)`)
        .run(tag, kind, clip(b.building, 60), clip(b.area, 60), clip(b.location, 160), JSON.stringify(info), clip(b.notes, 800), req.user.name);
    }
    res.json(state());
  });
  app.delete('/api/ls/devices/:id', auth, (req, res) => {
    if (!need(req, res)) return;
    db.prepare(`UPDATE ls_devices SET active=0, updated_at=datetime('now') WHERE id=?`).run(req.params.id);
    res.json(state());
  });

  // A monthly check on one device, or the area walk-through when no device_id.
  app.post('/api/ls/checks', auth, (req, res) => {
    if (!need(req, res)) return;
    const b = req.body || {};
    const done = isDate(b.date) ? b.date : today();
    let device = null, list = AREA_CHECKS, building = clip(b.building, 60), area = clip(b.area, 60);
    if (b.device_id) {
      device = db.prepare('SELECT * FROM ls_devices WHERE id=?').get(b.device_id);
      if (!device) return res.status(404).json({ error: 'Unknown device' });
      list = (KIND[device.kind] || { checks: [] }).checks; building = device.building; area = device.area;
    }
    const keys = list.map(c => c[0]);
    const failed = (Array.isArray(b.failed) ? b.failed : []).filter(k => keys.includes(k));
    const note = clip(b.note, 800);
    if (failed.length && !note) return res.status(400).json({ error: 'Say what was wrong or what you did about the failed item' });
    let woId = null;
    if (failed.length) {
      const prior = device
        ? db.prepare(`SELECT w.id FROM ls_checks c JOIN work_orders w ON w.id=c.wo_id WHERE c.device_id=? AND w.status IN ${OPEN_SQL} ORDER BY c.id DESC LIMIT 1`).get(device.id)
        : db.prepare(`SELECT w.id FROM ls_checks c JOIN work_orders w ON w.id=c.wo_id WHERE c.device_id IS NULL AND c.building=? AND c.area=? AND w.status IN ${OPEN_SQL} ORDER BY c.id DESC LIMIT 1`).get(building, area);
      const failedText = failed.map(k => (list.find(c => c[0] === k) || [k, k, k])[2]).join(', ');
      if (prior) {
        woId = prior.id;
        db.prepare(`INSERT INTO wo_notes (wo_id, kind, body, by) VALUES (?, 'note', ?, ?)`).run(woId, `Still failing on the ${done} walk: ${failedText}. ${note}`, req.user.name);
      } else woId = openWorkOrder(req.user, { device, building, area, failedText, note });
    }
    db.prepare(`INSERT INTO ls_checks (device_id, building, area, done_on, pass, failed, reading, note, wo_id, by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(device ? device.id : null, building, area, done, failed.length ? 0 : 1, JSON.stringify(failed), clip(b.reading, 60), note, woId, req.user.name);
    res.json({ ok: !failed.length, wo_id: woId, state: state() });
  });
  app.delete('/api/ls/checks/:id', auth, (req, res) => {
    if (!isMgr(req.user)) return res.status(403).json({ error: 'Only a manager can remove a check' });
    db.prepare('DELETE FROM ls_checks WHERE id=?').run(req.params.id); res.json(state());
  });

  app.post('/api/ls/gaps', auth, (req, res) => {
    if (!need(req, res)) return;
    const b = req.body || {};
    if (!clip(b.location, 160)) return res.status(400).json({ error: 'Say which room or spot' });
    db.prepare('INSERT INTO ls_gaps (kind, building, area, location, recommend, note, created_by) VALUES (?,?,?,?,?,?,?)')
      .run(KIND[b.kind] ? b.kind : 'extinguisher', clip(b.building, 60), clip(b.area, 60), clip(b.location, 160), clip(b.recommend, 80), clip(b.note, 400), req.user.name);
    res.json(state());
  });
  app.post('/api/ls/gaps/:id/resolve', auth, (req, res) => {
    if (!need(req, res)) return;
    db.prepare(`UPDATE ls_gaps SET resolved=1, resolved_at=datetime('now') WHERE id=?`).run(req.params.id);
    res.json(state());
  });
}

module.exports = { mount, KINDS, AREA_CHECKS, state, sheetHtml, loadStart };
