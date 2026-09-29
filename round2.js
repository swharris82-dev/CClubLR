/**
 * Round 2: property map, capital planning, before/after photos and sign-off,
 * event calendar conflicts, and kitchen health inspection logs.
 *
 * Mounted from server.js:  require('./round2').mount(app, auth)
 */
const { db } = require('./db');
const ops = require('./ops');

const DEMO_MODE = process.env.DEMO_MODE === 'true';
const TZ = process.env.TZ_NAME || 'America/Chicago';

/* =================================================================
   SCHEMA
   ================================================================= */
function cols(t) { return db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); }
function addCol(t, c, ddl) { if (!cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`); }

addCol('units', 'install_year', `install_year INTEGER`);
addCol('units', 'expected_life', `expected_life INTEGER`);
addCol('units', 'replace_cost', `replace_cost REAL`);
addCol('units', 'replace_year', `replace_year INTEGER`);
addCol('units', 'condition', `condition INTEGER DEFAULT 3`);
addCol('work_orders', 'signature', `signature TEXT`);
addCol('work_orders', 'signed_by', `signed_by TEXT DEFAULT ''`);

db.exec(`
CREATE TABLE IF NOT EXISTS wo_photos (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_id  INTEGER NOT NULL,
  kind   TEXT NOT NULL DEFAULT 'before',
  data   TEXT NOT NULL,
  by     TEXT DEFAULT '',
  at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(wo_id) REFERENCES work_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wop_wo ON wo_photos(wo_id);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  kind        TEXT DEFAULT 'Member event',
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  start_time  TEXT DEFAULT '',
  end_time    TEXT DEFAULT '',
  buildings   TEXT DEFAULT '',
  guests      INTEGER DEFAULT 0,
  no_work     INTEGER DEFAULT 1,
  notes       TEXT DEFAULT '',
  source      TEXT DEFAULT 'manual',
  uid         TEXT,
  created_by  TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ev_dates ON events(start_date, end_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_uid ON events(uid);

CREATE TABLE IF NOT EXISTS temp_points (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  unit_id   INTEGER,
  kind      TEXT NOT NULL DEFAULT 'cooler',
  min_f     REAL,
  max_f     REAL,
  checks    INTEGER NOT NULL DEFAULT 2,
  location  TEXT DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS temp_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  point_id  INTEGER NOT NULL,
  reading   REAL NOT NULL,
  ok        INTEGER NOT NULL DEFAULT 1,
  note      TEXT DEFAULT '',
  action    TEXT DEFAULT '',
  wo_id     INTEGER,
  by        TEXT DEFAULT '',
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(point_id) REFERENCES temp_points(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tl_point ON temp_logs(point_id, at);

CREATE TABLE IF NOT EXISTS compliance_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  area       TEXT DEFAULT 'Kitchen',
  freq_days  INTEGER NOT NULL DEFAULT 90,
  last_done  TEXT,
  next_due   TEXT,
  vendor_id  INTEGER,
  why        TEXT DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS compliance_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id   INTEGER NOT NULL,
  done_on   TEXT NOT NULL,
  by        TEXT DEFAULT '',
  note      TEXT DEFAULT '',
  vendor    TEXT DEFAULT '',
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(item_id) REFERENCES compliance_items(id) ON DELETE CASCADE
);
`);

/* ---------------- helpers ---------------- */
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const num = (v, d = null) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function addDays(d, n) { const x = new Date((d || today()) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
const getSetting = (k, d = null) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : d; };
const setSetting = (k, v) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v == null ? null : String(v));
const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Math.round(n || 0).toLocaleString('en-US');
const clubName = () => (db.prepare('SELECT name FROM properties WHERE id=1').get() || {}).name || 'Country Club of Little Rock';
const b64ok = s => typeof s === 'string' && s.length < 2400000 && /^[A-Za-z0-9+/=]+$/.test(s);

const DEFAULT_BUILDINGS = ['Clubhouse', 'Central Plant', 'Indoor Tennis Center', 'Fitness Center', 'Pool Pavilion',
  'Family & Teen Center', 'Golf Shop', 'Cart Barn', 'Maintenance Shop', 'Grounds / Course'];
function buildings() {
  const all = db.prepare(`SELECT DISTINCT building FROM units WHERE building IS NOT NULL AND building != '' ORDER BY building`).all().map(r => r.building);
  DEFAULT_BUILDINGS.forEach(b => { if (!all.includes(b)) all.push(b); });
  return all;
}

/* =================================================================
   PROPERTY MAP
   A schematic, not a survey. Managers drag buildings to match the grounds.
   Canvas is 1000 x 1300 so it reads well on a phone held upright.
   ================================================================= */
const DEFAULT_LAYOUT = {
  'Clubhouse':            { x: 330, y: 470, w: 340, h: 230 },
  'Central Plant':        { x: 690, y: 560, w: 150, h: 110 },
  'Pool Pavilion':        { x: 130, y: 760, w: 200, h: 120 },
  'Family & Teen Center': { x: 130, y: 610, w: 170, h: 110 },
  'Fitness Center':       { x: 380, y: 760, w: 170, h: 110 },
  'Indoor Tennis Center': { x: 600, y: 790, w: 280, h: 190 },
  'Golf Shop':            { x: 420, y: 300, w: 170, h: 100 },
  'Cart Barn':            { x: 640, y: 290, w: 170, h: 110 },
  'Maintenance Shop':     { x: 740, y: 110, w: 180, h: 110 },
  'Grounds / Course':     { x: 90,  y: 110, w: 250, h: 130 }
};
function layout() {
  let saved = {};
  try { saved = JSON.parse(getSetting('map_layout', '{}') || '{}'); } catch (e) { saved = {}; }
  const out = {};
  let spare = 0;
  buildings().forEach(b => {
    out[b] = saved[b] || DEFAULT_LAYOUT[b] || { x: 80 + (spare % 4) * 220, y: 1040 + Math.floor(spare++ / 4) * 130, w: 180, h: 100 };
  });
  return out;
}

function buildingStatus() {
  const t = today();
  const OPEN = `('new','open','in_progress','on_hold')`;
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  return buildings().map(b => {
    const eq = one(`SELECT COUNT(*) n, SUM(CASE WHEN switch_present='no' OR switch_functioning='no' THEN 1 ELSE 0 END) safety FROM units WHERE building=?`, b);
    const wo = one(`SELECT COUNT(*) open,
        SUM(CASE WHEN w.priority='emergency' THEN 1 ELSE 0 END) emergency,
        SUM(CASE WHEN w.priority='high' THEN 1 ELSE 0 END) high,
        SUM(CASE WHEN w.due_date IS NOT NULL AND date(w.due_date) < date(?) THEN 1 ELSE 0 END) overdue
      FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
      WHERE w.status IN ${OPEN} AND w.source != 'pm' AND COALESCE(NULLIF(w.building,''), u.building)=?`, t, b);
    const pm = one(`SELECT SUM(CASE WHEN date(p.next_due) < date(?) THEN 1 ELSE 0 END) late, SUM(CASE WHEN date(p.next_due) <= date(?, '+7 days') THEN 1 ELSE 0 END) soon
      FROM pm_tasks p LEFT JOIN units u ON u.id=p.unit_id WHERE p.active=1 AND COALESCE(NULLIF(p.building,''), u.building)=?`, t, t, b);
    const ev = db.prepare(`SELECT title, start_date FROM events WHERE date(end_date) >= date(?) AND date(start_date) <= date(?, '+7 days')
      AND (buildings='' OR buildings LIKE '%' || ? || '%') ORDER BY start_date LIMIT 2`).all(t, t, b);
    const s = { name: b, equipment: eq.n || 0, safety: eq.safety || 0, open: wo.open || 0, emergency: wo.emergency || 0,
                high: wo.high || 0, overdue: wo.overdue || 0, pm_late: pm.late || 0, pm_soon: pm.soon || 0, events: ev };
    s.status = s.emergency ? 'critical' : (s.high || s.overdue || s.pm_late || s.safety) ? 'warn' : s.open ? 'busy' : 'ok';
    return s;
  });
}

function buildingDetail(b) {
  const t = today();
  const units = db.prepare(`SELECT u.id, u.apt, u.system_type, u.manufacturer, u.switch_present, u.switch_functioning,
      (SELECT COUNT(*) FROM work_orders w WHERE w.unit_id=u.id AND w.status IN ('new','open','in_progress','on_hold')) open_wo,
      (SELECT MAX(w.priority='emergency') FROM work_orders w WHERE w.unit_id=u.id AND w.status IN ('new','open','in_progress','on_hold')) em,
      (SELECT MAX(job_date) FROM jobs j WHERE j.unit_id=u.id) last_job,
      (SELECT MIN(next_due) FROM pm_tasks p WHERE p.unit_id=u.id AND p.active=1) next_pm
    FROM units u WHERE u.building=? ORDER BY u.system_type, u.apt`).all(b);
  const wos = db.prepare(`SELECT w.id, w.title, w.priority, w.status, w.due_date, u.apt FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
    WHERE w.status IN ('new','open','in_progress','on_hold') AND COALESCE(NULLIF(w.building,''), u.building)=?
    ORDER BY CASE w.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, w.id LIMIT 30`).all(b);
  const pms = db.prepare(`SELECT p.id, p.title, p.next_due, u.apt FROM pm_tasks p LEFT JOIN units u ON u.id=p.unit_id
    WHERE p.active=1 AND COALESCE(NULLIF(p.building,''), u.building)=? AND date(p.next_due) <= date(?, '+30 days') ORDER BY date(p.next_due) LIMIT 15`).all(b, t);
  const events = db.prepare(`SELECT * FROM events WHERE date(end_date) >= date(?) AND date(start_date) <= date(?, '+30 days')
    AND (buildings='' OR buildings LIKE '%' || ? || '%') ORDER BY start_date LIMIT 6`).all(t, t, b);
  return { name: b, units, workorders: wos, pms, events };
}

/* =================================================================
   CAPITAL PLANNING
   ================================================================= */
// Typical service life (years) and a rough installed replacement cost by
// equipment type. Costs are placeholders until someone enters a real quote.
const LIFE = {
  'Boiler (loop heat)': [25, 45000], 'Cooling tower / fluid cooler': [20, 120000], 'Loop / condenser pump': [20, 9000],
  'Plate heat exchanger': [25, 25000], 'Loop accessory (expansion tank, air separator, makeup)': [20, 6000],
  'Water treatment system': [15, 8000], 'Water-source heat pump': [18, 9000], 'Rooftop / package unit': [15, 25000],
  'Split system / air handler': [15, 12000], 'Ductless mini-split': [15, 7000], 'VRF / VRV': [20, 60000],
  'Walk-in cooler / freezer': [15, 18000], 'Ice machine': [10, 8000], 'Kitchen equipment': [12, 10000],
  'Pool equipment': [10, 6000], 'Water heater': [12, 14000], 'Building controls / BAS': [15, 30000], 'Other': [15, 5000]
};
const COND_ADJ = { 1: -4, 2: -2, 3: 0, 4: 1, 5: 3 };

function capitalPlan() {
  const now = parseInt(today().slice(0, 4), 10);
  const infl = num(getSetting('cap_inflation', '3'), 3) / 100;
  const units = db.prepare(`SELECT u.*,
      (SELECT MIN(substr(install_date,1,4)) FROM equipment e WHERE e.unit_id=u.id AND e.install_date != '') eq_year,
      (SELECT COUNT(*) FROM jobs j WHERE j.unit_id=u.id AND date(job_date) >= date('now','-365 days')) jobs_12,
      (SELECT COALESCE(SUM(i.amount),0) FROM invoices i JOIN work_orders w ON w.id=i.wo_id WHERE w.unit_id=u.id AND i.status!='void' AND date(i.inv_date) >= date('now','-3 years')) vendor_3y,
      (SELECT COALESCE(SUM(-t.qty*t.unit_cost),0) FROM part_txns t WHERE t.unit_id=u.id AND t.kind='use' AND date(t.at) >= date('now','-3 years')) parts_3y
    FROM units u ORDER BY u.building, u.apt`).all();
  const items = units.map(u => {
    const def = LIFE[u.system_type] || LIFE.Other;
    const life = u.expected_life || def[0];
    const cost = u.replace_cost != null ? u.replace_cost : def[1];
    const inst = u.install_year || (u.eq_year ? parseInt(u.eq_year, 10) : null);
    const cond = u.condition || 3;
    let year = u.replace_year || (inst ? inst + life + (COND_ADJ[cond] || 0) : null);
    const age = inst ? now - inst : null;
    const repair3 = Math.round((u.vendor_3y || 0) + (u.parts_3y || 0));
    const flags = [];
    if (!inst) flags.push('Install year unknown');
    if (u.replace_cost == null) flags.push('Cost is an estimate');
    if (repair3 > cost * 0.5) flags.push('Repairs over half of replacement cost');
    if (u.jobs_12 >= 3) flags.push(u.jobs_12 + ' service calls in 12 months');
    const planYear = year == null ? null : Math.max(year, now);
    const future = planYear == null ? cost : Math.round(cost * Math.pow(1 + infl, planYear - now));
    return { id: u.id, apt: u.apt, building: u.building, system_type: u.system_type, manufacturer: u.manufacturer,
             install_year: inst, install_known: !!u.install_year, life, life_default: def[0], cost, cost_default: def[1], cost_set: u.replace_cost != null,
             condition: cond, age, due_year: year, plan_year: planYear, overdue: year != null && year < now, future_cost: future,
             remaining: year == null ? null : year - now, pct_life: age == null ? null : Math.round(100 * age / life),
             repair_3y: repair3, jobs_12: u.jobs_12, override_year: u.replace_year || null, flags };
  });
  const years = [];
  for (let y = now; y < now + 10; y++) {
    const list = items.filter(i => i.plan_year === y);
    years.push({ year: y, count: list.length, total: list.reduce((s, i) => s + i.future_cost, 0), items: list.map(i => i.apt) });
  }
  const unknown = items.filter(i => i.plan_year == null);
  return {
    now, inflation: infl * 100, items: items.sort((a, b) => (a.plan_year || 9999) - (b.plan_year || 9999) || (b.pct_life || 0) - (a.pct_life || 0)),
    years, unknown: unknown.length,
    totals: { five: years.slice(0, 5).reduce((s, y) => s + y.total, 0), ten: years.reduce((s, y) => s + y.total, 0),
              overdue: items.filter(i => i.overdue).length, overdue_cost: items.filter(i => i.overdue).reduce((s, i) => s + i.future_cost, 0),
              replacement_value: items.reduce((s, i) => s + i.cost, 0) },
    types: Object.keys(LIFE).map(k => ({ type: k, life: LIFE[k][0], cost: LIFE[k][1] }))
  };
}

function capitalHtml(c) {
  const rows = c.items.filter(i => i.plan_year != null && i.plan_year < c.now + 10);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Capital plan</title><style>
body{margin:0;background:#F3EFE5;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1A2436;font-size:13px}
.page{max-width:820px;margin:0 auto;background:#fff;padding:26px 28px 40px}
h1{font-family:Georgia,serif;color:#1F3A63;margin:4px 0 0;font-size:26px}.club{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4F6F99}
.hd{border-bottom:3px solid #B79B5B;padding-bottom:10px;margin-bottom:16px}
.eb{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4F6F99;margin:20px 0 8px;border-bottom:1px solid #DDD5C3;padding-bottom:4px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#7C8494;border-bottom:1px solid #DDD5C3;padding:4px 6px}
td{border-bottom:1px solid #EEE8DA;padding:5px 6px;vertical-align:top}.r{text-align:right;white-space:nowrap}.dim{color:#7C8494;font-size:11px}
.bar{position:sticky;top:0;background:#1F3A63;padding:10px;text-align:center}.bar button{background:#D8BE7C;border:0;color:#1F3A63;font-weight:bold;padding:9px 18px;border-radius:3px;font-size:14px}
.k{display:inline-block;margin-right:26px}.k b{display:block;font-family:Georgia,serif;font-size:22px;color:#1F3A63}
@media print{.bar{display:none}.page{padding:0}}</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save PDF</button></div><div class="page">
<div class="hd"><div class="club">${escH(clubName())}</div><h1>10-Year Equipment Capital Plan</h1><div class="dim">Prepared ${escH(today())} · costs include ${c.inflation}% a year for inflation</div></div>
<div><span class="k"><b>${money(c.totals.five)}</b>Next 5 years</span><span class="k"><b>${money(c.totals.ten)}</b>Next 10 years</span><span class="k"><b>${c.totals.overdue}</b>Past expected life</span></div>
<div class="eb">By year</div><table><tr><th>Year</th><th>Items</th><th class="r">Budget</th></tr>
${c.years.map(y => `<tr><td><b>${y.year}</b>${y.year === c.now && c.totals.overdue ? ' <span class="dim">(includes past-due)</span>' : ''}</td><td>${escH(y.items.join(', ') || '—')}</td><td class="r">${money(y.total)}</td></tr>`).join('')}</table>
<div class="eb">Equipment detail</div><table><tr><th>Equipment</th><th>Installed</th><th>Life</th><th>Replace</th><th class="r">Cost</th></tr>
${rows.map(i => `<tr><td><b>${escH(i.apt)}</b> ${escH(i.system_type)}<br><span class="dim">${escH(i.building || '')}${i.flags.length ? ' · ' + escH(i.flags.join(' · ')) : ''}</span></td><td>${i.install_year || '?'}</td><td>${i.life} yr</td><td>${i.plan_year}${i.overdue ? ' <span class="dim">(due ' + i.due_year + ')</span>' : ''}</td><td class="r">${money(i.future_cost)}</td></tr>`).join('')}</table>
${c.unknown ? `<p class="dim">${c.unknown} piece(s) of equipment have no install year and are not scheduled yet.</p>` : ''}
<p class="dim">Service lives are typical industry figures, adjusted for condition. Costs marked as estimates are placeholders until a quote is entered.</p>
</div></body></html>`;
}

/* =================================================================
   EVENTS AND CONFLICTS
   ================================================================= */
const EVENT_KINDS = ['Tournament', 'Wedding', 'Banquet / private party', 'Member event', 'Holiday', 'Swim meet', 'Tennis event', 'Closure', 'Other'];

function eventMatches(ev, building) {
  if (!ev.buildings) return true;
  if (!building) return true;
  return ev.buildings.split(',').map(s => s.trim().toLowerCase()).includes(String(building).toLowerCase());
}
function conflictsFor(ev) {
  const out = [];
  const from = ev.start_date, to = ev.end_date;
  db.prepare(`SELECT p.id, p.title, p.next_due, COALESCE(NULLIF(p.building,''), u.building, '') building, u.apt FROM pm_tasks p LEFT JOIN units u ON u.id=p.unit_id
    WHERE p.active=1 AND date(p.next_due) BETWEEN date(?) AND date(?)`).all(from, to).forEach(p => {
    if (eventMatches(ev, p.building)) out.push({ type: 'pm', id: p.id, title: p.title, date: p.next_due, building: p.building, apt: p.apt });
  });
  db.prepare(`SELECT w.id, w.title, w.due_date, w.priority, COALESCE(NULLIF(w.building,''), u.building, '') building, u.apt FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
    WHERE w.status IN ('new','open','in_progress','on_hold') AND w.source!='pm' AND w.due_date IS NOT NULL AND date(w.due_date) BETWEEN date(?) AND date(?)`).all(from, to).forEach(w => {
    if (eventMatches(ev, w.building)) out.push({ type: 'wo', id: w.id, title: w.title, date: w.due_date, building: w.building, apt: w.apt });
  });
  db.prepare(`SELECT c.id, c.title, c.next_visit, c.covers, v.name vendor FROM contracts c JOIN vendors v ON v.id=c.vendor_id
    WHERE c.active=1 AND c.next_visit IS NOT NULL AND date(c.next_visit) BETWEEN date(?) AND date(?)`).all(from, to).forEach(c => {
    const hit = !ev.buildings || ev.buildings.split(',').some(b => (c.covers || '').toLowerCase().includes(b.trim().toLowerCase()));
    if (hit) out.push({ type: 'vendor', id: c.id, title: `${c.vendor}: ${c.title}`, date: c.next_visit, building: c.covers });
  });
  db.prepare(`SELECT i.id, i.title, i.next_due, i.area FROM compliance_items i WHERE i.active=1 AND i.next_due IS NOT NULL AND date(i.next_due) BETWEEN date(?) AND date(?)`).all(from, to).forEach(i => {
    if (eventMatches(ev, 'Clubhouse')) out.push({ type: 'kitchen', id: i.id, title: i.title, date: i.next_due, building: 'Clubhouse' });
  });
  return out;
}
function upcomingEvents(days = 90) {
  const t = today();
  return db.prepare(`SELECT * FROM events WHERE date(end_date) >= date(?) AND date(start_date) <= date(?, '+' || ? || ' days') ORDER BY start_date, start_time`).all(t, t, days)
    .map(e => Object.assign(e, { conflicts: e.no_work ? conflictsFor(e) : [], days_out: daysBetween(t, e.start_date) }));
}

// Minimal iCalendar reader for a club events feed (Google Calendar, Outlook, ClubEssential exports).
function parseIcs(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let cur = null;
  const date = v => {
    const m = String(v).match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) return null;
    return { d: `${m[1]}-${m[2]}-${m[3]}`, t: m[4] ? `${m[4]}:${m[5]}` : '' };
  };
  lines.forEach(l => {
    if (l === 'BEGIN:VEVENT') cur = {};
    else if (l === 'END:VEVENT') { if (cur && cur.start) out.push(cur); cur = null; }
    else if (cur) {
      const i = l.indexOf(':'); if (i < 0) return;
      const key = l.slice(0, i).split(';')[0].toUpperCase(), v = l.slice(i + 1);
      if (key === 'SUMMARY') cur.title = v.replace(/\\,/g, ',').replace(/\\n/g, ' ');
      else if (key === 'LOCATION') cur.location = v.replace(/\\,/g, ',');
      else if (key === 'UID') cur.uid = v;
      else if (key === 'DESCRIPTION') cur.notes = v.replace(/\\n/g, '\n').replace(/\\,/g, ',').slice(0, 500);
      else if (key === 'DTSTART') cur.start = date(v);
      else if (key === 'DTEND') cur.end = date(v);
    }
  });
  return out;
}
function guessKind(title) {
  const t = (title || '').toLowerCase();
  if (/wedding|reception|rehearsal/.test(t)) return 'Wedding';
  if (/tournament|invitational|member[- ]guest|championship|scramble|golf/.test(t)) return 'Tournament';
  if (/swim/.test(t)) return 'Swim meet';
  if (/tennis/.test(t)) return 'Tennis event';
  if (/closed|closure/.test(t)) return 'Closure';
  if (/banquet|party|dinner|luncheon|gala/.test(t)) return 'Banquet / private party';
  return 'Member event';
}
async function syncIcs(force) {
  const url = getSetting('events_ics_url');
  if (!url) return { ok: false, error: 'No calendar link set' };
  const last = getSetting('events_ics_synced');
  if (!force && last && (Date.now() - Date.parse(last)) < 6 * 3600 * 1000) return { ok: true, skipped: true };
  try {
    const r = await fetch(url.replace(/^webcal:/i, 'https:'));
    if (!r.ok) throw new Error('Calendar returned ' + r.status);
    const evs = parseIcs(await r.text());
    const t = today(), horizon = addDays(t, 400);
    const bl = buildings();
    let n = 0;
    const up = db.prepare(`INSERT INTO events (title, kind, start_date, end_date, start_time, end_time, buildings, notes, source, uid)
      VALUES (@title,@kind,@start_date,@end_date,@start_time,@end_time,@buildings,@notes,'calendar',@uid)
      ON CONFLICT(uid) DO UPDATE SET title=excluded.title, start_date=excluded.start_date, end_date=excluded.end_date,
        start_time=excluded.start_time, end_time=excluded.end_time, notes=excluded.notes`);
    db.transaction(() => {
      evs.forEach(e => {
        if (!e.start || e.start.d < addDays(t, -7) || e.start.d > horizon) return;
        let end = e.end ? e.end.d : e.start.d;
        if (e.end && !e.end.t && end > e.start.d) end = addDays(end, -1); // all-day DTEND is exclusive
        const loc = (e.location || '') + ' ' + (e.title || '');
        const hits = bl.filter(b => loc.toLowerCase().includes(b.toLowerCase().split(' ')[0]));
        up.run({ title: clip(e.title || 'Club event', 160), kind: guessKind(e.title), start_date: e.start.d, end_date: end < e.start.d ? e.start.d : end,
                 start_time: e.start.t || '', end_time: e.end ? e.end.t || '' : '', buildings: hits.join(', '), notes: clip(e.notes, 500),
                 uid: 'ics:' + (e.uid || (e.title + e.start.d)) });
        n++;
      });
    })();
    setSetting('events_ics_synced', new Date().toISOString());
    return { ok: true, count: n };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* =================================================================
   KITCHEN / HEALTH INSPECTION
   ================================================================= */
const COMPLIANCE_DEFAULTS = [
  ['Ice machine clean and sanitize', 'Kitchen', 180, 'Health code and manufacturer requirement. Inspectors check for mold and slime in the bin and evaporator.'],
  ['Hood and duct cleaning (NFPA 96)', 'Kitchen', 90, 'Quarterly for high-volume cooking. Keep the certificate sticker current on the hood.'],
  ['Grease trap / interceptor pump-out', 'Kitchen', 90, 'City pretreatment rules. Keep the manifest from the hauler.'],
  ['Fire suppression (hood system) inspection', 'Kitchen', 180, 'Semiannual inspection tag required by the fire marshal.'],
  ['Fire extinguisher monthly check', 'Kitchen', 30, 'Initial and date the tag monthly. K-class near fryers.'],
  ['Pest control service', 'Kitchen', 30, 'Keep service reports on file for the inspector.'],
  ['Refrigeration condenser coil cleaning', 'Kitchen', 90, 'Dirty coils are the top cause of walk-ins running warm.'],
  ['Walk-in gaskets, strip curtain, door closer check', 'Kitchen', 30, 'Torn gaskets and propped doors show up as warm readings.'],
  ['Backflow preventer test', 'Kitchen', 365, 'Annual test by a certified tester, report filed with the water utility.'],
  ['Dish machine service and final rinse check', 'Kitchen', 30, 'High-temp machines need 180°F final rinse, or proper sanitizer ppm for low-temp.']
];
const TEMP_DEFAULTS = [
  ['Walk-in cooler', 'cooler', null, 41, 2, 'Main kitchen', /WIC|WALK/],
  ['Walk-in freezer', 'freezer', null, 0, 2, 'Main kitchen', /WIF|FRZ/],
  ['Reach-in cooler, cook line', 'cooler', null, 41, 2, 'Cook line', null],
  ['Bar cooler', 'cooler', null, 41, 1, 'Grill Room bar', null],
  ['Dish machine final rinse', 'hot', 180, null, 1, 'Dish room', null]
];
function ensureKitchenDefaults() {
  if (db.prepare('SELECT COUNT(*) c FROM compliance_items').get().c === 0) {
    const t = today();
    const ins = db.prepare('INSERT INTO compliance_items (title, area, freq_days, why, sort, next_due) VALUES (?,?,?,?,?,?)');
    COMPLIANCE_DEFAULTS.forEach((c, i) => ins.run(c[0], c[1], c[2], c[3], i, t));
  }
  if (db.prepare('SELECT COUNT(*) c FROM temp_points').get().c === 0) {
    const ins = db.prepare('INSERT INTO temp_points (name, kind, min_f, max_f, checks, location, unit_id, sort) VALUES (?,?,?,?,?,?,?,?)');
    TEMP_DEFAULTS.forEach((p, i) => {
      let unit = null;
      if (p[6]) { const u = db.prepare(`SELECT id, apt FROM units WHERE system_type='Walk-in cooler / freezer'`).all().find(u => p[6].test(u.apt)); unit = u ? u.id : null; }
      ins.run(p[0], p[1], p[2], p[3], p[4], p[5], unit, i);
    });
  }
}
function localParts(ts) {
  const d = new Date(String(ts).replace(' ', 'T') + (String(ts).endsWith('Z') ? '' : 'Z'));
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = k => (f.find(x => x.type === k) || {}).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: parseInt(g('hour'), 10), time: `${g('hour')}:${g('minute')}` };
}
function tempOk(p, r) { return !((p.max_f != null && r > p.max_f) || (p.min_f != null && r < p.min_f)); }

function kitchenState() {
  ensureKitchenDefaults();
  const t = today();
  const points = db.prepare(`SELECT p.*, u.apt FROM temp_points p LEFT JOIN units u ON u.id=p.unit_id WHERE p.active=1 ORDER BY p.sort, p.id`).all();
  const recent = db.prepare(`SELECT * FROM temp_logs WHERE datetime(at) >= datetime('now','-9 days') ORDER BY at DESC`).all();
  points.forEach(p => {
    const mine = recent.filter(l => l.point_id === p.id).map(l => Object.assign(l, localParts(l.at)));
    p.last = mine[0] || null;
    p.today = mine.filter(l => l.date === t);
    p.am = p.today.some(l => l.hour < 12); p.pm = p.today.some(l => l.hour >= 12);
    p.due_now = p.checks >= 2 ? (!p.am || (localParts(new Date().toISOString()).hour >= 14 && !p.pm)) : p.today.length === 0;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(t, -i);
      const logs = mine.filter(l => l.date === d);
      days.push({ date: d, n: logs.length, bad: logs.filter(l => !l.ok).length, max: logs.length ? Math.max(...logs.map(l => l.reading)) : null, min: logs.length ? Math.min(...logs.map(l => l.reading)) : null });
    }
    p.week = days;
    p.expected7 = p.checks * 7;
    p.logged7 = days.reduce((s, d) => s + Math.min(d.n, p.checks), 0);
  });
  const items = db.prepare(`SELECT i.*, v.name vendor_name, v.phone vendor_phone FROM compliance_items i LEFT JOIN vendors v ON v.id=i.vendor_id WHERE i.active=1 ORDER BY i.sort, i.id`).all()
    .map(i => Object.assign(i, { days: i.next_due ? daysBetween(t, i.next_due) : null, state: !i.last_done ? 'never' : daysBetween(t, i.next_due) < 0 ? 'late' : daysBetween(t, i.next_due) <= 14 ? 'soon' : 'ok' }));
  const current = items.filter(i => i.state === 'ok' || i.state === 'soon').length;
  const exp = points.reduce((s, p) => s + p.expected7, 0), got = points.reduce((s, p) => s + p.logged7, 0);
  const bad7 = recent.filter(l => !l.ok && daysBetween(localParts(l.at).date, t) <= 7).length;
  const itemScore = items.length ? current / items.length : 1;
  const tempScore = exp ? got / exp : 1;
  const score = Math.round(100 * (itemScore * 0.6 + tempScore * 0.4));
  return { today: t, points, items, score, temp_pct: Math.round(100 * tempScore), item_pct: Math.round(100 * itemScore), out_of_range_7: bad7,
           due_now: points.filter(p => p.due_now).length };
}

function binderHtml(days = 30) {
  ensureKitchenDefaults();
  const t = today(), from = addDays(t, -days + 1);
  const points = db.prepare('SELECT * FROM temp_points WHERE active=1 ORDER BY sort, id').all();
  const logs = db.prepare(`SELECT l.*, p.name FROM temp_logs l JOIN temp_points p ON p.id=l.point_id WHERE datetime(l.at) >= datetime(?, '-1 day') ORDER BY l.at`).all(from)
    .map(l => Object.assign(l, localParts(l.at))).filter(l => l.date >= from);
  const items = db.prepare('SELECT * FROM compliance_items WHERE active=1 ORDER BY sort, id').all();
  const hist = db.prepare('SELECT * FROM compliance_log WHERE date(done_on) >= date(?, \'-400 days\') ORDER BY done_on DESC').all(t);
  const dates = []; for (let d = from; d <= t; d = addDays(d, 1)) dates.push(d);
  const cell = (p, d, am) => {
    const l = logs.filter(x => x.point_id === p.id && x.date === d && (am ? x.hour < 12 : x.hour >= 12));
    if (!l.length) return '<td class="c e"></td>';
    const x = l[l.length - 1];
    return `<td class="c${x.ok ? '' : ' bad'}" title="${escH(x.by)} ${x.time}">${x.reading}${x.ok ? '' : '*'}</td>`;
  };
  const bad = logs.filter(l => !l.ok);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kitchen inspection binder</title><style>
body{margin:0;background:#F3EFE5;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1A2436;font-size:12px}
.page{max-width:1000px;margin:0 auto;background:#fff;padding:24px 26px 40px}
h1{font-family:Georgia,serif;color:#1F3A63;margin:4px 0 0;font-size:24px}.club{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4F6F99}
.hd{border-bottom:3px solid #B79B5B;padding-bottom:10px;margin-bottom:14px}
.eb{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4F6F99;margin:20px 0 8px;border-bottom:1px solid #DDD5C3;padding-bottom:4px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #E4DDCC;padding:3px 5px}th{background:#FBF9F4;font-size:10px;text-align:left}
.c{text-align:center;font-family:monospace;min-width:26px}.e{background:#FAFAF7}.bad{background:#FBE3E0;color:#B3362D;font-weight:bold}
.wrap{overflow-x:auto}.dim{color:#7C8494}.bar{position:sticky;top:0;background:#1F3A63;padding:10px;text-align:center}
.bar button{background:#D8BE7C;border:0;color:#1F3A63;font-weight:bold;padding:9px 18px;border-radius:3px;font-size:14px}
@media print{.bar{display:none}.page{padding:0;max-width:none}@page{size:landscape}}</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save PDF</button></div><div class="page">
<div class="hd"><div class="club">${escH(clubName())}</div><h1>Kitchen Food Safety and Maintenance Log</h1><div class="dim">${escH(from)} to ${escH(t)} · temperatures in °F · * = out of range</div></div>
<div class="eb">Scheduled service and inspections</div>
<table><tr><th>Item</th><th>Every</th><th>Last done</th><th>Next due</th><th>Recent history</th></tr>
${items.map(i => `<tr><td><b>${escH(i.title)}</b></td><td>${i.freq_days} days</td><td>${escH(i.last_done || 'No record')}</td><td${i.next_due && i.next_due < t ? ' class="bad"' : ''}>${escH(i.next_due || '')}</td>
<td>${hist.filter(h => h.item_id === i.id).slice(0, 3).map(h => escH(h.done_on) + (h.vendor ? ' (' + escH(h.vendor) + ')' : '') + (h.note ? ': ' + escH(h.note) : '')).join('<br>')}</td></tr>`).join('')}</table>
${points.map(p => `<div class="eb">${escH(p.name)} · ${p.kind === 'hot' ? 'minimum ' + p.min_f : 'maximum ' + p.max_f}°F</div>
<div class="wrap"><table><tr><th></th>${dates.map(d => `<th class="c">${d.slice(5).replace('-', '/')}</th>`).join('')}</tr>
<tr><th>AM</th>${dates.map(d => cell(p, d, true)).join('')}</tr>${p.checks >= 2 ? `<tr><th>PM</th>${dates.map(d => cell(p, d, false)).join('')}</tr>` : ''}</table></div>`).join('')}
<div class="eb">Out-of-range readings and corrective action</div>
${bad.length ? `<table><tr><th>When</th><th>Unit</th><th>Reading</th><th>Action</th><th>By</th></tr>${bad.map(l => `<tr><td>${escH(l.date)} ${l.time}</td><td>${escH(l.name)}</td><td class="bad">${l.reading}°F</td><td>${escH(l.action || l.note || '')}${l.wo_id ? ' (maintenance WO #' + l.wo_id + ')' : ''}</td><td>${escH(l.by)}</td></tr>`).join('')}</table>` : '<p class="dim">None in this period.</p>'}
</div></body></html>`;
}

/* =================================================================
   DEMO DATA
   ================================================================= */
function seedDemo() {
  if (!DEMO_MODE) return;
  ensureKitchenDefaults();
  const t = today();
  if (db.prepare('SELECT COUNT(*) c FROM temp_logs').get().c === 0) {
    const pts = db.prepare('SELECT * FROM temp_points').all();
    const ins = db.prepare('INSERT INTO temp_logs (point_id, reading, ok, by, at, note, action) VALUES (?,?,?,?,?,?,?)');
    for (let i = 6; i >= 0; i--) {
      const d = addDays(t, -i);
      pts.forEach((p, k) => {
        [13, 21].slice(0, p.checks).forEach((hUtc, j) => {
          if (i === 0 && j === 1) return;
          if ((k + i) % 9 === 4) return; // a few missed checks
          let r = p.kind === 'hot' ? 182 + ((i + k) % 4) : p.kind === 'freezer' ? -6 + ((i * 3 + k) % 5) : 36 + ((i + j + k) % 4);
          let note = '', action = '';
          if (p.name === 'Walk-in cooler' && i === 0) { r = 44; action = 'Moved dairy to reach-ins, called maintenance'; }
          ins.run(p.id, r, tempOk(p, r) ? 1 : 0, j ? 'Chef Daniel' : 'Opening cook', `${d} ${String(hUtc).padStart(2, '0')}:1${k}:00`, note, action);
        });
      });
    }
  }
  const items = db.prepare('SELECT * FROM compliance_items').all();
  if (items.length && !items.some(i => i.last_done)) {
    const lags = [150, 70, 95, 40, 12, 20, 60, 35, 200, 10];
    items.forEach((it, i) => {
      const done = addDays(t, -lags[i % lags.length]);
      db.prepare('UPDATE compliance_items SET last_done=?, next_due=? WHERE id=?').run(done, addDays(done, it.freq_days), it.id);
      db.prepare('INSERT INTO compliance_log (item_id, done_on, by, note) VALUES (?,?,?,?)').run(it.id, done, 'Demo', 'Completed');
    });
    const hood = db.prepare(`SELECT id FROM vendors WHERE name LIKE '%Hood%'`).get();
    if (hood) db.prepare(`UPDATE compliance_items SET vendor_id=? WHERE title LIKE 'Hood%' OR title LIKE 'Grease%'`).run(hood.id);
  }
  if (db.prepare('SELECT COUNT(*) c FROM events').get().c === 0) {
    const ins = db.prepare('INSERT INTO events (title, kind, start_date, end_date, start_time, end_time, buildings, guests, no_work, notes, source) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    ins.run('Member-Guest Invitational', 'Tournament', addDays(t, 2), addDays(t, 4), '07:00', '19:00', 'Clubhouse, Golf Shop, Cart Barn', 240, 1, 'Sample event', 'manual');
    ins.run('Wedding reception, Ballroom', 'Wedding', addDays(t, 10), addDays(t, 10), '16:00', '23:30', 'Clubhouse', 180, 1, 'Sample event', 'manual');
    ins.run('Junior tennis clinic', 'Tennis event', addDays(t, 6), addDays(t, 6), '09:00', '12:00', 'Indoor Tennis Center', 40, 0, 'Sample event', 'manual');
    ins.run('Holiday open house', 'Member event', addDays(t, 24), addDays(t, 24), '17:00', '21:00', '', 400, 1, 'Sample event', 'manual');
  }
  if (!db.prepare('SELECT COUNT(*) c FROM units WHERE install_year IS NOT NULL').get().c) {
    const set = db.prepare('UPDATE units SET install_year=?, condition=? WHERE apt=?');
    [['BLR-1', 2016, 3], ['BLR-2', 2016, 3], ['CT-1', 2008, 2], ['HX-1', 2008, 3], ['P-1', 2008, 3], ['P-2', 2008, 2], ['P-3', 2012, 3],
     ['ET-1', 2008, 3], ['WT-1', 2015, 3], ['BAS-1', 2011, 2], ['HP-CH-01', 2010, 2], ['HP-CH-02', 2010, 3], ['HP-CH-03', 2009, 1],
     ['HP-CH-04', 2022, 4], ['HP-CH-05', 2013, 3], ['KIT-WIC-1', 2012, 2], ['KIT-ICE-1', 2018, 3], ['DHW-1', 2014, 3],
     ['RTU-TN-1', 2011, 3], ['HP-FC-01', 2017, 4], ['POOL-1', 2019, 3], ['HP-PP-01', 2015, 3], ['HP-FT-01', 2020, 4], ['SS-GS-1', 2012, 3]]
      .forEach(r => set.run(r[1], r[2], r[0]));
    db.prepare(`UPDATE units SET replace_cost=135000 WHERE apt='CT-1'`).run();
  }
}

/* =================================================================
   ROUTES
   ================================================================= */
function mount(app, auth) {
  const mgr = u => u.role === 'admin' || u.role === 'manager';

  /* ----- map ----- */
  app.get('/api/map', auth, (req, res) => res.json({ layout: layout(), buildings: buildingStatus(), canvas: { w: 1000, h: 1300 } }));
  app.get('/api/map/building', auth, (req, res) => res.json(buildingDetail(clip(req.query.name, 80))));
  app.put('/api/map/layout', auth, (req, res) => {
    if (!mgr(req.user)) return res.status(403).json({ error: 'Only a manager can move buildings on the map' });
    const b = (req.body || {}).layout || {};
    const clean = {};
    Object.keys(b).slice(0, 60).forEach(k => {
      const r = b[k]; if (!r) return;
      const n = v => Math.max(0, Math.min(1300, Math.round(+v || 0)));
      clean[clip(k, 80)] = { x: n(r.x), y: n(r.y), w: Math.max(60, n(r.w)), h: Math.max(50, n(r.h)) };
    });
    setSetting('map_layout', JSON.stringify(clean));
    res.json({ layout: layout() });
  });
  app.delete('/api/map/layout', auth, (req, res) => {
    if (!mgr(req.user)) return res.status(403).json({ error: 'Only a manager can reset the map' });
    setSetting('map_layout', '{}'); res.json({ layout: layout() });
  });

  /* ----- capital ----- */
  app.get('/api/capital', auth, (req, res) => res.json(capitalPlan()));
  app.get('/api/capital/report', auth, (req, res) => res.json({ html: capitalHtml(capitalPlan()) }));
  app.put('/api/capital/:id', auth, (req, res) => {
    if (req.user.role === 'viewer' || req.user.role === 'staff') return res.status(403).json({ error: 'View only' });
    const u = db.prepare('SELECT * FROM units WHERE id=?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Equipment not found' });
    const b = req.body || {};
    const yr = v => { const n = parseInt(v, 10); return n >= 1950 && n <= 2100 ? n : null; };
    db.prepare('UPDATE units SET install_year=?, expected_life=?, replace_cost=?, replace_year=?, condition=? WHERE id=?').run(
      b.install_year === undefined ? u.install_year : yr(b.install_year),
      b.expected_life === undefined ? u.expected_life : (parseInt(b.expected_life, 10) > 0 ? parseInt(b.expected_life, 10) : null),
      b.replace_cost === undefined ? u.replace_cost : num(b.replace_cost),
      b.replace_year === undefined ? u.replace_year : yr(b.replace_year),
      b.condition === undefined ? u.condition : Math.max(1, Math.min(5, parseInt(b.condition, 10) || 3)), u.id);
    res.json(capitalPlan());
  });
  app.put('/api/capital-settings', auth, (req, res) => {
    if (!mgr(req.user)) return res.status(403).json({ error: 'Only a manager can change this' });
    const v = num((req.body || {}).inflation);
    if (v != null && v >= 0 && v <= 15) setSetting('cap_inflation', v);
    res.json(capitalPlan());
  });

  /* ----- photos and sign-off ----- */
  app.get('/api/workorders/:id/photos', auth, (req, res) => {
    res.json({ photos: db.prepare('SELECT id, kind, by, at FROM wo_photos WHERE wo_id=? ORDER BY id').all(req.params.id) });
  });
  app.post('/api/workorders/:id/photos', auth, (req, res) => {
    const w = db.prepare('SELECT id FROM work_orders WHERE id=?').get(req.params.id);
    if (!w) return res.status(404).json({ error: 'Work order not found' });
    const b = req.body || {};
    if (!b64ok(b.data)) return res.status(400).json({ error: 'That photo could not be saved. Try a smaller one.' });
    const kind = ['before', 'after', 'other'].includes(b.kind) ? b.kind : 'other';
    if (db.prepare('SELECT COUNT(*) c FROM wo_photos WHERE wo_id=?').get(w.id).c >= 12) return res.status(400).json({ error: 'Twelve photos is the limit per work order' });
    db.prepare('INSERT INTO wo_photos (wo_id, kind, data, by) VALUES (?,?,?,?)').run(w.id, kind, b.data, req.user.name);
    db.prepare(`INSERT INTO wo_notes (wo_id, kind, body, by) VALUES (?, 'status', ?, ?)`).run(w.id, `Added ${kind === 'other' ? 'a' : 'a ' + kind} photo.`, req.user.name);
    res.json({ photos: db.prepare('SELECT id, kind, by, at FROM wo_photos WHERE wo_id=? ORDER BY id').all(w.id) });
  });
  app.get('/api/wo-photo/:id', auth, (req, res) => {
    const r = db.prepare('SELECT data FROM wo_photos WHERE id=?').get(req.params.id);
    if (!r) return res.status(404).end();
    res.set('Content-Type', 'image/jpeg'); res.set('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(r.data, 'base64'));
  });
  app.delete('/api/wo-photo/:id', auth, (req, res) => {
    db.prepare('DELETE FROM wo_photos WHERE id=?').run(req.params.id); res.json({ ok: true });
  });
  app.get('/api/workorders/:id/signature', auth, (req, res) => {
    const r = db.prepare('SELECT signature FROM work_orders WHERE id=?').get(req.params.id);
    if (!r || !r.signature) return res.status(404).end();
    res.set('Content-Type', 'image/png'); res.send(Buffer.from(r.signature, 'base64'));
  });

  /* ----- events ----- */
  app.get('/api/events', auth, async (req, res) => {
    if (getSetting('events_ics_url')) await syncIcs(false);
    const days = Math.min(400, parseInt(req.query.days, 10) || 90);
    res.json({ events: upcomingEvents(days), kinds: EVENT_KINDS, buildings: buildings(), ics: getSetting('events_ics_url') || '', synced: getSetting('events_ics_synced') });
  });
  const evFields = b => {
    const s = isDate(b.start_date) ? b.start_date : null;
    let e = isDate(b.end_date) ? b.end_date : s;
    if (s && e < s) e = s;
    return { title: clip(b.title, 160), kind: EVENT_KINDS.includes(b.kind) ? b.kind : 'Member event', start_date: s, end_date: e,
             start_time: clip(b.start_time, 5), end_time: clip(b.end_time, 5),
             buildings: Array.isArray(b.buildings) ? b.buildings.map(x => clip(x, 80)).filter(Boolean).join(', ') : clip(b.buildings, 400),
             guests: Math.max(0, parseInt(b.guests, 10) || 0), no_work: b.no_work === false || b.no_work === 0 ? 0 : 1, notes: clip(b.notes, 1000) };
  };
  app.post('/api/events', auth, (req, res) => {
    const f = evFields(req.body || {});
    if (!f.title || !f.start_date) return res.status(400).json({ error: 'Event name and date are required' });
    const info = db.prepare(`INSERT INTO events (title, kind, start_date, end_date, start_time, end_time, buildings, guests, no_work, notes, created_by)
      VALUES (@title,@kind,@start_date,@end_date,@start_time,@end_time,@buildings,@guests,@no_work,@notes,@by)`).run(Object.assign(f, { by: req.user.name }));
    const ev = db.prepare('SELECT * FROM events WHERE id=?').get(info.lastInsertRowid);
    res.json({ event: Object.assign(ev, { conflicts: ev.no_work ? conflictsFor(ev) : [] }) });
  });
  app.put('/api/events/:id', auth, (req, res) => {
    const ev = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    const f = evFields(Object.assign({}, ev, req.body || {}));
    db.prepare(`UPDATE events SET title=@title, kind=@kind, start_date=@start_date, end_date=@end_date, start_time=@start_time, end_time=@end_time,
      buildings=@buildings, guests=@guests, no_work=@no_work, notes=@notes WHERE id=@id`).run(Object.assign(f, { id: ev.id }));
    const e2 = db.prepare('SELECT * FROM events WHERE id=?').get(ev.id);
    res.json({ event: Object.assign(e2, { conflicts: e2.no_work ? conflictsFor(e2) : [] }) });
  });
  app.delete('/api/events/:id', auth, (req, res) => { db.prepare('DELETE FROM events WHERE id=?').run(req.params.id); res.json({ ok: true }); });
  app.put('/api/events-feed', auth, async (req, res) => {
    if (!mgr(req.user)) return res.status(403).json({ error: 'Only a manager can link the club calendar' });
    const url = clip((req.body || {}).url, 600);
    if (url && !/^(https?|webcal):\/\//i.test(url)) return res.status(400).json({ error: 'Paste the calendar link that starts with https:// or webcal://' });
    setSetting('events_ics_url', url || null); setSetting('events_ics_synced', null);
    if (!url) { db.prepare(`DELETE FROM events WHERE source='calendar'`).run(); return res.json({ ok: true, count: 0 }); }
    const r = await syncIcs(true);
    if (!r.ok) return res.status(400).json({ error: 'Could not read that calendar: ' + r.error });
    res.json(r);
  });
  // Dates the scheduler should know about: used to warn on PM and WO screens.
  app.get('/api/events/blackouts', auth, (req, res) => {
    const t = today();
    res.json({ events: db.prepare(`SELECT id, title, kind, start_date, end_date, buildings FROM events WHERE no_work=1 AND date(end_date) >= date(?) AND date(start_date) <= date(?, '+120 days') ORDER BY start_date`).all(t, t) });
  });

  /* ----- kitchen ----- */
  app.get('/api/kitchen', auth, (req, res) => res.json(kitchenState()));
  app.post('/api/kitchen/temps', auth, (req, res) => {
    const b = req.body || {};
    const p = db.prepare('SELECT p.*, u.building, u.apt FROM temp_points p LEFT JOIN units u ON u.id=p.unit_id WHERE p.id=?').get(b.point_id);
    if (!p) return res.status(404).json({ error: 'Unknown temperature point' });
    const r = num(b.reading);
    if (r == null || r < -40 || r > 250) return res.status(400).json({ error: 'Enter the temperature in °F' });
    const ok = tempOk(p, r);
    let woId = null;
    if (!ok) {
      // One maintenance ticket per point per day, not one per reading.
      const openWo = db.prepare(`SELECT w.id FROM temp_logs l JOIN work_orders w ON w.id=l.wo_id WHERE l.point_id=? AND w.status IN ('new','open','in_progress','on_hold') ORDER BY l.id DESC LIMIT 1`).get(p.id);
      if (openWo) woId = openWo.id;
      else {
        const hot = p.kind === 'hot';
        const title = `${p.name} reading ${r}°F (${hot ? 'min ' + p.min_f : 'max ' + p.max_f}°F)`;
        const info = db.prepare(`INSERT INTO work_orders (unit_id, building, location, title, description, category, priority, status, source,
            requested_by, requester_dept, due_date, created_by, created_by_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(p.unit_id, p.building || 'Clubhouse', p.location || '', title,
            `Logged by ${req.user.name} on the kitchen temperature log.` + (b.action ? `\nKitchen action: ${clip(b.action, 300)}` : ''),
            hot ? 'Kitchen' : 'Refrigeration', (p.kind === 'freezer' && r > 10) || (p.kind === 'cooler' && r > 45) ? 'emergency' : 'high',
            'new', 'request', req.user.name, 'Kitchen', today(), req.user.name, req.user.id > 0 ? req.user.id : null);
        woId = info.lastInsertRowid;
        db.prepare(`INSERT INTO wo_notes (wo_id, kind, body, by) VALUES (?, 'status', ?, ?)`).run(woId, 'Opened automatically from an out-of-range temperature.', req.user.name);
        ops.kick();
      }
    }
    db.prepare('INSERT INTO temp_logs (point_id, reading, ok, note, action, wo_id, by) VALUES (?,?,?,?,?,?,?)')
      .run(p.id, r, ok ? 1 : 0, clip(b.note, 300), clip(b.action, 300), woId, req.user.name);
    res.json({ ok, wo_id: woId, state: kitchenState() });
  });
  app.delete('/api/kitchen/temps/:id', auth, (req, res) => {
    if (!mgr(req.user)) return res.status(403).json({ error: 'Only a manager can remove a reading' });
    db.prepare('DELETE FROM temp_logs WHERE id=?').run(req.params.id); res.json({ ok: true });
  });
  app.post('/api/kitchen/points', auth, (req, res) => {
    const b = req.body || {};
    const name = clip(b.name, 80); if (!name) return res.status(400).json({ error: 'Name it, like Walk-in cooler' });
    const kind = ['cooler', 'freezer', 'hot'].includes(b.kind) ? b.kind : 'cooler';
    const u = b.apt ? db.prepare('SELECT id FROM units WHERE apt=?').get(String(b.apt).toUpperCase().trim()) : null;
    const vals = [name, kind, kind === 'hot' ? num(b.min_f, 180) : null, kind === 'hot' ? null : num(b.max_f, kind === 'freezer' ? 0 : 41),
      Math.max(1, Math.min(4, parseInt(b.checks, 10) || 2)), clip(b.location, 80), u ? u.id : null];
    if (b.id) db.prepare('UPDATE temp_points SET name=?, kind=?, min_f=?, max_f=?, checks=?, location=?, unit_id=? WHERE id=?').run(...vals, b.id);
    else db.prepare('INSERT INTO temp_points (name, kind, min_f, max_f, checks, location, unit_id, sort) VALUES (?,?,?,?,?,?,?,99)').run(...vals);
    res.json(kitchenState());
  });
  app.delete('/api/kitchen/points/:id', auth, (req, res) => { db.prepare('UPDATE temp_points SET active=0 WHERE id=?').run(req.params.id); res.json(kitchenState()); });
  app.post('/api/kitchen/items/:id/done', auth, (req, res) => {
    const it = db.prepare('SELECT * FROM compliance_items WHERE id=?').get(req.params.id);
    if (!it) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const d = isDate(b.done_on) ? b.done_on : today();
    db.prepare('INSERT INTO compliance_log (item_id, done_on, by, note, vendor) VALUES (?,?,?,?,?)').run(it.id, d, req.user.name, clip(b.note, 300), clip(b.vendor, 80));
    const last = db.prepare('SELECT MAX(done_on) d FROM compliance_log WHERE item_id=?').get(it.id).d;
    db.prepare('UPDATE compliance_items SET last_done=?, next_due=? WHERE id=?').run(last, addDays(last, it.freq_days), it.id);
    res.json(kitchenState());
  });
  app.post('/api/kitchen/items', auth, (req, res) => {
    const b = req.body || {};
    const title = clip(b.title, 120); if (!title) return res.status(400).json({ error: 'Name the item' });
    const freq = Math.max(1, parseInt(b.freq_days, 10) || 90);
    const vid = parseInt(b.vendor_id, 10) || null;
    if (b.id) {
      const it = db.prepare('SELECT * FROM compliance_items WHERE id=?').get(b.id);
      db.prepare('UPDATE compliance_items SET title=?, freq_days=?, vendor_id=?, why=?, next_due=? WHERE id=?')
        .run(title, freq, vid, clip(b.why, 400), it && it.last_done ? addDays(it.last_done, freq) : (it ? it.next_due : today()), b.id);
    } else db.prepare('INSERT INTO compliance_items (title, area, freq_days, vendor_id, why, next_due, sort) VALUES (?,?,?,?,?,?,99)').run(title, 'Kitchen', freq, vid, clip(b.why, 400), today());
    res.json(kitchenState());
  });
  app.delete('/api/kitchen/items/:id', auth, (req, res) => { db.prepare('UPDATE compliance_items SET active=0 WHERE id=?').run(req.params.id); res.json(kitchenState()); });
  app.get('/api/kitchen/item/:id/log', auth, (req, res) => {
    res.json({ log: db.prepare('SELECT * FROM compliance_log WHERE item_id=? ORDER BY done_on DESC LIMIT 30').all(req.params.id) });
  });
  app.get('/api/kitchen/binder', auth, (req, res) => res.json({ html: binderHtml(Math.min(90, parseInt(req.query.days, 10) || 30)) }));

  seedDemo();
  setInterval(() => { if (getSetting('events_ics_url')) syncIcs(false); }, 6 * 3600 * 1000);
}

/* Extra alerts contributed to the alert center. */
function alerts(user) {
  const out = [];
  if (!user || user.role === 'staff') {
    if (user && user.role === 'staff' && user.dept === 'Kitchen') {
      const k = kitchenState();
      if (k.due_now) out.push({ level: 'warn', kind: 'temps', title: `${k.due_now} temperature check${k.due_now > 1 ? 's' : ''} due`, detail: 'Kitchen log', go: { tab: 'kitchen' } });
    }
    return out;
  }
  try {
    upcomingEvents(14).filter(e => e.conflicts.length).forEach(e => out.push({ level: e.days_out <= 3 ? 'warn' : 'info', kind: 'event',
      title: `${e.conflicts.length} item${e.conflicts.length > 1 ? 's' : ''} scheduled during ${e.title}`,
      detail: `${e.start_date}${e.end_date !== e.start_date ? ' to ' + e.end_date : ''} · move them or plan around it`, go: { tab: 'work', view: 'events' } }));
    const k = kitchenState();
    const late = k.items.filter(i => i.state === 'late' || i.state === 'never');
    if (late.length) out.push({ level: 'warn', kind: 'kitchen', title: `${late.length} kitchen inspection item${late.length > 1 ? 's' : ''} past due`, detail: late.slice(0, 2).map(i => i.title).join(', '), go: { tab: 'kitchen' } });
    if (k.out_of_range_7) out.push({ level: 'info', kind: 'temps', title: `${k.out_of_range_7} out-of-range kitchen temperature${k.out_of_range_7 > 1 ? 's' : ''} this week`, detail: '', go: { tab: 'kitchen' } });
    const cap = capitalPlan();
    if (cap.totals.overdue) out.push({ level: 'info', kind: 'capital', title: `${cap.totals.overdue} piece${cap.totals.overdue > 1 ? 's' : ''} of equipment past expected life`, detail: money(cap.totals.overdue_cost) + ' to replace', go: { tab: 'capital' } });
  } catch (e) { /* alerts are best-effort */ }
  return out;
}

module.exports = { mount, alerts, kitchenState, upcomingEvents };
