/**
 * Work orders, preventive maintenance schedule, staff request portal, and the
 * manager dashboard.
 *
 * Mounted from server.js:  require('./workorders')(app, auth)
 */
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const { db } = require('./db');
const { getProfile } = require('./profiles');

const STATUSES = ['new', 'open', 'in_progress', 'on_hold', 'done', 'cancelled'];
const OPEN_STATUSES = ['new', 'open', 'in_progress', 'on_hold'];
const PRIORITIES = ['emergency', 'high', 'normal', 'low'];
const STATUS_LABEL = {
  new: 'Received', open: 'Scheduled', in_progress: 'In progress',
  on_hold: 'On hold', done: 'Completed', cancelled: 'Closed'
};
// How long each priority gets before a work order counts as overdue.
const PRIORITY_DAYS = { emergency: 0, high: 1, normal: 7, low: 30 };

const DEFAULT_BUILDINGS = [
  'Clubhouse', 'Central Plant', 'Indoor Tennis Center', 'Fitness Center',
  'Pool Pavilion', 'Family & Teen Center', 'Golf Shop', 'Cart Barn',
  'Maintenance Shop', 'Grounds / Course'
];
const DEPARTMENTS = [
  'Kitchen', 'Dining / Banquets', 'Front Desk', 'Golf Shop', 'Tennis',
  'Fitness', 'Pool', 'Housekeeping', 'Grounds', 'Administration',
  'Member', 'Other'
];
const CATEGORIES = ['HVAC', 'Boiler', 'Cooling tower', 'Water treatment', 'Plumbing',
  'Electrical', 'Refrigeration', 'Kitchen', 'Pool', 'Building', 'Grounds', 'PM', 'General'];

const OPEN_SQL = `('new','open','in_progress','on_hold')`;

/* ---------------- helpers ---------------- */

const today = () => new Date().toISOString().slice(0, 10);
function addDays(dateStr, n) {
  const d = new Date((dateStr || today()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function unitByTag(tag) {
  if (!tag) return null;
  return db.prepare('SELECT * FROM units WHERE apt=?').get(String(tag).trim().toUpperCase()) || null;
}

function addNote(woId, body, by, kind = 'note') {
  db.prepare('INSERT INTO wo_notes (wo_id, kind, body, by) VALUES (?,?,?,?)').run(woId, kind, body, by || '');
}

function woRow(id) {
  return db.prepare(`
    SELECT w.*, u.apt, u.system_type,
           (w.photo IS NOT NULL AND w.photo != '') AS has_photo
    FROM work_orders w LEFT JOIN units u ON u.id = w.unit_id
    WHERE w.id=?`).get(id);
}

function woFull(id) {
  const w = woRow(id);
  if (!w) return null;
  delete w.photo;
  delete w.track_code;
  w.notes = db.prepare('SELECT * FROM wo_notes WHERE wo_id=? ORDER BY id').all(id);
  if (w.pm_id) {
    const pm = db.prepare('SELECT id, title, checklist, freq_days, next_due FROM pm_tasks WHERE id=?').get(w.pm_id);
    w.pm = pm || null;
  }
  return w;
}

function trackCode() {
  // Short, unambiguous, hard to guess. No 0/O or 1/I.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

function buildingList() {
  const fromUnits = db.prepare(`SELECT DISTINCT building FROM units WHERE building IS NOT NULL AND building != '' ORDER BY building`)
    .all().map(r => r.building);
  const all = [...fromUnits];
  DEFAULT_BUILDINGS.forEach(b => { if (!all.includes(b)) all.push(b); });
  return all;
}

/* ---------------- preventive maintenance ---------------- */

// Open a work order for every PM task coming due inside its lead window,
// unless one is already open for it. Cheap enough to run on every list call.
function ensurePmWorkOrders() {
  const due = db.prepare(`
    SELECT p.*, u.apt FROM pm_tasks p LEFT JOIN units u ON u.id = p.unit_id
    WHERE p.active=1 AND date(p.next_due) <= date('now', '+' || p.lead_days || ' days')
      AND NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.pm_id=p.id AND w.status IN ${OPEN_SQL})`).all();
  const ins = db.prepare(`
    INSERT INTO work_orders (unit_id, building, title, description, category, priority, status, source, pm_id, due_date, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  let made = 0;
  for (const p of due) {
    const title = p.apt ? `PM: ${p.title} (${p.apt})` : `PM: ${p.title}`;
    const info = ins.run(p.unit_id, p.building || '', title, p.checklist || '', p.category || 'PM',
      'normal', 'open', 'pm', p.id, p.next_due, 'PM schedule');
    addNote(info.lastInsertRowid, `Opened automatically. Due ${p.next_due}, repeats every ${p.freq_days} days.`, 'PM schedule', 'status');
    made++;
  }
  return made;
}

// Standard preventive maintenance by equipment type, tuned for the club's
// central plant and loop. [title, every N days, category, checklist lines]
const STARTER = {
  boiler: [
    ['Test low water cutoff', 30, 'Boiler', 'Blow down or test LWCO with burner firing\nConfirm burner shuts down\nLog result on boiler tag'],
    ['Condensate trap and neutralizer', 90, 'Boiler', 'Clean condensate trap\nCheck neutralizer media, replace if spent\nCheck flue for leaks'],
    ['Annual boiler service and combustion test', 365, 'Boiler', 'Combustion analysis, log CO and O2\nClean flame sensor, check igniter\nInspect heat exchanger\nCheck state certificate date']
  ],
  tower: [
    ['Cooling tower inspection', 30, 'Cooling tower', 'Basin level and makeup float\nStrainer and basin debris\nFan, belt, and vibration switch\nDrift eliminators and fill\nBleed and chemical feed working'],
    ['Tower fan drive service', 90, 'Cooling tower', 'Gearbox oil level or belt tension\nGrease fan bearings\nMotor amps'],
    ['Tower spring startup', 365, 'Cooling tower', 'Clean and refill basin\nInspect fill and nozzles\nTest basin heater and vibration switch\nStart chemical program']
  ],
  pump: [
    ['Loop pump inspection', 90, 'HVAC', 'Seal leaks\nBearing noise and vibration\nMotor amps against nameplate\nSuction and discharge pressure\nClean strainer if DP is high'],
    ['Rotate lead and lag pumps', 30, 'HVAC', 'Swap lead pump\nConfirm flow proven on new lead']
  ],
  hx: [['Plate heat exchanger approach check', 90, 'HVAC', 'Log entering and leaving temps both sides\nCompare approach to baseline\nCheck for leaks at frame']],
  accessory: [['Expansion tank and air separator check', 180, 'HVAC', 'Check tank precharge\nBleed air separator\nCheck makeup PRV setting and backflow']],
  chem: [
    ['Loop and tower water test', 7, 'Water treatment', 'Test loop inhibitor level\nTest tower conductivity and pH\nLog results'],
    ['Chemical feed and inventory', 30, 'Water treatment', 'Check feed pumps and tubing\nCheck drum levels, reorder if low\nVerify bleed valve operation']
  ],
  wshp: [
    ['Heat pump filter change', 90, 'HVAC', 'Replace filter\nNote filter size on record'],
    ['Heat pump semiannual PM', 180, 'HVAC', 'Clean hose kit strainer\nCheck water temp rise or drop\nFlush condensate and test switch\nCheck compressor and fan amps']
  ],
  package: [
    ['Filter change', 90, 'HVAC', 'Replace filters\nCheck belts'],
    ['Seasonal PM', 180, 'HVAC', 'Clean coils\nFlush condensate\nCheck amps and refrigerant temps\nInspect economizer']
  ],
  split: [
    ['Filter change', 90, 'HVAC', 'Replace filter'],
    ['Seasonal PM', 180, 'HVAC', 'Clean coils\nFlush condensate and test float switch\nCheck amps and refrigerant temps']
  ],
  ductless: [['Ductless clean and inspect', 180, 'HVAC', 'Wash filters\nClean coil and blower wheel\nFlush drain\nCheck for fault history']],
  vrf: [['VRF seasonal PM', 180, 'HVAC', 'Clean indoor filters\nCheck outdoor unit fault history\nClean condenser coil\nCheck drains']],
  walkin: [['Walk-in cooler / freezer PM', 90, 'Refrigeration', 'Clean condenser coil\nCheck door gasket and heater\nVerify box temp and defrost\nCheck drain line heater (freezer)']],
  ice: [
    ['Ice machine clean and sanitize', 180, 'Kitchen', 'Descale and sanitize per manufacturer\nClean bin\nCheck water filter'],
    ['Ice machine water filter change', 180, 'Kitchen', 'Replace filter cartridge\nDate the housing']
  ],
  kitchen: [['Kitchen equipment inspection', 90, 'Kitchen', 'Gas connections and shutoffs\nPilot and burner operation\nHood filters and fan']],
  pool: [['Pool equipment check', 30, 'Pool', 'Pump and seal\nFilter pressure, backwash if high\nHeater operation\nChemical feeder and controller calibration']],
  dhw: [['Water heater flush and T&P test', 365, 'Plumbing', 'Flush tank\nTest T&P valve\nCheck anode (tank type)\nCheck venting']],
  bas: [['BAS alarm and trend review', 30, 'HVAC', 'Clear or resolve standing alarms\nCheck loop temp trends\nConfirm schedules match club calendar']]
};

function createStarterPlan(byName) {
  const units = db.prepare(`SELECT id, apt, building, system_type FROM units ORDER BY building, apt`).all();
  const exists = db.prepare('SELECT 1 FROM pm_tasks WHERE unit_id=? AND title=? AND active=1');
  const ins = db.prepare(`INSERT INTO pm_tasks (unit_id, building, title, checklist, category, freq_days, lead_days, next_due)
                          VALUES (?,?,?,?,?,?,?,?)`);
  let made = 0, i = 0;
  const tx = db.transaction(() => {
    for (const u of units) {
      const key = getProfile(u.system_type).key;
      for (const [title, days, cat, list] of (STARTER[key] || [])) {
        if (exists.get(u.id, title)) continue;
        // Stagger first due dates so everything doesn't land on one day.
        const window = Math.min(days, 28);
        const offset = (i * 3) % window;
        const lead = days <= 7 ? 1 : days <= 30 ? 5 : 10;
        ins.run(u.id, u.building || '', title, list, cat, days, lead, addDays(today(), offset));
        made++; i++;
      }
    }
  });
  tx();
  return made;
}

/* ---------------- completing work ---------------- */

function completeWorkOrder(w, body, userName) {
  const resolution = clip(body.resolution, 4000);
  const hours = parseFloat(body.hours || 0) || 0;
  const cost = parseFloat(body.cost_avoided || 0) || 0;
  const parts = clip(body.parts_used, 500);
  const checked = Array.isArray(body.checklist_done) ? body.checklist_done.map(s => clip(s, 200)).filter(Boolean) : [];
  const skipped = Array.isArray(body.checklist_skipped) ? body.checklist_skipped.map(s => clip(s, 200)).filter(Boolean) : [];

  let work = resolution;
  if (checked.length) work += (work ? '\n' : '') + 'Checklist done: ' + checked.join('; ');
  if (skipped.length) work += (work ? '\n' : '') + 'Not done: ' + skipped.join('; ');

  let jobId = null;
  if (w.unit_id) {
    const info = db.prepare(`
      INSERT INTO jobs (unit_id, job_date, reported, category, priority, diagnosis, work_performed,
                        parts_used, vendor_cost_avoided, cost_basis, hours, logged_by, error_code, wo_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(w.unit_id, today(),
        `WO #${w.id}: ${w.title}` + (w.description && w.source !== 'pm' ? ` / ${w.description}` : ''),
        w.category || 'General', w.priority === 'emergency' ? 'emergency' : (w.priority === 'high' ? 'same-day' : w.priority || 'normal'),
        clip(body.diagnosis, 500), work, parts, cost, clip(body.cost_basis, 200), hours, userName, clip(body.error_code, 60), w.id);
    jobId = info.lastInsertRowid;
  }

  db.prepare(`UPDATE work_orders SET status='done', resolution=?, hours=?, cost_avoided=?, job_id=?,
              completed_at=datetime('now'), updated_at=datetime('now'),
              started_at=COALESCE(started_at, datetime('now')),
              assigned_to=CASE WHEN assigned_to='' THEN ? ELSE assigned_to END
              WHERE id=?`).run(work, hours, cost, jobId, userName, w.id);
  addNote(w.id, 'Completed' + (hours ? ` in ${hours} hr` : '') + (jobId ? '. Logged to equipment history.' : '.'), userName, 'status');

  // Roll the PM forward from the day it was actually done.
  if (w.pm_id) {
    const pm = db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(w.pm_id);
    if (pm) {
      db.prepare('UPDATE pm_tasks SET last_done=?, next_due=? WHERE id=?')
        .run(today(), addDays(today(), pm.freq_days), pm.id);
    }
  }
}

/* ---------------- dashboard ---------------- */

function dashboard() {
  ensurePmWorkOrders();
  const t = today();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);

  const wo = one(`
    SELECT
      SUM(CASE WHEN status IN ${OPEN_SQL} AND source != 'pm' THEN 1 ELSE 0 END) open,
      SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) new_requests,
      SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) in_progress,
      SUM(CASE WHEN status='on_hold' THEN 1 ELSE 0 END) on_hold,
      SUM(CASE WHEN status IN ${OPEN_SQL} AND priority='emergency' THEN 1 ELSE 0 END) emergency,
      SUM(CASE WHEN status IN ${OPEN_SQL} AND priority='high' THEN 1 ELSE 0 END) high,
      SUM(CASE WHEN status IN ${OPEN_SQL} AND due_date IS NOT NULL AND date(due_date) < date(?) THEN 1 ELSE 0 END) overdue,
      SUM(CASE WHEN status='done' AND date(completed_at) >= date('now','-7 days') THEN 1 ELSE 0 END) done_7,
      SUM(CASE WHEN status='done' AND date(completed_at) >= date('now','-30 days') THEN 1 ELSE 0 END) done_30,
      SUM(CASE WHEN source != 'pm' AND date(created_at) >= date('now','-30 days') THEN 1 ELSE 0 END) created_30,
      SUM(CASE WHEN status IN ${OPEN_SQL} AND source='pm' THEN 1 ELSE 0 END) open_pm,
      SUM(CASE WHEN source='request' AND date(created_at) >= date('now','-30 days') THEN 1 ELSE 0 END) requests_30
    FROM work_orders`, t);
  Object.keys(wo).forEach(k => { wo[k] = wo[k] || 0; });

  const close = one(`
    SELECT AVG(julianday(completed_at) - julianday(created_at)) d, COUNT(*) n
    FROM work_orders WHERE status='done' AND source != 'pm' AND date(completed_at) >= date('now','-30 days')`);
  wo.avg_close_days = close.n ? Math.round(close.d * 10) / 10 : null;

  const aging = one(`
    SELECT
      SUM(CASE WHEN julianday('now') - julianday(created_at) < 1 THEN 1 ELSE 0 END) d0,
      SUM(CASE WHEN julianday('now') - julianday(created_at) >= 1 AND julianday('now') - julianday(created_at) < 3 THEN 1 ELSE 0 END) d1,
      SUM(CASE WHEN julianday('now') - julianday(created_at) >= 3 AND julianday('now') - julianday(created_at) < 7 THEN 1 ELSE 0 END) d3,
      SUM(CASE WHEN julianday('now') - julianday(created_at) >= 7 THEN 1 ELSE 0 END) d7
    FROM work_orders WHERE status IN ${OPEN_SQL} AND source != 'pm'`);
  Object.keys(aging).forEach(k => { aging[k] = aging[k] || 0; });

  const pm = one(`
    SELECT COUNT(*) active,
      SUM(CASE WHEN date(next_due) < date(?) THEN 1 ELSE 0 END) overdue,
      SUM(CASE WHEN date(next_due) >= date(?) AND date(next_due) <= date(?, '+7 days') THEN 1 ELSE 0 END) due_7
    FROM pm_tasks WHERE active=1`, t, t, t);
  Object.keys(pm).forEach(k => { pm[k] = pm[k] || 0; });
  const comp = one(`
    SELECT COUNT(*) n,
      SUM(CASE WHEN date(completed_at) <= date(due_date) THEN 1 ELSE 0 END) on_time
    FROM work_orders WHERE source='pm' AND status='done' AND date(completed_at) >= date('now','-90 days')`);
  pm.completed_90 = comp.n || 0;
  pm.on_time_pct = comp.n ? Math.round(100 * (comp.on_time || 0) / comp.n) : null;

  // Labor and cost: jobs, plus closed work orders that had no equipment attached.
  const money = (since) => {
    const j = one(`SELECT COALESCE(SUM(hours),0) h, COALESCE(SUM(vendor_cost_avoided),0) c, COUNT(*) n
                   FROM jobs WHERE date(job_date) >= date(?)`, since);
    const w = one(`SELECT COALESCE(SUM(hours),0) h, COALESCE(SUM(cost_avoided),0) c, COUNT(*) n
                   FROM work_orders WHERE status='done' AND job_id IS NULL AND date(completed_at) >= date(?)`, since);
    return { hours: Math.round((j.h + w.h) * 10) / 10, cost_avoided: Math.round(j.c + w.c), jobs: j.n + w.n };
  };
  const month = money(t.slice(0, 7) + '-01');
  const ytd = money(t.slice(0, 4) + '-01-01');

  // Created vs completed, last 8 weeks (week starting Monday).
  const weeks = [];
  const now = new Date(t + 'T12:00:00Z');
  const dow = (now.getUTCDay() + 6) % 7;
  const monday = addDays(t, -dow);
  for (let i = 7; i >= 0; i--) {
    const start = addDays(monday, -7 * i), end = addDays(start, 7);
    const c = one(`SELECT COUNT(*) n FROM work_orders WHERE source != 'pm' AND date(created_at) >= date(?) AND date(created_at) < date(?)`, start, end).n;
    const d = one(`SELECT COUNT(*) n FROM work_orders WHERE source != 'pm' AND status='done' AND date(completed_at) >= date(?) AND date(completed_at) < date(?)`, start, end).n;
    weeks.push({ week: start, created: c, completed: d });
  }

  const byBuilding = all(`
    SELECT COALESCE(NULLIF(w.building,''), u.building, 'Unassigned') building,
           COUNT(*) open,
           SUM(CASE WHEN w.priority IN ('emergency','high') THEN 1 ELSE 0 END) urgent,
           SUM(CASE WHEN w.due_date IS NOT NULL AND date(w.due_date) < date(?) THEN 1 ELSE 0 END) overdue
    FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
    WHERE w.status IN ${OPEN_SQL}
    GROUP BY 1 ORDER BY open DESC`, t);

  const byCategory = all(`
    SELECT category, COUNT(*) n FROM work_orders
    WHERE date(created_at) >= date('now','-30 days') GROUP BY category ORDER BY n DESC`);

  const attention = all(`
    SELECT w.id, w.title, w.priority, w.status, w.due_date, w.source, w.created_at,
           COALESCE(NULLIF(w.building,''), u.building, '') building, u.apt
    FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
    WHERE w.status IN ${OPEN_SQL}
      AND (w.priority='emergency' OR w.status='new' OR (w.due_date IS NOT NULL AND date(w.due_date) < date(?)))
    ORDER BY CASE w.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
             date(w.due_date) LIMIT 10`, t);

  const overduePms = all(`
    SELECT p.id, p.title, p.next_due, p.freq_days, u.apt, COALESCE(NULLIF(p.building,''), u.building, '') building
    FROM pm_tasks p LEFT JOIN units u ON u.id=p.unit_id
    WHERE p.active=1 AND date(p.next_due) < date(?) ORDER BY date(p.next_due) LIMIT 10`, t);

  const recentDone = all(`
    SELECT w.id, w.title, w.completed_at, w.hours, w.assigned_to, u.apt,
           COALESCE(NULLIF(w.building,''), u.building, '') building
    FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
    WHERE w.status='done' ORDER BY w.completed_at DESC LIMIT 6`);

  const safety = one(`SELECT COUNT(*) n FROM units WHERE switch_present='no' OR switch_functioning='no'`).n;
  const equipment = one(`SELECT COUNT(*) n FROM units`).n;

  return { today: t, wo, aging, pm, month, ytd, weeks, byBuilding, byCategory,
           attention, overduePms, recentDone, safety, equipment };
}

/* ---------------- public rate limit ---------------- */

const hits = new Map();
function rateLimited(ip, max = 8, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

/* ---------------- routes ---------------- */

module.exports = function mount(app, auth) {
  app.set('trust proxy', 1);

  const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const MAINT_PHONE = process.env.MAINT_PHONE || '';
  const origin = req => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const clubName = () => (db.prepare('SELECT name FROM properties WHERE id=1').get() || {}).name || 'Country Club of Little Rock';

  // Friendly URLs for the public pages.
  app.get('/request', (req, res) => res.sendFile(path.join(__dirname, 'public', 'request.html')));
  app.get('/signs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signs.html')));

  /* ----- lookups for forms ----- */
  app.get('/api/wo-meta', auth, (req, res) => {
    const staff = db.prepare('SELECT name FROM users ORDER BY name').all().map(r => r.name);
    const tags = db.prepare('SELECT apt, building, system_type FROM units ORDER BY building, apt').all();
    res.json({ statuses: STATUSES, statusLabel: STATUS_LABEL, priorities: PRIORITIES, categories: CATEGORIES,
               buildings: buildingList(), departments: DEPARTMENTS, staff, tags });
  });

  /* ----- work orders ----- */
  app.get('/api/workorders', auth, (req, res) => {
    ensurePmWorkOrders();
    const view = req.query.view || 'open';
    const where = [];
    const args = [];
    if (view === 'open') { where.push(`w.status IN ${OPEN_SQL}`); if (!req.query.unit) where.push(`w.source != 'pm'`); }
    else if (view === 'new') where.push(`w.status='new'`);
    else if (view === 'mine') { where.push(`w.status IN ${OPEN_SQL}`); where.push(`w.assigned_to=?`); args.push(req.user.name); }
    else if (view === 'pm') { where.push(`w.status IN ${OPEN_SQL}`); where.push(`w.source='pm'`); }
    else if (view === 'done') where.push(`w.status IN ('done','cancelled')`);
    if (req.query.unit) { where.push('u.apt=?'); args.push(String(req.query.unit).toUpperCase()); }
    if (req.query.building) { where.push(`COALESCE(NULLIF(w.building,''), u.building)=?`); args.push(req.query.building); }
    const order = view === 'done'
      ? 'ORDER BY w.completed_at DESC, w.id DESC LIMIT 100'
      : `ORDER BY CASE w.status WHEN 'new' THEN 0 ELSE 1 END,
                 CASE w.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                 COALESCE(date(w.due_date),'9999-12-31'), w.id`;
    const rows = db.prepare(`
      SELECT w.id, w.title, w.description, w.category, w.priority, w.status, w.source, w.pm_id,
             w.location, w.requested_by, w.requester_dept, w.assigned_to, w.due_date,
             w.created_at, w.updated_at, w.completed_at, w.hours,
             COALESCE(NULLIF(w.building,''), u.building, '') building,
             u.apt, u.system_type,
             (w.photo IS NOT NULL AND w.photo != '') has_photo
      FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ${order}`).all(...args);
    const counts = db.prepare(`
      SELECT SUM(CASE WHEN status IN ${OPEN_SQL} AND source != 'pm' THEN 1 ELSE 0 END) open,
             SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) new,
             SUM(CASE WHEN status IN ${OPEN_SQL} AND assigned_to=? THEN 1 ELSE 0 END) mine,
             SUM(CASE WHEN status IN ${OPEN_SQL} AND source='pm' THEN 1 ELSE 0 END) pm
      FROM work_orders`).get(req.user.name);
    Object.keys(counts).forEach(k => { counts[k] = counts[k] || 0; });
    res.json({ workorders: rows, counts, today: today() });
  });

  app.get('/api/workorders/:id', auth, (req, res) => {
    const w = woFull(req.params.id);
    if (!w) return res.status(404).json({ error: 'Work order not found' });
    res.json({ workorder: w });
  });

  app.get('/api/workorders/:id/photo', auth, (req, res) => {
    const r = db.prepare('SELECT photo FROM work_orders WHERE id=?').get(req.params.id);
    if (!r || !r.photo) return res.status(404).end();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(r.photo, 'base64'));
  });

  app.post('/api/workorders', auth, (req, res) => {
    const b = req.body || {};
    const title = clip(b.title, 160);
    if (!title) return res.status(400).json({ error: 'Give the work order a short title' });
    let unit = null;
    if (b.apt) {
      unit = unitByTag(b.apt);
      if (!unit) return res.status(400).json({ error: `No equipment tagged ${String(b.apt).toUpperCase()}. Check the tag or leave it blank.` });
    }
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
    const due = isDate(b.due_date) ? b.due_date : addDays(today(), PRIORITY_DAYS[priority]);
    const info = db.prepare(`
      INSERT INTO work_orders (unit_id, building, location, title, description, category, priority, status,
                               source, assigned_to, due_date, requested_by, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(unit ? unit.id : null, clip(b.building, 80) || (unit && unit.building) || '', clip(b.location, 120),
        title, clip(b.description, 4000), CATEGORIES.includes(b.category) ? b.category : 'General',
        priority, 'open', 'tech', clip(b.assigned_to, 80), due,
        clip(b.requested_by, 80), req.user.name);
    addNote(info.lastInsertRowid, 'Created' + (b.assigned_to ? `, assigned to ${clip(b.assigned_to, 80)}` : '') + '.', req.user.name, 'status');
    res.json({ workorder: woFull(info.lastInsertRowid) });
  });

  app.put('/api/workorders/:id', auth, (req, res) => {
    const w = woRow(req.params.id);
    if (!w) return res.status(404).json({ error: 'Work order not found' });
    const b = req.body || {};
    const changes = [];
    const set = [];
    const args = [];
    const field = (col, val, label) => {
      if (val === undefined || val === w[col]) return;
      set.push(`${col}=?`); args.push(val);
      if (label) changes.push(label);
    };

    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status' });
      if (b.status === 'done') return res.status(400).json({ error: 'Use Complete to close a work order' });
      field('status', b.status, `Status: ${STATUS_LABEL[b.status]}`);
      if (b.status === 'in_progress' && !w.started_at) set.push(`started_at=datetime('now')`);
      if (b.status === 'cancelled') set.push(`completed_at=datetime('now')`);
      if (w.status === 'done' || w.status === 'cancelled') set.push('completed_at=NULL');
    }
    if (b.priority !== undefined) {
      if (!PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'Unknown priority' });
      field('priority', b.priority, `Priority: ${b.priority}`);
    }
    if (b.assigned_to !== undefined) field('assigned_to', clip(b.assigned_to, 80), b.assigned_to ? `Assigned to ${clip(b.assigned_to, 80)}` : 'Unassigned');
    if (b.due_date !== undefined) field('due_date', isDate(b.due_date) ? b.due_date : null, `Due ${b.due_date || 'cleared'}`);
    if (b.title !== undefined && clip(b.title, 160)) field('title', clip(b.title, 160));
    if (b.description !== undefined) field('description', clip(b.description, 4000));
    if (b.location !== undefined) field('location', clip(b.location, 120));
    if (b.building !== undefined) field('building', clip(b.building, 80));
    if (b.category !== undefined && CATEGORIES.includes(b.category)) field('category', b.category);
    if (b.apt !== undefined) {
      if (b.apt) {
        const u = unitByTag(b.apt);
        if (!u) return res.status(400).json({ error: `No equipment tagged ${String(b.apt).toUpperCase()}` });
        field('unit_id', u.id, `Linked to ${u.apt}`);
        if (!w.building && u.building) { set.push('building=?'); args.push(u.building); }
      } else field('unit_id', null, 'Equipment unlinked');
    }
    // Accepting a new request moves it into the queue.
    if (w.status === 'new' && b.status === undefined && (b.assigned_to || b.priority)) {
      set.push(`status='open'`); changes.push('Accepted');
    }

    if (set.length) {
      set.push(`updated_at=datetime('now')`);
      db.prepare(`UPDATE work_orders SET ${set.join(', ')} WHERE id=?`).run(...args, w.id);
      if (changes.length) addNote(w.id, changes.join('. ') + '.', req.user.name, 'status');
    }
    res.json({ workorder: woFull(w.id) });
  });

  app.post('/api/workorders/:id/note', auth, (req, res) => {
    const w = woRow(req.params.id);
    if (!w) return res.status(404).json({ error: 'Work order not found' });
    const body = clip((req.body || {}).body, 2000);
    if (!body) return res.status(400).json({ error: 'Write a note first' });
    addNote(w.id, body, req.user.name, 'note');
    db.prepare(`UPDATE work_orders SET updated_at=datetime('now') WHERE id=?`).run(w.id);
    res.json({ workorder: woFull(w.id) });
  });

  app.post('/api/workorders/:id/complete', auth, (req, res) => {
    const w = woRow(req.params.id);
    if (!w) return res.status(404).json({ error: 'Work order not found' });
    if (w.status === 'done') return res.status(400).json({ error: 'Already completed' });
    const b = req.body || {};
    if (!clip(b.resolution, 10) && !(Array.isArray(b.checklist_done) && b.checklist_done.length)) {
      return res.status(400).json({ error: 'Say what you did before closing it out' });
    }
    db.transaction(() => completeWorkOrder(w, b, req.user.name))();
    res.json({ workorder: woFull(w.id) });
  });

  /* ----- preventive maintenance ----- */
  app.get('/api/pm', auth, (req, res) => {
    ensurePmWorkOrders();
    const rows = db.prepare(`
      SELECT p.*, u.apt, u.system_type, COALESCE(NULLIF(p.building,''), u.building, '') bldg,
             (SELECT w.id FROM work_orders w WHERE w.pm_id=p.id AND w.status IN ${OPEN_SQL} LIMIT 1) open_wo
      FROM pm_tasks p LEFT JOIN units u ON u.id=p.unit_id
      WHERE p.active=1
      ORDER BY date(p.next_due), p.id`).all();
    res.json({ pms: rows, today: today() });
  });

  app.post('/api/pm', auth, (req, res) => {
    const b = req.body || {};
    const title = clip(b.title, 160);
    if (!title) return res.status(400).json({ error: 'Name the task' });
    const freq = parseInt(b.freq_days, 10);
    if (!freq || freq < 1 || freq > 3650) return res.status(400).json({ error: 'Pick how often it repeats' });
    let unit = null;
    if (b.apt) {
      unit = unitByTag(b.apt);
      if (!unit) return res.status(400).json({ error: `No equipment tagged ${String(b.apt).toUpperCase()}` });
    }
    const lead = Math.max(0, Math.min(60, parseInt(b.lead_days, 10) || (freq <= 7 ? 1 : freq <= 30 ? 5 : 10)));
    const info = db.prepare(`INSERT INTO pm_tasks (unit_id, building, title, checklist, category, freq_days, lead_days, next_due)
                             VALUES (?,?,?,?,?,?,?,?)`)
      .run(unit ? unit.id : null, clip(b.building, 80) || (unit && unit.building) || '', title,
        clip(b.checklist, 3000), CATEGORIES.includes(b.category) ? b.category : 'PM', freq, lead,
        isDate(b.next_due) ? b.next_due : today());
    ensurePmWorkOrders();
    res.json({ id: info.lastInsertRowid });
  });

  app.put('/api/pm/:id', auth, (req, res) => {
    const p = db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const freq = b.freq_days !== undefined ? parseInt(b.freq_days, 10) : p.freq_days;
    if (!freq || freq < 1) return res.status(400).json({ error: 'Pick how often it repeats' });
    db.prepare(`UPDATE pm_tasks SET title=?, checklist=?, category=?, freq_days=?, lead_days=?, next_due=? WHERE id=?`)
      .run(clip(b.title, 160) || p.title, b.checklist !== undefined ? clip(b.checklist, 3000) : p.checklist,
        CATEGORIES.includes(b.category) ? b.category : p.category, freq,
        b.lead_days !== undefined ? Math.max(0, Math.min(60, parseInt(b.lead_days, 10) || 0)) : p.lead_days,
        isDate(b.next_due) ? b.next_due : p.next_due, p.id);
    // Keep an open PM work order's due date in step.
    if (isDate(b.next_due)) {
      db.prepare(`UPDATE work_orders SET due_date=? WHERE pm_id=? AND status IN ${OPEN_SQL}`).run(b.next_due, p.id);
    }
    res.json({ ok: true });
  });

  app.delete('/api/pm/:id', auth, (req, res) => {
    const p = db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE pm_tasks SET active=0 WHERE id=?').run(p.id);
    const open = db.prepare(`SELECT id FROM work_orders WHERE pm_id=? AND status IN ${OPEN_SQL}`).all(p.id);
    open.forEach(o => {
      db.prepare(`UPDATE work_orders SET status='cancelled', completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(o.id);
      addNote(o.id, 'PM task removed from the schedule.', req.user.name, 'status');
    });
    res.json({ ok: true });
  });

  app.post('/api/pm/starter', auth, (req, res) => {
    const made = createStarterPlan(req.user.name);
    const opened = ensurePmWorkOrders();
    res.json({ created: made, opened });
  });

  /* ----- dashboard ----- */
  app.get('/api/dashboard', auth, (req, res) => res.json(dashboard()));

  /* ----- public request portal (no login) ----- */
  app.get('/api/public/info', (req, res) => {
    res.json({ club: clubName(), buildings: buildingList(), departments: DEPARTMENTS, phone: MAINT_PHONE });
  });

  app.post('/api/public/request', (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ticket: 0, code: '' }); // honeypot field, bots fill it
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many requests from this device. Call maintenance directly.' });
    const name = clip(b.name, 80);
    const what = clip(b.description, 2000);
    const building = clip(b.building, 80);
    if (!name) return res.status(400).json({ error: 'Enter your name' });
    if (!building) return res.status(400).json({ error: 'Pick the building' });
    if (what.length < 5) return res.status(400).json({ error: 'Describe the problem' });
    const urgency = { emergency: 'emergency', today: 'high', week: 'normal', whenever: 'low' }[b.urgency] || 'normal';
    let photo = null;
    if (b.photo && typeof b.photo === 'string') {
      // Client shrinks photos first. Anything still over ~1.5MB is refused.
      if (b.photo.length > 2000000) return res.status(400).json({ error: 'That photo is too large. Try again without it.' });
      if (/^[A-Za-z0-9+/=]+$/.test(b.photo)) photo = b.photo;
    }
    const location = clip(b.location, 120);
    const firstLine = what.split(/[.\n!?]/)[0].slice(0, 90).trim() || 'Maintenance request';
    const title = (location ? `${location}: ` : '') + firstLine;
    const code = trackCode();
    const info = db.prepare(`
      INSERT INTO work_orders (building, location, title, description, category, priority, status, source,
                               requested_by, requester_dept, requester_contact, due_date, photo, track_code, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(building, location, title.slice(0, 160), what, 'General', urgency, 'new', 'request',
        name, clip(b.department, 60), clip(b.contact, 120), addDays(today(), PRIORITY_DAYS[urgency]),
        photo, code, name);
    addNote(info.lastInsertRowid, `Submitted through the request page${b.department ? ' (' + clip(b.department, 60) + ')' : ''}.`, name, 'status');
    res.json({ ticket: info.lastInsertRowid, code });
  });

  app.get('/api/public/status/:code', (req, res) => {
    const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) return res.status(404).json({ error: 'Not found' });
    const w = db.prepare('SELECT id, title, status, created_at, updated_at, completed_at, building, location FROM work_orders WHERE track_code=?').get(code);
    if (!w) return res.status(404).json({ error: 'Not found' });
    const last = db.prepare(`SELECT body, at FROM wo_notes WHERE wo_id=? AND kind='status' ORDER BY id DESC LIMIT 1`).get(w.id);
    res.json({ ticket: w.id, title: w.title, building: w.building, location: w.location,
               status: w.status, label: STATUS_LABEL[w.status] || w.status,
               created_at: w.created_at, updated_at: w.updated_at, completed_at: w.completed_at,
               last_update: last ? last.at : null });
  });

  // QR code that opens the request page, optionally with the building filled in.
  app.get('/api/public/qr.svg', async (req, res) => {
    const b = clip(req.query.b, 80);
    const url = origin(req) + '/request' + (b ? '?b=' + encodeURIComponent(b) : '');
    try {
      const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M',
        color: { dark: '#1F3A63', light: '#FFFFFF' } });
      res.set('Content-Type', 'image/svg+xml');
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(svg);
    } catch (e) {
      res.status(500).end();
    }
  });
  app.get('/api/public/request-url', (req, res) => res.json({ url: origin(req) + '/request' }));
};

module.exports.ensurePmWorkOrders = ensurePmWorkOrders;
module.exports.createStarterPlan = createStarterPlan;
module.exports.addDays = addDays;
