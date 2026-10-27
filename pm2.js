/**
 * Preventive maintenance, second generation.
 *
 *  1. Readings      Checklist lines ending in [unit range] take a number. A value
 *                   outside the range opens a repair work order on its own, and
 *                   every reading is kept so it can be charted over time.
 *  2. Rounds        PM work grouped into walks by location (attic right side,
 *                   boiler room...). Each unit gets a QR tag that opens its PM.
 *  3. Parts kits    Each PM can carry the parts it uses. Kits pre-fill the
 *                   close-out form and add up into a shopping list.
 *  4. Triggers      Calendar (every N days), seasonal (a set date each year), or
 *                   run hours (every N hours, with the day count as a backstop).
 *  5. Shutdowns     PM that needs the unit off is moved off no-work event days
 *                   and carries the hours it can be done in.
 *  6. Scorecard     On-time rate, planned vs reactive work, and readings out of
 *                   range, for the PM screen and the monthly report.
 *
 * workorders.js calls the hooks at the bottom of the PM life cycle (open,
 * complete). Routes are mounted from server.js with mount(app, auth).
 */
const { db } = require('./db');

const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
function addDays(dateStr, n) {
  const d = new Date((dateStr || today()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / DAY);
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const OPEN_SQL = `('new','open','in_progress','on_hold')`;

/* ================= schema ================= */
function addCol(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addCol('pm_tasks', 'trigger_type', `trigger_type TEXT DEFAULT 'calendar'`);
addCol('pm_tasks', 'run_hours', `run_hours REAL DEFAULT 0`);
addCol('pm_tasks', 'run_base', `run_base REAL`);
addCol('pm_tasks', 'season', `season TEXT DEFAULT ''`);
addCol('pm_tasks', 'needs_shutdown', `needs_shutdown INTEGER DEFAULT 0`);
addCol('pm_tasks', 'kit', `kit TEXT DEFAULT '[]'`);
addCol('units', 'route', `route TEXT DEFAULT ''`);
addCol('units', 'route_order', `route_order INTEGER DEFAULT 0`);
addCol('units', 'runtime_hours', `runtime_hours REAL`);
addCol('units', 'runtime_at', `runtime_at TEXT`);
addCol('work_orders', 'reading_id', `reading_id INTEGER`);

db.exec(`
CREATE TABLE IF NOT EXISTS pm_readings (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  pm_id   INTEGER,
  wo_id   INTEGER,
  unit_id INTEGER,
  step    TEXT NOT NULL,
  value   REAL NOT NULL,
  uom     TEXT DEFAULT '',
  lo      REAL,
  hi      REAL,
  ok      INTEGER NOT NULL DEFAULT 1,
  by      TEXT DEFAULT '',
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rd_unit ON pm_readings(unit_id, step);
CREATE INDEX IF NOT EXISTS idx_rd_pm ON pm_readings(pm_id);

CREATE TABLE IF NOT EXISTS runtime_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  hours   REAL NOT NULL,
  source  TEXT DEFAULT 'manual',
  by      TEXT DEFAULT '',
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_unit ON runtime_log(unit_id);

-- Hours a building is in use. Work that needs equipment shut down goes
-- outside these hours, and never on a no-work event day.
CREATE TABLE IF NOT EXISTS shutdown_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  building   TEXT NOT NULL,
  days       TEXT NOT NULL DEFAULT '0123456',
  start_time TEXT NOT NULL DEFAULT '06:00',
  end_time   TEXT NOT NULL DEFAULT '22:00',
  note       TEXT DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1
);
`);

// Club hours to start from. Edit them on the PM screen.
if (!db.prepare('SELECT COUNT(*) c FROM shutdown_rules').get().c) {
  const ins = db.prepare('INSERT INTO shutdown_rules (building, days, start_time, end_time, note) VALUES (?,?,?,?,?)');
  ins.run('Clubhouse', '0123456', '06:00', '23:00', 'Club open. Starting point; set to the real hours.');
  ins.run('Golf Shop', '0123456', '06:30', '19:00', 'Shop open. Starting point; set to the real hours.');
  ins.run('Indoor Tennis Center', '0123456', '06:00', '21:00', 'Courts open. Starting point; set to the real hours.');
}

/* ================= 1. readings ================= */
// "CHW leaving temp [°F 42-48]" -> { label, reading: true, uom: '°F', lo: 42, hi: 48 }
function parseStep(line) {
  const raw = String(line || '').trim();
  const m = raw.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
  if (!m) return { label: raw, line: raw, reading: false };
  let inner = m[2].trim();
  // Only a unit and/or a range makes a reading. "[MERV 8]" is just a note.
  const hasRange = /\d\s*(?:-|–|to)\s*-?\d|\b(?:max|min|under|over|below|above)\s*-?\d|[<>]=?\s*-?\d/i.test(inner);
  if (!hasRange && (/\d/.test(inner) || inner.length > 14)) return { label: raw, line: raw, reading: false };
  let lo = null, hi = null;
  const N = '(-?\\d+(?:\\.\\d+)?)';
  let r = inner.match(new RegExp(N + '\\s*(?:-|–|to)\\s*' + N));
  if (r) { lo = +r[1]; hi = +r[2]; inner = inner.replace(r[0], ' '); }
  r = inner.match(new RegExp('(?:max|<=?|under|below)\\s*' + N, 'i'));
  if (r) { hi = +r[1]; inner = inner.replace(r[0], ' '); }
  r = inner.match(new RegExp('(?:min|>=?|over|above)\\s*' + N, 'i'));
  if (r) { lo = +r[1]; inner = inner.replace(r[0], ' '); }
  let uom = inner.replace(/\s+/g, ' ').trim();
  if (/^reading$/i.test(uom)) uom = '';
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  return { label: m[1].trim(), line: raw, reading: true, uom, lo, hi };
}
function parseChecklist(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean).map(parseStep);
}
const rangeText = s => s.lo != null && s.hi != null ? `${s.lo} to ${s.hi}` : s.hi != null ? `max ${s.hi}` : s.lo != null ? `min ${s.lo}` : '';
const inRange = (s, v) => !((s.lo != null && v < s.lo) || (s.hi != null && v > s.hi));

// Pull the readings that belong to this PM out of a close-out body.
function readingsFrom(pm, body) {
  const given = Array.isArray(body && body.readings) ? body.readings : [];
  if (!pm || !given.length) return [];
  const steps = parseChecklist(pm.checklist).filter(s => s.reading);
  const out = [];
  for (const g of given) {
    const s = steps.find(x => x.label === clip(g.step, 200));
    const v = num(g.value);
    if (!s || v == null) continue;
    out.push({ step: s, value: v, ok: inRange(s, v) });
  }
  return out;
}

function readingsText(w, body) {
  if (!w.pm_id) return '';
  const pm = db.prepare('SELECT checklist FROM pm_tasks WHERE id=?').get(w.pm_id);
  return readingsFrom(pm, body).map(r => `${r.step.label} ${r.value}${r.step.uom ? ' ' + r.step.uom : ''}${r.ok ? '' : ' (OUT OF RANGE ' + rangeText(r.step) + ')'}`).join('; ');
}

function saveReadings(w, pm, body, userName, addNote) {
  const list = readingsFrom(pm, body);
  if (!list.length) return [];
  const ins = db.prepare(`INSERT INTO pm_readings (pm_id, wo_id, unit_id, step, value, uom, lo, hi, ok, by) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const opened = [];
  for (const r of list) {
    const info = ins.run(pm.id, w.id, w.unit_id, r.step.label, r.value, r.step.uom, r.step.lo, r.step.hi, r.ok ? 1 : 0, userName);
    if (r.ok) continue;
    const tag = w.apt || (w.unit_id ? (db.prepare('SELECT apt FROM units WHERE id=?').get(w.unit_id) || {}).apt : '');
    const title = `Out of range: ${r.step.label}${tag ? ' (' + tag + ')' : ''}`.slice(0, 160);
    const desc = `${r.step.label} read ${r.value}${r.step.uom ? ' ' + r.step.uom : ''} during PM "${pm.title}" (work order #${w.id}). ` +
      `Expected ${rangeText(r.step)}${r.step.uom ? ' ' + r.step.uom : ''}. Find out why and fix it, or correct the range on the PM if it is wrong.`;
    const wo = db.prepare(`INSERT INTO work_orders (unit_id, building, title, description, category, priority, status, source, due_date, created_by, reading_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(w.unit_id, w.building || '', title, desc, w.category || 'HVAC', 'high', 'open', 'reading',
      addDays(today(), 1), 'PM reading', info.lastInsertRowid);
    addNote(wo.lastInsertRowid, `Opened automatically from a PM reading on work order #${w.id}.`, 'PM reading', 'status');
    addNote(w.id, `${r.step.label} out of range. Opened work order #${wo.lastInsertRowid}.`, userName, 'status');
    opened.push(wo.lastInsertRowid);
  }
  return opened;
}

function readingSeries(unitId, days = 365) {
  const rows = db.prepare(`SELECT step, value, uom, lo, hi, ok, at, wo_id FROM pm_readings
    WHERE unit_id=? AND date(at) >= date('now', ?) ORDER BY at`).all(unitId, `-${days} days`);
  const by = {};
  rows.forEach(r => {
    const s = by[r.step] || (by[r.step] = { step: r.step, uom: r.uom, lo: r.lo, hi: r.hi, points: [] });
    s.points.push({ at: r.at, v: r.value, ok: !!r.ok, wo: r.wo_id });
    s.uom = r.uom; s.lo = r.lo; s.hi = r.hi; // latest range wins
  });
  return Object.values(by).map(s => {
    const vals = s.points.map(p => p.v);
    const last = s.points[s.points.length - 1];
    // Simple drift check: compare the latest value with the average of the ones before it.
    let drift = null;
    if (s.points.length >= 4) {
      const prev = vals.slice(0, -1), avg = prev.reduce((a, b) => a + b, 0) / prev.length;
      const span = (s.hi != null && s.lo != null) ? (s.hi - s.lo) : Math.max(Math.abs(avg) * 0.2, 1);
      const d = last.v - avg;
      if (Math.abs(d) >= span * 0.4) drift = d > 0 ? 'up' : 'down';
    }
    return Object.assign(s, { last: last.v, last_at: last.at, out: s.points.filter(p => !p.ok).length, drift });
  }).sort((a, b) => (b.out - a.out) || a.step.localeCompare(b.step));
}

/* ================= 4. triggers ================= */
// Next date that matches MM-DD and is at least `gap` days after `from`.
function nextSeason(mmdd, from, gap = 0) {
  if (!/^\d{2}-\d{2}$/.test(mmdd || '')) return addDays(from, 365);
  const base = from || today();
  let y = +base.slice(0, 4);
  for (let i = 0; i < 3; i++, y++) {
    const d = `${y}-${mmdd}`;
    if (isDate(d) && daysBetween(base, d) >= gap) return d;
  }
  return addDays(base, 365);
}

// Average run hours per day from the meter readings, last 120 days.
function runRate(unitId) {
  const r = db.prepare(`SELECT MIN(at) a0, MAX(at) a1, MIN(hours) h0, MAX(hours) h1, COUNT(*) n FROM runtime_log
    WHERE unit_id=? AND date(at) >= date('now','-120 days')`).get(unitId);
  if (!r || r.n < 2) return null;
  const days = (new Date(r.a1.replace(' ', 'T') + 'Z') - new Date(r.a0.replace(' ', 'T') + 'Z')) / DAY;
  if (days < 1) return null;
  const rate = (r.h1 - r.h0) / days;
  return rate > 0 ? Math.min(rate, 24) : null;
}

function runtimeStatus(pm) {
  if (pm.trigger_type !== 'runtime' || !pm.unit_id || !(pm.run_hours > 0)) return null;
  const u = db.prepare('SELECT runtime_hours, runtime_at FROM units WHERE id=?').get(pm.unit_id) || {};
  if (u.runtime_hours == null) return { meter: null, used: null, left: null, rate: null };
  const base = pm.run_base == null ? u.runtime_hours : pm.run_base;
  const used = Math.max(0, u.runtime_hours - base);
  const left = pm.run_hours - used;
  const rate = runRate(pm.unit_id);
  return { meter: u.runtime_hours, meter_at: u.runtime_at, used: Math.round(used), left: Math.round(left), rate: rate == null ? null : Math.round(rate * 10) / 10 };
}

// Run-hour PMs: pull next_due in when the meter says they are due, or to the
// date the hours will run out at the current rate. The day count stays as a
// backstop, so a unit whose meter nobody reads still gets serviced.
function beforeEnsure() {
  const list = db.prepare(`SELECT * FROM pm_tasks WHERE active=1 AND trigger_type='runtime' AND run_hours > 0 AND unit_id IS NOT NULL`).all();
  const upd = db.prepare('UPDATE pm_tasks SET next_due=? WHERE id=?');
  const t = today();
  for (const p of list) {
    const st = runtimeStatus(p);
    if (!st || st.meter == null) continue;
    if (p.run_base == null) db.prepare('UPDATE pm_tasks SET run_base=? WHERE id=?').run(st.meter, p.id);
    const backstop = p.last_done ? addDays(p.last_done, p.freq_days) : p.next_due;
    let due;
    if (st.left <= p.run_hours * 0.05) due = t;
    else if (st.rate) due = addDays(t, Math.max(0, Math.floor(st.left / st.rate)));
    else continue;
    const next = due < backstop ? due : backstop;
    if (next !== p.next_due) upd.run(next, p.id);
  }
}

function repeatText(p) {
  if (p.trigger_type === 'seasonal' && p.season) return 'yearly around ' + seasonLabel(p.season);
  if (p.trigger_type === 'runtime' && p.run_hours > 0) return `every ${p.run_hours} run hours or ${p.freq_days} days, whichever comes first`;
  return `repeats every ${p.freq_days} days`;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const seasonLabel = s => /^\d{2}-\d{2}$/.test(s || '') ? `${MON[+s.slice(0, 2) - 1]} ${+s.slice(3)}` : '';

function logRuntime(unitId, hours, by, source = 'manual', reset = false) {
  const h = num(hours);
  if (h == null || h < 0 || h > 1e7) return 'Enter the hour meter reading as a number';
  const u = db.prepare('SELECT runtime_hours FROM units WHERE id=?').get(unitId);
  if (!u) return 'Equipment not found';
  if (u.runtime_hours != null && h < u.runtime_hours - 0.5) {
    if (!reset) return `That is lower than the last reading (${u.runtime_hours}). If the meter was replaced or reset, check "Meter was reset" and save again.`;
    // Keep the hours already run since each PM's last service.
    db.prepare(`UPDATE pm_tasks SET run_base = ? - (? - COALESCE(run_base, ?)) WHERE unit_id=? AND trigger_type='runtime'`)
      .run(h, u.runtime_hours, u.runtime_hours, unitId);
    db.prepare(`DELETE FROM runtime_log WHERE unit_id=?`).run(unitId); // old meter's numbers would wreck the rate
    source = 'reset';
  }
  db.prepare('INSERT INTO runtime_log (unit_id, hours, source, by) VALUES (?,?,?,?)').run(unitId, h, source, by || '');
  db.prepare(`UPDATE units SET runtime_hours=?, runtime_at=datetime('now') WHERE id=?`).run(h, unitId);
  return null;
}

/* ================= 5. shutdown windows ================= */
function noWorkEvent(date, building) {
  const evs = db.prepare(`SELECT id, title, buildings FROM events WHERE no_work=1 AND date(start_date) <= date(?) AND date(end_date) >= date(?)`).all(date, date);
  return evs.find(e => !e.buildings || !building || e.buildings.toLowerCase().split(',').map(s => s.trim()).includes(String(building).toLowerCase())) || null;
}
function to12(t) {
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
// What hours on this date the unit can be shut down.
function windowText(date, building) {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  const rules = db.prepare('SELECT * FROM shutdown_rules WHERE active=1 AND lower(building)=lower(?)').all(building || '')
    .filter(r => String(r.days).includes(String(dow)));
  if (!rules.length) return building ? `No club hours set for ${building}. Check with the department before shutting it down.` : 'Check with the department before shutting it down.';
  const s = rules.map(r => r.start_time).sort()[0], e = rules.map(r => r.end_time).sort().slice(-1)[0];
  return `Shut down before ${to12(s)} or after ${to12(e)}.`;
}
// Next few days the unit can come down, starting at `from`.
function shutdownWindows(building, from, count = 5) {
  const out = [];
  for (let i = 0, d = from || today(); out.length < count && i < 60; i++, d = addDays(d, 1)) {
    const ev = noWorkEvent(d, building);
    if (ev) continue;
    out.push({ date: d, text: windowText(d, building) });
  }
  return out;
}
function firstClearDay(building, from) {
  for (let i = 0, d = from; i < 60; i++, d = addDays(d, 1)) if (!noWorkEvent(d, building)) return d;
  return from;
}

// A PM work order was just opened. Shutdown work gets moved off no-work days
// and a note saying when it can be done.
function opened(woId, p, addNote) {
  if (!p.needs_shutdown) return;
  const w = db.prepare(`SELECT w.due_date, COALESCE(NULLIF(w.building,''), u.building, '') b FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id WHERE w.id=?`).get(woId);
  if (!w) return;
  let due = w.due_date || today();
  const ev = noWorkEvent(due, w.b);
  if (ev) {
    due = firstClearDay(w.b, due);
    db.prepare('UPDATE work_orders SET due_date=? WHERE id=?').run(due, woId);
    addNote(woId, `Moved to ${due}: ${ev.title} is a no-work day for ${w.b || 'the club'}.`, 'PM schedule', 'status');
  }
  addNote(woId, `Needs the unit shut down. ${windowText(due, w.b)}`, 'PM schedule', 'status');
}

/* ================= 3. parts kits ================= */
function kitOf(pm) {
  let k = [];
  try { k = JSON.parse(pm.kit || '[]'); } catch (e) { k = []; }
  if (!Array.isArray(k)) return [];
  const ids = k.map(x => parseInt(x.part_id, 10)).filter(Boolean);
  if (!ids.length) return [];
  const parts = db.prepare(`SELECT id, name, uom, on_hand, unit_cost, location FROM parts WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return k.map(x => {
    const p = parts.find(pp => pp.id === parseInt(x.part_id, 10));
    return p ? { part_id: p.id, qty: num(x.qty) || 1, name: p.name, uom: p.uom, on_hand: p.on_hand, cost: p.unit_cost, location: p.location } : null;
  }).filter(Boolean);
}

// Filter size like 16x24x2 and a count, from what was typed on the record.
function filterSpec(meta) {
  const txt = String((meta && (meta.filter_size || meta.filters)) || '');
  const m = txt.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const [a, b] = [+m[1], +m[2]].sort((x, y) => x - y);
  const size = `${a}x${b}x${+m[3]}`;
  const rest = txt.replace(m[0], ' ');
  const c = rest.match(/(?:^|[^\d.])(\d{1,2})(?:\s*(?:ea|each|pcs?|filters?|ct|count))?(?![\d.x])/i);
  return { size, count: c ? Math.max(1, +c[1]) : 1 };
}
function beltSpec(meta) {
  const txt = String((meta && meta.belt) || '');
  const m = txt.match(/\b([AB]X?|[345]L|[358]V[X]?)\s*-?\s*(\d{2,3})\b/i);
  if (!m) return null;
  const c = txt.replace(m[0], ' ').match(/(?:x|qty|×)\s*(\d)|\b(\d)\s*(?:belts?|ea)\b/i);
  return { size: (m[1] + m[2]).toUpperCase(), count: c ? +(c[1] || c[2]) : 1 };
}
function findOrCreatePart(name, test, category, fits) {
  let p = db.prepare('SELECT * FROM parts WHERE active=1').all().find(test);
  if (p) return { part: p, created: false };
  const info = db.prepare(`INSERT INTO parts (name, category, uom, on_hand, min_qty, reorder_qty, unit_cost, fits, location, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(name, category, 'ea', 0, 0, 0, 0, fits, '', 'Added by PM kit setup. Set cost, minimum, and vendor.');
  return { part: db.prepare('SELECT * FROM parts WHERE id=?').get(info.lastInsertRowid), created: true };
}
// Fill in kits for filter and belt PMs from the sizes typed on each unit.
function suggestKits() {
  const pms = db.prepare(`SELECT p.*, u.apt, u.system_meta FROM pm_tasks p JOIN units u ON u.id=p.unit_id WHERE p.active=1`).all();
  let set = 0, created = 0;
  const missing = new Set();
  for (const p of pms) {
    if (kitOf(p).length) continue;
    let meta = {};
    try { meta = JSON.parse(p.system_meta || '{}'); } catch (e) {}
    const kit = [];
    if (/filter/i.test(p.title) && !/water filter/i.test(p.title)) {
      const f = filterSpec(meta);
      if (!f) { missing.add(p.apt + ' filter size'); continue; }
      const [a, b, c] = f.size.split('x');
      const re = new RegExp(`\\b(${a}\\s*x\\s*${b}|${b}\\s*x\\s*${a})\\s*x\\s*${c}\\b`, 'i');
      const r = findOrCreatePart(`Pleated filter ${f.size} MERV 8`, pp => re.test(pp.name), 'Filters', p.apt);
      if (r.created) created++;
      kit.push({ part_id: r.part.id, qty: f.count });
    }
    if (/belt/i.test(p.title)) {
      const b = beltSpec(meta);
      if (!b) { missing.add(p.apt + ' belt size'); continue; }
      const re = new RegExp(`\\b${b.size}\\b`, 'i');
      const r = findOrCreatePart(`V-belt ${b.size}`, pp => re.test(pp.name), 'Belts', p.apt);
      if (r.created) created++;
      kit.push({ part_id: r.part.id, qty: b.count });
    }
    if (kit.length) { db.prepare('UPDATE pm_tasks SET kit=? WHERE id=?').run(JSON.stringify(kit), p.id); set++; }
  }
  return { set, created, missing: [...missing].sort() };
}

// Parts the PM coming due will use, against what is on the shelf.
function kitNeeds(days = 30) {
  const until = addDays(today(), days);
  const pms = db.prepare(`SELECT p.*, u.apt FROM pm_tasks p LEFT JOIN units u ON u.id=p.unit_id
    WHERE p.active=1 AND kit IS NOT NULL AND kit != '[]' AND (date(p.next_due) <= date(?) OR EXISTS
      (SELECT 1 FROM work_orders w WHERE w.pm_id=p.id AND w.status IN ${OPEN_SQL}))`).all(until);
  const by = {};
  for (const p of pms) {
    // A yearly PM that is due once in the window counts once; a weekly one counts for each time it comes up.
    const times = p.freq_days >= days ? 1 : Math.max(1, Math.ceil((daysBetween(today(), until) - Math.max(0, daysBetween(today(), p.next_due))) / p.freq_days));
    for (const k of kitOf(p)) {
      const r = by[k.part_id] || (by[k.part_id] = { part_id: k.part_id, name: k.name, uom: k.uom, on_hand: k.on_hand, cost: k.cost, location: k.location, need: 0, uses: [] });
      r.need += k.qty * times;
      r.uses.push(`${p.apt || p.title} (${p.next_due})`);
    }
  }
  const ids = Object.keys(by);
  const vend = ids.length ? db.prepare(`SELECT p.id, v.name vendor FROM parts p LEFT JOIN vendors v ON v.id=p.vendor_id WHERE p.id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  return Object.values(by).map(r => {
    const short = Math.max(0, Math.round((r.need - r.on_hand) * 100) / 100);
    return Object.assign(r, { short, vendor: (vend.find(v => v.id === r.part_id) || {}).vendor || '', est: Math.round(short * r.cost * 100) / 100 });
  }).sort((a, b) => (b.short > 0) - (a.short > 0) || (a.vendor || 'zz').localeCompare(b.vendor || 'zz') || a.name.localeCompare(b.name));
}

/* ================= 2. rounds ================= */
function derivedRoute(u) {
  let meta = {};
  try { meta = typeof u.system_meta === 'object' ? (u.system_meta || {}) : JSON.parse(u.system_meta || '{}'); } catch (e) {}
  let loc = String(meta.location || '').split('.')[0].trim();
  loc = loc.replace(/\bon the right\b/i, 'right side').replace(/\bon the left\b/i, 'left side');
  loc = loc.split(',').slice(0, 2).map(s => s.trim()).filter(Boolean).join(', ');
  loc = loc.charAt(0).toUpperCase() + loc.slice(1);
  const b = u.building || 'No building';
  return loc ? `${b} · ${loc}` : b;
}
const routeOf = u => clip(u.route, 80) || derivedRoute(u);

function rounds(days = 7) {
  const until = addDays(today(), days);
  const rows = db.prepare(`
    SELECT w.id, w.title, w.due_date, w.status, w.assigned_to, w.pm_id, p.needs_shutdown, p.kit, p.checklist, p.title pm_title,
           u.id unit_id, u.apt, u.building, u.system_type, u.system_meta, u.route, u.route_order
    FROM work_orders w JOIN pm_tasks p ON p.id=w.pm_id LEFT JOIN units u ON u.id=w.unit_id
    WHERE w.source='pm' AND w.status IN ${OPEN_SQL} AND (w.due_date IS NULL OR date(w.due_date) <= date(?))
    ORDER BY u.route_order, u.apt, date(w.due_date)`).all(until);
  const t = today();
  const routes = {};
  for (const r of rows) {
    const name = r.unit_id ? routeOf(r) : (r.building || 'No equipment tag');
    const R = routes[name] || (routes[name] = { name, building: r.building || '', stops: {}, count: 0, late: 0, shutdown: 0, parts: {} });
    const key = r.unit_id || 'x' + r.id;
    let meta = {};
    try { meta = JSON.parse(r.system_meta || '{}'); } catch (e) {}
    const S = R.stops[key] || (R.stops[key] = { unit_id: r.unit_id, apt: r.apt || '', type: r.system_type || '', order: r.route_order || 0,
      location: meta.location || '', serves: meta.serves || '', wos: [] });
    const steps = parseChecklist(r.checklist);
    S.wos.push({ id: r.id, title: r.pm_title || r.title, due_date: r.due_date, late: !!(r.due_date && r.due_date < t),
      shutdown: !!r.needs_shutdown, readings: steps.filter(s => s.reading).length, steps: steps.length, assigned_to: r.assigned_to });
    R.count++; if (r.due_date && r.due_date < t) R.late++; if (r.needs_shutdown) R.shutdown++;
    for (const k of kitOf(r)) {
      const P = R.parts[k.part_id] || (R.parts[k.part_id] = { name: k.name, uom: k.uom, qty: 0, on_hand: k.on_hand, location: k.location });
      P.qty += k.qty;
    }
  }
  return Object.values(routes).map(R => Object.assign(R, {
    stops: Object.values(R.stops).sort((a, b) => (a.order - b.order) || a.apt.localeCompare(b.apt, undefined, { numeric: true })),
    parts: Object.values(R.parts)
  })).sort((a, b) => b.late - a.late || a.name.localeCompare(b.name));
}

/* ================= 6. scorecard ================= */
function scorecard(start, end) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const IN = c => `date(${c}) >= date(?) AND date(${c}) < date(?)`;
  const pm = one(`SELECT COUNT(*) n,
      SUM(CASE WHEN date(completed_at) <= date(due_date) THEN 1 ELSE 0 END) on_time,
      AVG(CASE WHEN date(completed_at) > date(due_date) THEN julianday(date(completed_at)) - julianday(date(due_date)) END) late_days
    FROM work_orders WHERE source='pm' AND status='done' AND ${IN('completed_at')}`, start, end);
  const work = one(`SELECT
      SUM(CASE WHEN source='pm' THEN 1 ELSE 0 END) planned_n,
      SUM(CASE WHEN source!='pm' THEN 1 ELSE 0 END) reactive_n,
      COALESCE(SUM(CASE WHEN source='pm' THEN hours END),0) planned_h,
      COALESCE(SUM(CASE WHEN source!='pm' THEN hours END),0) reactive_h
    FROM work_orders WHERE status='done' AND ${IN('completed_at')}`, start, end);
  const rd = one(`SELECT COUNT(*) n, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) out FROM pm_readings WHERE ${IN('at')}`, start, end);
  const fromReadings = one(`SELECT COUNT(*) n FROM work_orders WHERE source='reading' AND ${IN('created_at')}`, start, end).n;
  const n = pm.n || 0, pn = work.planned_n || 0, rn = work.reactive_n || 0;
  const ph = work.planned_h || 0, rh = work.reactive_h || 0;
  return {
    pm_done: n, on_time: pm.on_time || 0, on_time_pct: n ? Math.round(100 * (pm.on_time || 0) / n) : null,
    avg_days_late: pm.late_days == null ? null : Math.round(pm.late_days * 10) / 10,
    planned: pn, reactive: rn, planned_pct: pn + rn ? Math.round(100 * pn / (pn + rn)) : null,
    planned_hours: Math.round(ph * 10) / 10, reactive_hours: Math.round(rh * 10) / 10,
    planned_hours_pct: ph + rh ? Math.round(100 * ph / (ph + rh)) : null,
    readings: rd.n || 0, out_of_range: rd.out || 0, repairs_from_readings: fromReadings
  };
}
function scorecardFull(days = 90) {
  const t = today(), start = addDays(t, -days), end = addDays(t, 1);
  const s = scorecard(start, end);
  s.days = days;
  s.overdue = db.prepare(`SELECT p.id, p.title, p.next_due, u.apt, COALESCE(NULLIF(p.building,''), u.building, '') building
    FROM pm_tasks p LEFT JOIN units u ON u.id=p.unit_id WHERE p.active=1 AND date(p.next_due) < date(?) ORDER BY date(p.next_due) LIMIT 15`).all(t);
  s.overdue_count = db.prepare('SELECT COUNT(*) n FROM pm_tasks WHERE active=1 AND date(next_due) < date(?)').get(t).n;
  s.active = db.prepare('SELECT COUNT(*) n FROM pm_tasks WHERE active=1').get().n;
  s.by_category = db.prepare(`SELECT category, COUNT(*) n, SUM(CASE WHEN date(completed_at) <= date(due_date) THEN 1 ELSE 0 END) on_time
    FROM work_orders WHERE source='pm' AND status='done' AND date(completed_at) >= date(?) GROUP BY category ORDER BY n DESC`).all(start)
    .map(r => Object.assign(r, { pct: Math.round(100 * (r.on_time || 0) / r.n) }));
  // Six months, oldest first.
  s.months = [];
  const d0 = new Date(t.slice(0, 7) + '-01T12:00:00Z');
  for (let i = 5; i >= 0; i--) {
    const a = new Date(d0); a.setUTCMonth(a.getUTCMonth() - i);
    const b = new Date(a); b.setUTCMonth(b.getUTCMonth() + 1);
    const ms = a.toISOString().slice(0, 10), me = b.toISOString().slice(0, 10);
    const m = scorecard(ms, me);
    s.months.push({ month: ms.slice(0, 7), label: MON[a.getUTCMonth()], on_time_pct: m.on_time_pct, planned_pct: m.planned_pct, pm_done: m.pm_done });
  }
  s.out_recent = db.prepare(`SELECT r.step, r.value, r.uom, r.lo, r.hi, r.at, u.apt, w.id repair
    FROM pm_readings r LEFT JOIN units u ON u.id=r.unit_id LEFT JOIN work_orders w ON w.reading_id=r.id
    WHERE r.ok=0 ORDER BY r.at DESC LIMIT 10`).all();
  return s;
}

/* ================= life-cycle hooks for workorders.js ================= */
function completed(w, pm, body, userName, addNote) {
  saveReadings(w, pm, body, userName, addNote);
  const t = today();
  if (w.unit_id && body && body.runtime != null && body.runtime !== '') {
    const err = logRuntime(w.unit_id, body.runtime, userName, 'pm');
    if (err) addNote(w.id, 'Hour meter not saved: ' + err, userName, 'status');
  }
  let next = addDays(t, pm.freq_days);
  const set = ['last_done=?'];
  const args = [t];
  if (pm.trigger_type === 'seasonal' && pm.season) next = nextSeason(pm.season, t, 30);
  if (pm.trigger_type === 'runtime') {
    const u = w.unit_id ? db.prepare('SELECT runtime_hours FROM units WHERE id=?').get(w.unit_id) : null;
    if (u && u.runtime_hours != null) { set.push('run_base=?'); args.push(u.runtime_hours); }
  }
  set.push('next_due=?'); args.push(next);
  db.prepare(`UPDATE pm_tasks SET ${set.join(', ')} WHERE id=?`).run(...args, pm.id);
}

function decoratePm(p) {
  const steps = parseChecklist(p.checklist);
  return Object.assign(p, {
    steps,
    reading_count: steps.filter(s => s.reading).length,
    kit_items: kitOf(p),
    runtime: runtimeStatus(p),
    season_label: seasonLabel(p.season),
    repeat_text: repeatText(p),
    window: p.needs_shutdown ? windowText(p.next_due, p.bldg || p.building || '') : ''
  });
}

// Extra PM fields from the edit form. Returns an error string or null.
function saveExtras(id, b) {
  const p = db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(id);
  if (!p) return 'Not found';
  const set = [], args = [];
  if (b.trigger_type !== undefined) {
    const tt = ['calendar', 'seasonal', 'runtime'].includes(b.trigger_type) ? b.trigger_type : 'calendar';
    set.push('trigger_type=?'); args.push(tt);
    if (tt === 'seasonal') {
      const s = String(b.season || '');
      const real = /^\d{2}-\d{2}$/.test(s) && new Date('2024-' + s + 'T12:00:00Z').toISOString().slice(5, 10) === s;
      if (!real) return 'Pick the month and day it should happen each year';
      set.push('season=?'); args.push(s);
      if (s !== p.season) { set.push('next_due=?'); args.push(nextSeason(s, today())); }
    }
    if (tt === 'runtime') {
      const h = num(b.run_hours);
      if (!h || h < 1) return 'Enter how many run hours between services';
      set.push('run_hours=?'); args.push(h);
      if (!p.unit_id) return 'A run-hour PM has to be tied to a piece of equipment';
    }
  }
  if (b.needs_shutdown !== undefined) { set.push('needs_shutdown=?'); args.push(b.needs_shutdown ? 1 : 0); }
  if (b.kit !== undefined) {
    const kit = (Array.isArray(b.kit) ? b.kit : []).map(k => ({ part_id: parseInt(k.part_id, 10), qty: num(k.qty) }))
      .filter(k => k.part_id && k.qty > 0).slice(0, 20);
    set.push('kit=?'); args.push(JSON.stringify(kit));
  }
  if (set.length) db.prepare(`UPDATE pm_tasks SET ${set.join(', ')} WHERE id=?`).run(...args, id);
  return null;
}

// PM tasks created from the old standard plan get the new checklists with
// readings, plus the season and shutdown settings. Tasks someone edited are
// left alone (their checklist no longer matches the old text).
function upgradeStarterTasks() {
  const done = db.prepare(`SELECT value FROM settings WHERE key='pm2_upgraded'`);
  let flag = null;
  try { flag = done.get(); } catch (e) { return; }
  if (flag) return;
  const LEGACY = require('./pm-legacy.json');
  const { STARTER } = require('./workorders');
  const byTitle = {};
  for (const k in STARTER) for (const [title, days, cat, list, opt = {}] of STARTER[k]) byTitle[title] = byTitle[title] || { list, opt };
  const rows = db.prepare('SELECT * FROM pm_tasks WHERE active=1').all();
  const upd = db.prepare('UPDATE pm_tasks SET title=?, checklist=?, needs_shutdown=?, season=?, trigger_type=? WHERE id=?');
  let n = 0;
  db.transaction(() => {
    for (const p of rows) {
      const title = { 'Loop pump inspection': 'Pump inspection', 'Loop and tower water test': 'Tower and closed loop water test' }[p.title] || p.title;
      const neu = byTitle[title];
      if (!neu || LEGACY[p.title] !== p.checklist) continue;
      upd.run(title, neu.list, neu.opt.shutdown ? 1 : 0, neu.opt.season || '', neu.opt.season ? 'seasonal' : 'calendar', p.id);
      n++;
    }
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('pm2_upgraded', ?)`).run(today());
  })();
  if (n) console.log(`  Upgraded ${n} standard PM task(s) with readings and seasonal dates.`);
}

/* ================= routes ================= */
function mount(app, auth) {
  const wo = require('./workorders');
  const mgr = u => u.role === 'admin' || u.role === 'manager';
  const unitByTag = tag => db.prepare('SELECT * FROM units WHERE apt=?').get(String(tag || '').trim().toUpperCase());
  try { upgradeStarterTasks(); } catch (e) { console.log('  PM upgrade skipped: ' + e.message); }

  // QR tag for a piece of equipment. Holds only the app link and the tag.
  const QRCode = require('qrcode');
  const path = require('path');
  const origin = req => (process.env.PUBLIC_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  app.get('/api/public/tag-qr.svg', async (req, res) => {
    const t = clip(req.query.t, 40).toUpperCase().replace(/[^A-Z0-9_.\-]/g, '');
    if (!t) return res.status(400).end();
    try {
      const svg = await QRCode.toString(origin(req) + '/?u=' + encodeURIComponent(t), { type: 'svg', margin: 1, errorCorrectionLevel: 'M',
        color: { dark: '#1F3A63', light: '#FFFFFF' } });
      res.set('Content-Type', 'image/svg+xml');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(svg);
    } catch (e) { res.status(500).end(); }
  });
  // QR decoder for the in-app scanner.
  app.get('/vendor/jsQR.js', (req, res) => {
    res.set('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(__dirname, 'node_modules', 'jsqr', 'dist', 'jsQR.js'));
  });

  // Rounds: open PM grouped into walks.
  app.get('/api/pm/rounds', auth, (req, res) => {
    wo.ensurePmWorkOrders();
    const days = Math.max(0, Math.min(60, parseInt(req.query.days, 10) || 7));
    res.json({ routes: rounds(days), days, today: today() });
  });

  // What a scanned tag should open: the PM due on it, or the record.
  app.get('/api/scan/:tag', auth, (req, res) => {
    const u = unitByTag(req.params.tag);
    if (!u) return res.status(404).json({ error: `No equipment tagged ${String(req.params.tag).toUpperCase()}` });
    wo.ensurePmWorkOrders();
    const open = db.prepare(`SELECT w.id, w.title, w.due_date, w.source FROM work_orders w WHERE w.unit_id=? AND w.status IN ${OPEN_SQL}
      ORDER BY CASE w.source WHEN 'pm' THEN 0 ELSE 1 END, date(w.due_date) LIMIT 10`).all(u.id);
    res.json({ apt: u.apt, building: u.building, route: routeOf(u), open });
  });

  app.put('/api/unit/:tag/route', auth, (req, res) => {
    const u = unitByTag(req.params.tag);
    if (!u) return res.status(404).json({ error: 'Equipment not found' });
    const b = req.body || {};
    db.prepare('UPDATE units SET route=?, route_order=? WHERE id=?')
      .run(clip(b.route, 80), Math.max(0, Math.min(999, parseInt(b.route_order, 10) || 0)), u.id);
    res.json({ route: routeOf(db.prepare('SELECT * FROM units WHERE id=?').get(u.id)) });
  });

  app.get('/api/route-names', auth, (req, res) => {
    const names = new Set(db.prepare('SELECT * FROM units').all().map(routeOf));
    res.json({ routes: [...names].sort() });
  });

  // Printable QR tag sheet data. Pass ?route= to print one walk.
  app.get('/api/tags', auth, (req, res) => {
    const want = clip(req.query.route, 80);
    const rows = db.prepare('SELECT * FROM units ORDER BY building, route_order, apt').all().map(u => {
      let meta = {};
      try { meta = JSON.parse(u.system_meta || '{}'); } catch (e) {}
      return { apt: u.apt, building: u.building || '', type: u.system_type || '', route: routeOf(u), location: meta.location || '', serves: meta.serves || '' };
    }).filter(u => !want || u.route === want);
    res.json({ tags: rows });
  });

  // Readings and run hours on one piece of equipment.
  app.get('/api/unit/:tag/readings', auth, (req, res) => {
    const u = unitByTag(req.params.tag);
    if (!u) return res.status(404).json({ error: 'Equipment not found' });
    const days = Math.max(7, Math.min(1095, parseInt(req.query.days, 10) || 365));
    const runtime = db.prepare('SELECT hours, at, source, by FROM runtime_log WHERE unit_id=? ORDER BY at DESC LIMIT 12').all(u.id);
    res.json({ series: readingSeries(u.id, days), runtime_hours: u.runtime_hours, runtime_at: u.runtime_at, runtime, rate: runRate(u.id),
               route: routeOf(u), route_custom: u.route || '', route_order: u.route_order || 0 });
  });

  app.post('/api/unit/:tag/runtime', auth, (req, res) => {
    const u = unitByTag(req.params.tag);
    if (!u) return res.status(404).json({ error: 'Equipment not found' });
    const err = logRuntime(u.id, (req.body || {}).hours, req.user.name, 'manual', !!(req.body || {}).reset);
    if (err) return res.status(400).json({ error: err });
    wo.ensurePmWorkOrders();
    res.json({ ok: true, runtime_hours: num((req.body || {}).hours) });
  });

  // Parts kits.
  app.get('/api/pm/kits', auth, (req, res) => {
    const days = Math.max(1, Math.min(120, parseInt(req.query.days, 10) || 30));
    const needs = kitNeeds(days);
    const withKits = db.prepare(`SELECT COUNT(*) n FROM pm_tasks WHERE active=1 AND kit IS NOT NULL AND kit != '[]'`).get().n;
    const filterPms = db.prepare(`SELECT COUNT(*) n FROM pm_tasks WHERE active=1 AND (title LIKE '%filter%' OR title LIKE '%belt%') AND (kit IS NULL OR kit='[]')`).get().n;
    res.json({ days, needs, with_kits: withKits, without_kits: filterPms,
               short_total: Math.round(needs.reduce((s, r) => s + r.est, 0) * 100) / 100 });
  });
  app.post('/api/pm/kits/suggest', auth, (req, res) => res.json(suggestKits()));

  // Shutdown windows and club hours.
  app.get('/api/pm/shutdown', auth, (req, res) => {
    const rules = db.prepare('SELECT * FROM shutdown_rules WHERE active=1 ORDER BY building').all();
    const b = clip(req.query.building, 80);
    res.json({ rules, windows: b ? shutdownWindows(b, isDate(req.query.from) ? req.query.from : today()) : [] });
  });
  app.post('/api/pm/shutdown', auth, (req, res) => {
    if (!mgr(req.user)) return res.status(403).json({ error: 'Only a manager can change club hours' });
    const b = req.body || {};
    const tm = s => /^\d{2}:\d{2}$/.test(String(s || ''));
    if (!clip(b.building, 80)) return res.status(400).json({ error: 'Pick the building' });
    if (!tm(b.start_time) || !tm(b.end_time)) return res.status(400).json({ error: 'Enter open and close times like 06:00 and 22:00' });
    const days = String(b.days || '').replace(/[^0-6]/g, '');
    if (!days) return res.status(400).json({ error: 'Pick at least one day' });
    if (b.id) {
      db.prepare('UPDATE shutdown_rules SET building=?, days=?, start_time=?, end_time=?, note=? WHERE id=?')
        .run(clip(b.building, 80), days, b.start_time, b.end_time, clip(b.note, 200), parseInt(b.id, 10));
    } else {
      db.prepare('INSERT INTO shutdown_rules (building, days, start_time, end_time, note) VALUES (?,?,?,?,?)')
        .run(clip(b.building, 80), days, b.start_time, b.end_time, clip(b.note, 200));
    }
    res.json({ ok: true });
  });
  app.delete('/api/pm/shutdown/:id', auth, (req, res) => {
    if (!mgr(req.user)) return res.status(403).json({ error: 'Only a manager can change club hours' });
    db.prepare('UPDATE shutdown_rules SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // Scorecard.
  app.get('/api/pm/scorecard', auth, (req, res) => {
    const days = Math.max(7, Math.min(365, parseInt(req.query.days, 10) || 90));
    res.json(scorecardFull(days));
  });
}

module.exports = {
  mount, parseStep, parseChecklist, readingSeries, scorecard, scorecardFull, kitNeeds, rounds, nextSeason,
  // hooks
  beforeEnsure, opened, completed, readingsText, decoratePm, saveExtras, repeatText
};
