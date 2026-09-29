/**
 * Logins and roles, parts and inventory, vendors and contracts, alerts,
 * notifications, and the monthly report.
 *
 * Mounted from server.js:  require('./ops').mount(app, auth)
 * server.js auth() calls gate(req) so role rules are enforced on every route.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const DEMO_MODE = process.env.DEMO_MODE === 'true';
const TZ = process.env.TZ_NAME || 'America/Chicago';

/* =================================================================
   SCHEMA
   ================================================================= */

function cols(table) { return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name); }
function addCol(table, column, ddl) { if (!cols(table).includes(column)) { db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); return true; } return false; }

addCol('users', 'active', `active INTEGER NOT NULL DEFAULT 1`);
addCol('users', 'phone', `phone TEXT DEFAULT ''`);
addCol('users', 'dept', `dept TEXT DEFAULT ''`);
addCol('users', 'last_login', `last_login TEXT`);
addCol('users', 'notify', `notify TEXT DEFAULT ''`);
addCol('users', 'must_change', `must_change INTEGER NOT NULL DEFAULT 0`);

addCol('work_orders', 'vendor_id', `vendor_id INTEGER`);
addCol('work_orders', 'parts_cost', `parts_cost REAL DEFAULT 0`);
addCol('work_orders', 'vendor_cost', `vendor_cost REAL DEFAULT 0`);
addCol('work_orders', 'created_by_id', `created_by_id INTEGER`);
// Existing work orders count as already announced, so the upgrade does not
// blast everyone with old tickets the first time it boots.
if (addCol('work_orders', 'alerted_at', `alerted_at TEXT`)) {
  db.exec(`UPDATE work_orders SET alerted_at=datetime('now')`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS vendors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  trade         TEXT DEFAULT '',
  contact       TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  emergency_phone TEXT DEFAULT '',
  email         TEXT DEFAULT '',
  account_no    TEXT DEFAULT '',
  website       TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  insurance_exp TEXT,
  w9_on_file    INTEGER DEFAULT 0,
  rating        INTEGER DEFAULT 0,
  notes         TEXT DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id      INTEGER NOT NULL,
  title          TEXT NOT NULL,
  scope          TEXT DEFAULT '',
  covers         TEXT DEFAULT '',
  start_date     TEXT,
  end_date       TEXT,
  auto_renew     INTEGER DEFAULT 0,
  notice_days    INTEGER DEFAULT 30,
  annual_cost    REAL DEFAULT 0,
  billing        TEXT DEFAULT 'annual',
  visit_freq_days INTEGER DEFAULT 0,
  next_visit     TEXT,
  notes          TEXT DEFAULT '',
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_contract_vendor ON contracts(vendor_id);

CREATE TABLE IF NOT EXISTS invoices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id    INTEGER NOT NULL,
  contract_id  INTEGER,
  wo_id        INTEGER,
  invoice_no   TEXT DEFAULT '',
  inv_date     TEXT NOT NULL,
  amount       REAL NOT NULL DEFAULT 0,
  building     TEXT DEFAULT '',
  description  TEXT DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending',
  approved_by  TEXT DEFAULT '',
  approved_at  TEXT,
  entered_by   TEXT DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inv_vendor ON invoices(vendor_id);

CREATE TABLE IF NOT EXISTS parts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  part_no      TEXT DEFAULT '',
  category     TEXT DEFAULT 'General',
  manufacturer TEXT DEFAULT '',
  location     TEXT DEFAULT '',
  uom          TEXT DEFAULT 'ea',
  on_hand      REAL NOT NULL DEFAULT 0,
  min_qty      REAL NOT NULL DEFAULT 0,
  reorder_qty  REAL NOT NULL DEFAULT 0,
  unit_cost    REAL NOT NULL DEFAULT 0,
  vendor_id    INTEGER,
  fits         TEXT DEFAULT '',
  notes        TEXT DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS part_txns (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id   INTEGER NOT NULL,
  kind      TEXT NOT NULL,
  qty       REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  wo_id     INTEGER,
  unit_id   INTEGER,
  note      TEXT DEFAULT '',
  by        TEXT DEFAULT '',
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(part_id) REFERENCES parts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ptx_part ON part_txns(part_id);
CREATE INDEX IF NOT EXISTS idx_ptx_wo ON part_txns(wo_id);

CREATE TABLE IF NOT EXISTS alert_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kind     TEXT,
  ref      TEXT,
  channel  TEXT,
  sent_to  TEXT,
  subject  TEXT,
  ok       INTEGER,
  error    TEXT,
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ---------------- roles ---------------- */

const ROLES = ['admin', 'manager', 'tech', 'staff', 'viewer'];
const ROLE_LABEL = {
  admin: 'Admin', manager: 'Manager', tech: 'Technician', staff: 'Department staff', viewer: 'View only'
};
const ROLE_HELP = {
  admin: 'Everything, including adding people and changing roles.',
  manager: 'Everything. Approves vendor invoices. Can add techs and staff.',
  tech: 'Work orders, PM, equipment, diagnosis, parts, vendors.',
  staff: 'Submits requests and follows their own. Kitchen, front desk, tennis, pool.',
  viewer: 'Read-only dashboard and reports. Good for the GM or board.'
};

// Older installs had 'manager' as the top role. Promote the first manager to
// admin so someone can always manage accounts.
(function ensureAdmin() {
  const hasAdmin = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin'`).get().c;
  if (hasAdmin) return;
  const first = db.prepare(`SELECT id FROM users WHERE role='manager' ORDER BY id LIMIT 1`).get()
             || db.prepare(`SELECT id FROM users ORDER BY id LIMIT 1`).get();
  if (first) db.prepare(`UPDATE users SET role='admin', active=1 WHERE id=?`).run(first.id);
})();

const DEFAULT_NOTIFY = {
  admin:   { emergency: { email: true, sms: true }, request: { email: true }, assigned: { email: true }, digest: { email: true }, monthly: { email: true } },
  manager: { emergency: { email: true, sms: true }, request: { email: false }, assigned: { email: false }, digest: { email: true }, monthly: { email: true } },
  tech:    { emergency: { email: true, sms: true }, request: { email: true }, assigned: { email: true, sms: false }, digest: { email: true }, monthly: { email: false } },
  staff:   { emergency: {}, request: {}, assigned: {}, digest: {}, monthly: {} },
  viewer:  { emergency: {}, request: {}, assigned: {}, digest: {}, monthly: { email: true } }
};
function notifyPrefs(u) {
  let p = {};
  try { p = u.notify ? JSON.parse(u.notify) : {}; } catch (e) { p = {}; }
  const base = JSON.parse(JSON.stringify(DEFAULT_NOTIFY[u.role] || DEFAULT_NOTIFY.staff));
  Object.keys(p || {}).forEach(k => { base[k] = Object.assign({}, base[k] || {}, p[k]); });
  return base;
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, role_label: ROLE_LABEL[u.role] || u.role,
           phone: u.phone || '', dept: u.dept || '', active: !!u.active, last_login: u.last_login,
           must_change: !!u.must_change, created_at: u.created_at, notify: notifyPrefs(u) };
}

/* ---------------- demo users ---------------- */

const DEMO_USERS = {
  admin:   { id: -1, email: 'admin@demo', name: 'Demo Admin', role: 'admin' },
  manager: { id: -2, email: 'manager@demo', name: 'Demo Manager', role: 'manager' },
  tech:    { id: -3, email: 'tech@demo', name: 'Demo Tech', role: 'tech' },
  staff:   { id: -4, email: 'staff@demo', name: 'Demo Kitchen Staff', role: 'staff', dept: 'Kitchen' },
  viewer:  { id: -5, email: 'viewer@demo', name: 'Demo GM', role: 'viewer' }
};

/* =================================================================
   ACCESS RULES
   Called by auth() on every signed-in request. Returns an error string
   when the role is not allowed to do this, or null when it is.
   ================================================================= */

function gate(req) {
  const role = req.user && req.user.role;
  const method = req.method;
  const p = (req.originalUrl || req.url).split('?')[0].replace(/\/+$/, '');
  const isRead = method === 'GET' || method === 'HEAD';

  if (role === 'admin' || role === 'manager') {
    if (role === 'manager' && /^\/api\/users\/\d+/.test(p) && !isRead) {
      // Managers can edit techs, staff, and viewers but not admins. Checked in the route.
    }
    return null;
  }

  // Everyone signed in can manage their own account.
  if (p === '/api/me' || p === '/api/me/password' || p === '/api/alerts' || p === '/api/alerts/test' || p === '/api/notify/status') return null;

  if (role === 'tech') {
    if (p.startsWith('/api/users')) return 'Only a manager can manage accounts';
    if (/^\/api\/invoices\/\d+\/(approve|paid)$/.test(p)) return 'Only a manager can approve invoices';
    if (p.startsWith('/api/settings') && !isRead) return 'Only a manager can change settings';
    if (p === '/api/report/monthly/email') return 'Only a manager can email the report';
    return null;
  }

  if (role === 'viewer') {
    if (p.startsWith('/api/users') || p.startsWith('/api/alerts/log')) return 'Not available with view-only access';
    if (isRead) return null;
    if (p === '/api/report/monthly/summary') return null;
    return 'View-only access. Ask a manager if you need to make changes.';
  }

  if (role === 'staff') {
    const own = m => {
      const id = parseInt(m, 10);
      const w = db.prepare('SELECT created_by_id, requested_by, created_by FROM work_orders WHERE id=?').get(id);
      if (!w) return null; // route returns 404
      const mine = w.created_by_id === req.user.id || w.requested_by === req.user.name || w.created_by === req.user.name;
      return mine ? null : 'You can only see requests you submitted';
    };
    if (p === '/api/wo-meta' && isRead) return null;
    if ((p === '/api/kitchen' && isRead) || (p === '/api/kitchen/temps' && method === 'POST')) return null;
    let ph = p.match(/^\/api\/workorders\/(\d+)\/photos$/);
    if (ph && isRead) return own(ph[1]);
    if (p === '/api/workorders' && (isRead || method === 'POST')) return null;
    let m = p.match(/^\/api\/workorders\/(\d+)(\/photo|\/note)?$/);
    if (m && (isRead || (m[2] === '/note' && method === 'POST'))) return own(m[1]);
    return 'Department staff accounts can submit and follow requests only';
  }

  return 'Unknown role';
}

/* =================================================================
   HELPERS
   ================================================================= */

const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const num = (v, d = 0) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
const today = () => localDate();
function localDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function localHour(d = new Date()) {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d), 10);
}
function addDays(dateStr, n) {
  const d = new Date((dateStr || today()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
function getSetting(k, d = null) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : d; }
function setSetting(k, v) { db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v == null ? null : String(v)); }
function tempPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += a[b[i] % a.length];
  return 'Club-' + s.slice(0, 4) + '-' + s.slice(4);
}
const money = n => '$' + Math.round(n || 0).toLocaleString('en-US');
const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clubName = () => (db.prepare('SELECT name FROM properties WHERE id=1').get() || {}).name || 'Country Club of Little Rock';

/* =================================================================
   PARTS
   ================================================================= */

const PART_CATEGORIES = ['Filters', 'Belts', 'Electrical', 'Boiler', 'Heat pump', 'Cooling tower', 'Water treatment',
  'Refrigeration', 'Refrigerant', 'Plumbing', 'Kitchen', 'Pool', 'Lighting', 'Building', 'General'];

function partRow(id) {
  return db.prepare(`SELECT p.*, v.name vendor_name FROM parts p LEFT JOIN vendors v ON v.id=p.vendor_id WHERE p.id=?`).get(id);
}

// Record a stock movement. qty is signed: + adds to stock, - takes it out.
function partTxn(partId, kind, qty, opts = {}) {
  const p = db.prepare('SELECT * FROM parts WHERE id=?').get(partId);
  if (!p) throw new Error('Part not found');
  const cost = opts.unit_cost != null && opts.unit_cost !== '' ? num(opts.unit_cost) : p.unit_cost;
  db.prepare(`INSERT INTO part_txns (part_id, kind, qty, unit_cost, wo_id, unit_id, note, by) VALUES (?,?,?,?,?,?,?,?)`)
    .run(partId, kind, qty, cost, opts.wo_id || null, opts.unit_id || null, clip(opts.note, 300), opts.by || '');
  db.prepare('UPDATE parts SET on_hand = on_hand + ? WHERE id=?').run(qty, partId);
  if (kind === 'receive' && opts.unit_cost != null && opts.unit_cost !== '' && num(opts.unit_cost) > 0) {
    db.prepare('UPDATE parts SET unit_cost=? WHERE id=?').run(num(opts.unit_cost), partId);
  }
  return cost;
}

// Pull parts from stock when a work order closes. Returns { cost, text }.
function useParts(wo, items, userName) {
  if (!Array.isArray(items) || !items.length) return { cost: 0, text: '' };
  let cost = 0;
  const lines = [];
  items.forEach(it => {
    const id = parseInt(it.part_id, 10);
    const qty = num(it.qty);
    if (!id || qty <= 0) return;
    const p = db.prepare('SELECT * FROM parts WHERE id=?').get(id);
    if (!p) return;
    const c = partTxn(id, 'use', -qty, { wo_id: wo.id, unit_id: wo.unit_id, by: userName, note: `WO #${wo.id}` });
    cost += c * qty;
    lines.push(`${qty} ${p.uom} ${p.name}`);
  });
  cost = Math.round(cost * 100) / 100;
  if (cost) db.prepare('UPDATE work_orders SET parts_cost = COALESCE(parts_cost,0) + ? WHERE id=?').run(cost, wo.id);
  return { cost, text: lines.join('; ') };
}

const STARTER_PARTS = [
  // name, category, uom, min, reorder, cost, fits, location
  ['Pleated filter 20x20x2 MERV 8', 'Filters', 'ea', 12, 24, 9, 'Heat pumps, AHUs', 'Shop, filter rack'],
  ['Pleated filter 20x25x2 MERV 8', 'Filters', 'ea', 12, 24, 10, 'Heat pumps, AHUs', 'Shop, filter rack'],
  ['Pleated filter 16x20x2 MERV 8', 'Filters', 'ea', 12, 24, 8, 'Heat pumps', 'Shop, filter rack'],
  ['Pleated filter 16x25x2 MERV 8', 'Filters', 'ea', 12, 24, 9, 'Heat pumps', 'Shop, filter rack'],
  ['Pleated filter 24x24x2 MERV 8', 'Filters', 'ea', 8, 12, 12, 'Rooftop units', 'Shop, filter rack'],
  ['Pleated filter 12x24x2 MERV 8', 'Filters', 'ea', 8, 12, 8, 'Rooftop units', 'Shop, filter rack'],
  ['V-belt A-section, assorted', 'Belts', 'ea', 4, 6, 14, 'AHU and exhaust fans', 'Shop, belt board'],
  ['V-belt BX-section, assorted', 'Belts', 'ea', 4, 6, 18, 'Cooling tower, pumps', 'Shop, belt board'],
  ['Contactor 2-pole 30A 24V coil', 'Electrical', 'ea', 2, 4, 22, 'Heat pumps, condensers', 'Shop, electrical bin'],
  ['Contactor 3-pole 40A 24V coil', 'Electrical', 'ea', 2, 3, 45, 'RTUs, pumps', 'Shop, electrical bin'],
  ['Run capacitor 45/5 MFD 440V', 'Electrical', 'ea', 2, 4, 18, 'Heat pumps, condensers', 'Shop, electrical bin'],
  ['Run capacitor 35/5 MFD 440V', 'Electrical', 'ea', 2, 4, 16, 'Heat pumps, condensers', 'Shop, electrical bin'],
  ['Run capacitor 10 MFD 370V (fan)', 'Electrical', 'ea', 2, 4, 9, 'Blower and fan motors', 'Shop, electrical bin'],
  ['Hard start kit', 'Electrical', 'ea', 1, 2, 28, 'Compressors', 'Shop, electrical bin'],
  ['24V transformer 40VA', 'Electrical', 'ea', 1, 2, 18, 'Heat pumps, controls', 'Shop, electrical bin'],
  ['Time delay fuse 30A', 'Electrical', 'ea', 4, 10, 6, 'Disconnects', 'Shop, electrical bin'],
  ['Hot surface igniter', 'Boiler', 'ea', 1, 2, 65, 'Boilers, water heaters', 'Central Plant cabinet'],
  ['Flame sensor rod', 'Boiler', 'ea', 1, 2, 38, 'Boilers', 'Central Plant cabinet'],
  ['Condensate neutralizer media', 'Boiler', 'bag', 1, 2, 45, 'Condensing boilers', 'Central Plant cabinet'],
  ['Pressure relief valve 30 psi 3/4"', 'Boiler', 'ea', 1, 1, 55, 'Boiler loop', 'Central Plant cabinet'],
  ['Heat pump lockout/control board', 'Heat pump', 'ea', 1, 1, 185, 'Water-source heat pumps', 'Shop, controls shelf'],
  ['Reversing valve solenoid coil 24V', 'Heat pump', 'ea', 1, 2, 42, 'Water-source heat pumps', 'Shop, controls shelf'],
  ['Condensate pan tablets', 'Heat pump', 'box', 1, 2, 24, 'Heat pumps, AHUs', 'Shop'],
  ['Float switch, condensate', 'Heat pump', 'ea', 2, 4, 26, 'Heat pumps', 'Shop, controls shelf'],
  ['Cooling tower float valve assembly', 'Cooling tower', 'ea', 1, 1, 120, 'Cooling tower', 'Central Plant cabinet'],
  ['Tower biocide, 5 gal', 'Water treatment', 'pail', 1, 2, 160, 'Cooling tower', 'Central Plant chem room'],
  ['Scale and corrosion inhibitor, 5 gal', 'Water treatment', 'pail', 1, 2, 140, 'Cooling tower, closed loop', 'Central Plant chem room'],
  ['Conductivity and ppm test reagents', 'Water treatment', 'kit', 1, 1, 60, 'Tower and loop testing', 'Central Plant chem room'],
  ['R-410A, 25 lb cylinder', 'Refrigerant', 'cyl', 1, 1, 320, 'Heat pumps, RTUs', 'Shop, refrigerant cage'],
  ['Walk-in door gasket', 'Refrigeration', 'ea', 1, 1, 85, 'Kitchen walk-in cooler and freezer', 'Shop'],
  ['Evaporator fan motor 9W', 'Refrigeration', 'ea', 1, 2, 48, 'Walk-ins, reach-ins', 'Shop'],
  ['Ice machine cleaner (nickel safe)', 'Kitchen', 'bottle', 2, 4, 32, 'Ice machines', 'Kitchen storage'],
  ['Ice machine sanitizer', 'Kitchen', 'bottle', 2, 4, 28, 'Ice machines', 'Kitchen storage'],
  ['Flush valve rebuild kit', 'Plumbing', 'kit', 3, 6, 24, 'Commercial toilets and urinals', 'Shop, plumbing bin'],
  ['Faucet cartridge, lavatory', 'Plumbing', 'ea', 2, 4, 30, 'Locker rooms, restrooms', 'Shop, plumbing bin'],
  ['Wax ring with flange', 'Plumbing', 'ea', 3, 6, 6, 'Toilets', 'Shop, plumbing bin'],
  ['Supply line 3/8 x 1/2 x 12"', 'Plumbing', 'ea', 4, 10, 7, 'Faucets, toilets', 'Shop, plumbing bin'],
  ['Pool pump seal kit', 'Pool', 'kit', 1, 1, 45, 'Pool pumps', 'Pool pump room'],
  ['DPD pool test reagents', 'Pool', 'kit', 1, 2, 35, 'Pool chemistry', 'Pool pump room'],
  ['LED lamp A19 (60W equal)', 'Lighting', 'ea', 12, 24, 3, 'General', 'Shop, lighting'],
  ['LED tube T8 4 ft', 'Lighting', 'ea', 10, 25, 6, 'Offices, back of house', 'Shop, lighting'],
  ['Exit sign / emergency light battery', 'Lighting', 'ea', 3, 6, 15, 'Life safety', 'Shop, lighting']
];

function loadStarterParts(by) {
  let made = 0;
  const ins = db.prepare(`INSERT INTO parts (name, category, uom, min_qty, reorder_qty, unit_cost, fits, location, notes)
                          VALUES (?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    STARTER_PARTS.forEach(p => {
      if (db.prepare('SELECT id FROM parts WHERE name=?').get(p[0])) return;
      ins.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], 'Starter list. Cost is an estimate until you receive it.');
      made++;
    });
  })();
  return made;
}

/* =================================================================
   VENDORS
   ================================================================= */

const TRADES = ['HVAC / mechanical', 'Boiler', 'Cooling tower / water treatment', 'Controls / BAS', 'Refrigeration',
  'Kitchen equipment', 'Plumbing', 'Electrical', 'Fire / life safety', 'Elevator', 'Pool', 'Roofing',
  'Pest control', 'Grease trap / hood cleaning', 'Generator', 'Supply house', 'General contractor', 'Other'];

function contractState(c, t = today()) {
  if (!c.end_date) return { state: 'open', days: null };
  const days = daysBetween(t, c.end_date);
  if (days < 0) return { state: 'expired', days };
  if (days <= (c.notice_days || 30)) return { state: c.auto_renew ? 'renewing' : 'notice', days };
  if (days <= (c.notice_days || 30) + 30) return { state: 'soon', days };
  return { state: 'active', days };
}

/* =================================================================
   ALERTS
   ================================================================= */

function computeAlerts(user) {
  const t = today();
  const role = user.role;
  const out = [];
  const push = (level, kind, title, detail, go) => out.push({ level, kind, title, detail, go: go || null });
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);

  if (role === 'staff') {
    try { out.push(...require('./round2').alerts(user)); } catch (e) { /* optional module */ }
    const mine = all(`SELECT id, title, status, updated_at FROM work_orders
      WHERE (created_by_id=? OR requested_by=?) AND status IN ('done','cancelled') AND date(updated_at) >= date('now','-3 days')
      ORDER BY updated_at DESC LIMIT 5`, user.id, user.name);
    mine.forEach(w => push('info', 'mine', `Request #${w.id} ${w.status === 'done' ? 'completed' : 'closed'}`, w.title, { wo: w.id }));
    return out;
  }

  const em = all(`SELECT w.id, w.title, COALESCE(NULLIF(w.building,''),u.building,'') b FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
    WHERE w.status IN ('new','open','in_progress','on_hold') AND w.priority='emergency' ORDER BY w.id`);
  em.forEach(w => push('critical', 'emergency', `Emergency: ${w.title}`, [w.b, `WO #${w.id}`].filter(Boolean).join(' · '), { wo: w.id }));

  const waiting = one(`SELECT COUNT(*) n, MIN(created_at) first FROM work_orders WHERE status='new' AND julianday('now') - julianday(created_at) > 2.0/24`);
  if (waiting.n) push('warn', 'requests', `${waiting.n} staff request${waiting.n > 1 ? 's' : ''} not accepted yet`, 'Waiting more than 2 hours', { tab: 'work', filter: 'new' });

  const overdue = one(`SELECT COUNT(*) n FROM work_orders WHERE status IN ('new','open','in_progress','on_hold') AND source!='pm' AND due_date IS NOT NULL AND date(due_date) < date(?)`, t).n;
  if (overdue) push('warn', 'overdue', `${overdue} work order${overdue > 1 ? 's' : ''} past due`, '', { tab: 'work', filter: 'open' });

  const pmLate = one(`SELECT COUNT(*) n FROM pm_tasks WHERE active=1 AND date(next_due) < date(?)`, t).n;
  if (pmLate) push('warn', 'pm', `${pmLate} PM task${pmLate > 1 ? 's' : ''} overdue`, '', { tab: 'work', view: 'pm' });

  const low = all(`SELECT id, name, on_hand, min_qty, uom FROM parts WHERE active=1 AND min_qty > 0 AND on_hand <= min_qty ORDER BY (on_hand - min_qty) LIMIT 50`);
  if (low.length) push(low.some(p => p.on_hand <= 0) ? 'warn' : 'info', 'stock', `${low.length} part${low.length > 1 ? 's' : ''} at or below minimum`,
    low.slice(0, 3).map(p => `${p.name} (${+p.on_hand} ${p.uom})`).join(', ') + (low.length > 3 ? '…' : ''), { tab: 'parts', view: 'reorder' });

  all(`SELECT c.*, v.name vendor FROM contracts c JOIN vendors v ON v.id=c.vendor_id WHERE c.active=1 AND c.end_date IS NOT NULL`).forEach(c => {
    const s = contractState(c, t);
    if (s.state === 'expired') push('warn', 'contract', `Contract expired: ${c.title}`, `${c.vendor} · ended ${c.end_date}`, { tab: 'vendors', vendor: c.vendor_id });
    else if (s.state === 'notice') push('warn', 'contract', `Contract ends in ${s.days} days: ${c.title}`, `${c.vendor} · decide on renewal`, { tab: 'vendors', vendor: c.vendor_id });
    else if (s.state === 'renewing') push('info', 'contract', `Contract auto-renews in ${s.days} days: ${c.title}`, `${c.vendor} · cancel now if not renewing`, { tab: 'vendors', vendor: c.vendor_id });
  });
  all(`SELECT c.id, c.title, c.next_visit, v.name vendor, c.vendor_id FROM contracts c JOIN vendors v ON v.id=c.vendor_id
       WHERE c.active=1 AND c.next_visit IS NOT NULL AND date(c.next_visit) <= date(?, '+7 days')`, t).forEach(c => {
    const d = daysBetween(t, c.next_visit);
    push(d < 0 ? 'warn' : 'info', 'visit', `${c.vendor} visit ${d < 0 ? 'overdue' : d === 0 ? 'due today' : 'due in ' + d + ' day' + (d > 1 ? 's' : '')}`, c.title, { tab: 'vendors', vendor: c.vendor_id });
  });

  all(`SELECT id, name, insurance_exp FROM vendors WHERE active=1 AND insurance_exp IS NOT NULL AND insurance_exp != '' AND date(insurance_exp) <= date(?, '+30 days')`, t).forEach(v => {
    const d = daysBetween(t, v.insurance_exp);
    push(d < 0 ? 'warn' : 'info', 'insurance', `${v.name}: insurance ${d < 0 ? 'expired' : 'expires in ' + d + ' days'}`, 'Get an updated certificate before they work on site', { tab: 'vendors', vendor: v.id });
  });

  if (role === 'admin' || role === 'manager' || role === 'viewer') {
    const inv = one(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) amt FROM invoices WHERE status='pending'`);
    if (inv.n) push('info', 'invoice', `${inv.n} vendor invoice${inv.n > 1 ? 's' : ''} waiting for approval`, money(inv.amt), { tab: 'vendors', view: 'invoices' });
  }
  if (role === 'admin' || role === 'manager') {
    const pend = one(`SELECT COUNT(*) n FROM users WHERE active=0 AND last_login IS NULL`).n;
    if (pend) push('info', 'account', `${pend} new account${pend > 1 ? 's' : ''} waiting for approval`, '', { tab: 'team' });
  }

  const warr = all(`SELECT e.component, e.install_date, e.warranty_years, u.apt FROM equipment e JOIN units u ON u.id=e.unit_id
    WHERE e.install_date != '' AND e.warranty_years > 0`).map(e => {
    const d = new Date(e.install_date); if (isNaN(d)) return null;
    d.setFullYear(d.getFullYear() + e.warranty_years);
    const exp = d.toISOString().slice(0, 10);
    return Object.assign(e, { exp, days: daysBetween(t, exp) });
  }).filter(e => e && e.days >= 0 && e.days <= 60);
  if (warr.length) push('info', 'warranty', `${warr.length} warrant${warr.length > 1 ? 'ies' : 'y'} ending within 60 days`,
    warr.slice(0, 3).map(e => `${e.apt} ${e.component}`).join(', '), { tab: 'reports' });

  const safety = one(`SELECT COUNT(*) n FROM units WHERE switch_present='no' OR switch_functioning='no'`).n;
  if (safety) push('warn', 'safety', `${safety} safety device${safety > 1 ? 's' : ''} out of service`, '', { tab: 'reports' });

  try { out.push(...require('./round2').alerts(user)); } catch (e) { /* optional module */ }
  const rank = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/* =================================================================
   NOTIFICATIONS: email (SMTP) and text (Twilio)
   ================================================================= */

let mailer = null;
function smtpReady() { return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS); }
function smsReady() { return !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM); }
function getMailer() {
  if (!smtpReady()) return null;
  if (mailer) return mailer;
  const nodemailer = require('nodemailer');
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return mailer;
}
function logSend(kind, ref, channel, to, subject, ok, error) {
  db.prepare('INSERT INTO alert_log (kind, ref, channel, sent_to, subject, ok, error) VALUES (?,?,?,?,?,?,?)')
    .run(kind, String(ref || ''), channel, to, clip(subject, 200), ok ? 1 : 0, error ? clip(error, 300) : null);
}
async function sendEmail(to, subject, html, text, kind, ref) {
  const m = getMailer();
  if (!m || !to) return false;
  try {
    await m.sendMail({ from: process.env.MAIL_FROM || `Clubhouse IQ <${process.env.SMTP_USER}>`, to, subject, html, text });
    logSend(kind, ref, 'email', to, subject, true);
    return true;
  } catch (e) { logSend(kind, ref, 'email', to, subject, false, e.message); return false; }
}
function e164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d.length > 6 ? '+' + d : null;
}
async function sendSms(phone, body, kind, ref) {
  const to = e164(phone);
  if (!smsReady() || !to) return false;
  try {
    const auth = Buffer.from(process.env.TWILIO_SID + ':' + process.env.TWILIO_TOKEN).toString('base64');
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: body.slice(0, 600) })
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
    logSend(kind, ref, 'sms', to, body.slice(0, 80), true);
    return true;
  } catch (e) { logSend(kind, ref, 'sms', to || phone, body.slice(0, 80), false, e.message); return false; }
}

function recipients(kind) {
  return db.prepare(`SELECT * FROM users WHERE active=1`).all().filter(u => {
    const p = notifyPrefs(u)[kind] || {};
    return p.email || p.sms;
  }).map(u => ({ u, p: notifyPrefs(u)[kind] || {} }));
}

function appUrl() { return (process.env.PUBLIC_URL || '').replace(/\/$/, ''); }

function emailShell(title, bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#1A2436">
  <div style="background:#1F3A63;color:#F3EFE5;padding:14px 18px;border-bottom:3px solid #B79B5B">
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:bold">Clubhouse IQ</div>
    <div style="font-size:11px;letter-spacing:1px;color:#C9D6E6;text-transform:uppercase">${escH(clubName())}</div>
  </div>
  <div style="padding:18px;background:#FBF9F4;border:1px solid #DDD5C3;border-top:0">
    <h2 style="font-family:Georgia,serif;margin:0 0 12px;font-size:19px">${escH(title)}</h2>
    ${bodyHtml}
    ${appUrl() ? `<p style="margin-top:18px"><a href="${escH(appUrl())}" style="background:#1F3A63;color:#fff;padding:10px 16px;text-decoration:none;border-radius:3px">Open Clubhouse IQ</a></p>` : ''}
  </div></div>`;
}

async function announceWorkOrder(w) {
  const where = [w.building, w.location].filter(Boolean).join(' · ');
  const isEm = w.priority === 'emergency';
  const kind = isEm ? 'emergency' : 'request';
  const subject = `${isEm ? 'EMERGENCY' : 'New request'} #${w.id}: ${w.title}`;
  const text = `${subject}\n${where}\n${w.description || ''}\n${w.requested_by ? 'From: ' + w.requested_by + (w.requester_dept ? ' (' + w.requester_dept + ')' : '') : ''}`;
  const html = emailShell(subject, `
    <p style="margin:0 0 6px"><b>${escH(where || 'No location given')}</b></p>
    <p style="margin:0 0 10px;white-space:pre-wrap">${escH(w.description || '')}</p>
    ${w.requested_by ? `<p style="margin:0;color:#4A5466">From ${escH(w.requested_by)}${w.requester_dept ? ' · ' + escH(w.requester_dept) : ''}${w.requester_contact ? ' · ' + escH(w.requester_contact) : ''}</p>` : ''}`);
  const sms = `${isEm ? 'EMERGENCY' : 'New request'} #${w.id} ${where ? '(' + where + ') ' : ''}${w.title}${appUrl() ? ' ' + appUrl() : ''}`;
  for (const { u, p } of recipients(kind)) {
    if (p.email) await sendEmail(u.email, subject, html, text, kind, w.id);
    if (p.sms && u.phone) await sendSms(u.phone, sms, kind, w.id);
  }
}

async function announceAssignment(w, name) {
  const u = db.prepare('SELECT * FROM users WHERE name=? AND active=1').get(name);
  if (!u) return;
  const p = notifyPrefs(u).assigned || {};
  const subject = `Assigned to you: WO #${w.id} ${w.title}`;
  if (p.email) await sendEmail(u.email, subject, emailShell(subject, `<p>${escH([w.building, w.location].filter(Boolean).join(' · '))}</p><p style="white-space:pre-wrap">${escH(w.description || '')}</p>`), subject, 'assigned', w.id);
  if (p.sms && u.phone) await sendSms(u.phone, subject, 'assigned', w.id);
}

function digestHtml(user) {
  const alerts = computeAlerts(user);
  const t = today();
  const pmToday = db.prepare(`SELECT p.title, u.apt FROM pm_tasks p LEFT JOIN units u ON u.id=p.unit_id WHERE p.active=1 AND date(p.next_due) <= date(?) ORDER BY date(p.next_due) LIMIT 15`).all(t);
  const openWo = db.prepare(`SELECT w.id, w.title, w.priority, COALESCE(NULLIF(w.building,''),u.building,'') b FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
    WHERE w.status IN ('new','open','in_progress','on_hold') AND w.source!='pm'
    ORDER BY CASE w.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, w.id LIMIT 15`).all();
  const color = { critical: '#B3362D', warn: '#9A7B32', info: '#4F6F99' };
  let h = '';
  h += alerts.length ? '<h3 style="font-size:14px;margin:0 0 6px">Needs attention</h3><ul style="padding-left:18px;margin:0 0 14px">' +
    alerts.map(a => `<li style="margin-bottom:4px"><b style="color:${color[a.level]}">${escH(a.title)}</b>${a.detail ? '<br><span style="color:#4A5466">' + escH(a.detail) + '</span>' : ''}</li>`).join('') + '</ul>'
    : '<p>Nothing flagged. Good morning.</p>';
  if (openWo.length) h += '<h3 style="font-size:14px;margin:0 0 6px">Open work</h3><ul style="padding-left:18px;margin:0 0 14px">' +
    openWo.map(w => `<li>#${w.id} ${escH(w.title)}${w.b ? ' <span style="color:#7C8494">· ' + escH(w.b) + '</span>' : ''}${w.priority === 'emergency' || w.priority === 'high' ? ' <b style="color:#B3362D">' + w.priority + '</b>' : ''}</li>`).join('') + '</ul>';
  if (pmToday.length) h += '<h3 style="font-size:14px;margin:0 0 6px">PM due</h3><ul style="padding-left:18px;margin:0">' +
    pmToday.map(p => `<li>${escH(p.title)}${p.apt ? ' · ' + escH(p.apt) : ''}</li>`).join('') + '</ul>';
  return { html: emailShell(`Morning brief · ${t}`, h), count: alerts.length };
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    // New emergencies and staff requests.
    const fresh = db.prepare(`SELECT * FROM work_orders WHERE alerted_at IS NULL ORDER BY id LIMIT 50`).all();
    for (const w of fresh) {
      db.prepare(`UPDATE work_orders SET alerted_at=datetime('now') WHERE id=?`).run(w.id);
      if (w.priority === 'emergency' || w.source === 'request') await announceWorkOrder(w);
    }
    db.prepare(`UPDATE work_orders SET alerted_at=datetime('now') WHERE alerted_at IS NULL`).run();

    if (!smtpReady()) return;
    const t = today();
    const hour = localHour();
    const digestHour = parseInt(process.env.DIGEST_HOUR || '6', 10);
    if (hour >= digestHour && getSetting('last_digest') !== t) {
      setSetting('last_digest', t);
      for (const { u, p } of recipients('digest')) {
        if (!p.email) continue;
        const d = digestHtml(u);
        await sendEmail(u.email, `Clubhouse IQ morning brief${d.count ? ' · ' + d.count + ' item' + (d.count > 1 ? 's' : '') : ''}`, d.html, 'Morning brief', 'digest', t);
      }
    }
    // Monthly report for last month, on the 1st.
    const month = addDays(t.slice(0, 7) + '-01', -1).slice(0, 7);
    if (t.slice(8) === '01' && hour >= digestHour && getSetting('last_monthly') !== month) {
      setSetting('last_monthly', month);
      await emailMonthly(month);
    }
  } catch (e) {
    console.log('Alert tick failed: ' + e.message);
  } finally { ticking = false; }
}

/* =================================================================
   MONTHLY REPORT
   ================================================================= */

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) month = today().slice(0, 7);
  const start = month + '-01';
  const d = new Date(start + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1);
  const end = d.toISOString().slice(0, 10);
  return { month, start, end };
}

function monthlyData(monthIn) {
  const { month, start, end } = monthRange(monthIn);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const IN = `date(%) >= date('${start}') AND date(%) < date('${end}')`;
  const between = c => IN.replace(/%/g, c);

  const wo = one(`SELECT
      SUM(CASE WHEN source!='pm' AND ${between('created_at')} THEN 1 ELSE 0 END) opened,
      SUM(CASE WHEN source!='pm' AND status='done' AND ${between('completed_at')} THEN 1 ELSE 0 END) closed,
      SUM(CASE WHEN source='request' AND ${between('created_at')} THEN 1 ELSE 0 END) staff_requests,
      SUM(CASE WHEN priority='emergency' AND ${between('created_at')} THEN 1 ELSE 0 END) emergencies,
      SUM(CASE WHEN source='pm' AND status='done' AND ${between('completed_at')} THEN 1 ELSE 0 END) pm_done,
      SUM(CASE WHEN source='pm' AND status='done' AND ${between('completed_at')} AND date(completed_at) <= date(due_date) THEN 1 ELSE 0 END) pm_on_time,
      AVG(CASE WHEN source!='pm' AND status='done' AND ${between('completed_at')} THEN julianday(completed_at)-julianday(created_at) END) avg_close
    FROM work_orders`);
  Object.keys(wo).forEach(k => { if (k !== 'avg_close') wo[k] = wo[k] || 0; });
  wo.avg_close = wo.avg_close == null ? null : Math.round(wo.avg_close * 10) / 10;
  wo.pm_pct = wo.pm_done ? Math.round(100 * wo.pm_on_time / wo.pm_done) : null;

  const jobs = one(`SELECT COALESCE(SUM(hours),0) h, COALESCE(SUM(vendor_cost_avoided),0) c, COUNT(*) n FROM jobs WHERE ${between('job_date')}`);
  const woNoJob = one(`SELECT COALESCE(SUM(hours),0) h, COALESCE(SUM(cost_avoided),0) c FROM work_orders WHERE status='done' AND job_id IS NULL AND ${between('completed_at')}`);
  const labor = { hours: Math.round((jobs.h + woNoJob.h) * 10) / 10, cost_avoided: Math.round(jobs.c + woNoJob.c), jobs: jobs.n };

  const partsUsed = one(`SELECT COALESCE(SUM(-qty*unit_cost),0) c, COUNT(*) n FROM part_txns WHERE kind='use' AND ${between('at')}`);
  const partsRecv = one(`SELECT COALESCE(SUM(qty*unit_cost),0) c FROM part_txns WHERE kind='receive' AND ${between('at')}`);
  const topParts = all(`SELECT p.name, p.uom, SUM(-t.qty) q, SUM(-t.qty*t.unit_cost) c FROM part_txns t JOIN parts p ON p.id=t.part_id
    WHERE t.kind='use' AND ${between('t.at')} GROUP BY p.id ORDER BY c DESC LIMIT 8`);

  const vend = one(`SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM invoices WHERE status!='void' AND ${between('inv_date')}`);
  const byVendor = all(`SELECT v.name, SUM(i.amount) total, COUNT(*) n FROM invoices i JOIN vendors v ON v.id=i.vendor_id
    WHERE i.status!='void' AND ${between('i.inv_date')} GROUP BY v.id ORDER BY total DESC LIMIT 10`);
  const contractAnnual = one(`SELECT COALESCE(SUM(annual_cost),0) c FROM contracts WHERE active=1`).c;

  const byBuilding = all(`SELECT COALESCE(NULLIF(w.building,''),u.building,'Unassigned') building, COUNT(*) n,
      SUM(CASE WHEN w.status='done' THEN 1 ELSE 0 END) done
    FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id WHERE w.source!='pm' AND ${between('w.created_at')}
    GROUP BY 1 ORDER BY n DESC`);
  const byCategory = all(`SELECT category, COUNT(*) n FROM work_orders WHERE source!='pm' AND ${between('created_at')} GROUP BY category ORDER BY n DESC`);
  const repeat = all(`SELECT u.apt, u.building, u.system_type, COUNT(*) n FROM jobs j JOIN units u ON u.id=j.unit_id
    WHERE date(j.job_date) >= date(?, '-90 days') AND date(j.job_date) < date(?) GROUP BY u.id HAVING n >= 2 ORDER BY n DESC LIMIT 8`, end, end);
  const completed = all(`SELECT w.id, w.title, w.completed_at, w.hours, w.source, COALESCE(NULLIF(w.building,''),u.building,'') building, u.apt
    FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id WHERE w.status='done' AND ${between('w.completed_at')}
    ORDER BY w.completed_at DESC LIMIT 40`);

  // Status as of now, for the "open going into next month" section.
  const t = today();
  const openNow = all(`SELECT w.id, w.title, w.priority, w.status, w.due_date, COALESCE(NULLIF(w.building,''),u.building,'') building
    FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id
    WHERE w.status IN ('new','open','in_progress','on_hold') AND w.source!='pm' AND (w.priority IN ('emergency','high') OR (w.due_date IS NOT NULL AND date(w.due_date) < date(?)))
    ORDER BY CASE w.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 ELSE 2 END LIMIT 12`, t);
  const pmOverdue = one(`SELECT COUNT(*) n FROM pm_tasks WHERE active=1 AND date(next_due) < date(?)`, t).n;
  const lowStock = all(`SELECT name, on_hand, min_qty, uom FROM parts WHERE active=1 AND min_qty>0 AND on_hand<=min_qty ORDER BY on_hand LIMIT 10`);
  const contracts = all(`SELECT c.*, v.name vendor FROM contracts c JOIN vendors v ON v.id=c.vendor_id WHERE c.active=1 AND c.end_date IS NOT NULL
    AND date(c.end_date) <= date(?, '+90 days') ORDER BY date(c.end_date)`, t);
  const safety = one(`SELECT COUNT(*) n FROM units WHERE switch_present='no' OR switch_functioning='no'`).n;
  const stockValue = one(`SELECT COALESCE(SUM(on_hand*unit_cost),0) v FROM parts WHERE active=1 AND on_hand>0`).v;

  const label = new Date(start + 'T12:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { month, label, start, end, club: clubName(), generated: t, wo, labor,
           parts: { used: Math.round(partsUsed.c), received: Math.round(partsRecv.c), top: topParts, low: lowStock, value: Math.round(stockValue) },
           vendors: { total: Math.round(vend.total), invoices: vend.n, byVendor, contractAnnual: Math.round(contractAnnual), expiring: contracts },
           byBuilding, byCategory, repeat, completed, openNow, pmOverdue, safety,
           summary: getSetting('summary:' + month) };
}

function monthlyHtml(d, opts = {}) {
  const K = (n, l, s) => `<div class="k"><div class="n">${n}</div><div class="l">${escH(l)}</div>${s ? `<div class="s">${escH(s)}</div>` : ''}</div>`;
  const table = (head, rows) => rows.length ? `<table><tr>${head.map(h => `<th${/^(\$|#|Hrs|Qty|Cost|Jobs|Total|Done|Count)/.test(h) ? ' class="r"' : ''}>${escH(h)}</th>`).join('')}</tr>${rows.join('')}</table>` : '<p class="dim">None.</p>';
  const internal = d.labor.cost_avoided + 0;
  let b = `
<div class="hd">
  <div><div class="club">${escH(d.club)}</div><h1>Facilities Report</h1><div class="mo">${escH(d.label)}</div></div>
  ${opts.crest ? `<img src="${opts.crest}" alt="">` : ''}
</div>
${d.summary ? `<div class="sum"><div class="eb">Summary</div><p>${escH(d.summary).replace(/\n\n/g, '</p><p>')}</p></div>` : ''}
<div class="eb">The month at a glance</div>
<div class="kp">
  ${K(d.wo.opened, 'Work orders opened', d.wo.staff_requests + ' from staff requests')}
  ${K(d.wo.closed, 'Work orders closed', d.wo.avg_close == null ? '' : 'Avg ' + d.wo.avg_close + ' days to close')}
  ${K(d.wo.pm_pct == null ? '—' : d.wo.pm_pct + '%', 'PM on time', d.wo.pm_done + ' PM tasks completed')}
  ${K(d.wo.emergencies, 'Emergencies', '')}
  ${K(d.labor.hours, 'In-house labor hours', d.labor.jobs + ' service entries')}
  ${K(money(internal), 'Vendor cost avoided', 'Work done in-house')}
  ${K(money(d.vendors.total), 'Vendor spend', d.vendors.invoices + ' invoices')}
  ${K(money(d.parts.used), 'Parts used', money(d.parts.value) + ' on the shelf')}
</div>

<div class="two">
<div><div class="eb">Work by building</div>
${table(['Building', 'Opened', 'Done'], d.byBuilding.map(r => `<tr><td>${escH(r.building)}</td><td class="r">${r.n}</td><td class="r">${r.done}</td></tr>`))}</div>
<div><div class="eb">Work by trade</div>
${table(['Category', 'Count'], d.byCategory.map(r => `<tr><td>${escH(r.category)}</td><td class="r">${r.n}</td></tr>`))}</div>
</div>

<div class="eb">Needs a decision or follow-up</div>
<ul class="flags">
${d.openNow.length ? d.openNow.map(w => `<li><b>#${w.id} ${escH(w.title)}</b> · ${escH(w.building || '')} ${w.priority === 'emergency' || w.priority === 'high' ? `<span class="red">${w.priority}</span>` : '<span class="red">past due</span>'}</li>`).join('') : ''}
${d.pmOverdue ? `<li><b>${d.pmOverdue} PM task${d.pmOverdue > 1 ? 's' : ''} overdue</b></li>` : ''}
${d.safety ? `<li><b>${d.safety} safety device${d.safety > 1 ? 's' : ''} out of service</b></li>` : ''}
${d.vendors.expiring.map(c => `<li><b>${escH(c.title)}</b> (${escH(c.vendor)}) ends ${escH(c.end_date)}${c.auto_renew ? ', auto-renews' : ''}${c.annual_cost ? ' · ' + money(c.annual_cost) + '/yr' : ''}</li>`).join('')}
${d.parts.low.length ? `<li><b>${d.parts.low.length} stock item${d.parts.low.length > 1 ? 's' : ''} at or below minimum:</b> ${d.parts.low.slice(0, 5).map(p => escH(p.name)).join(', ')}</li>` : ''}
${!d.openNow.length && !d.pmOverdue && !d.safety && !d.vendors.expiring.length && !d.parts.low.length ? '<li>Nothing open that needs a decision.</li>' : ''}
</ul>

${d.repeat.length ? `<div class="eb">Repeat problems, last 90 days</div>
<p class="dim">Equipment with two or more service calls. Candidates for repair-or-replace review.</p>
${table(['Equipment', 'Building', 'Type', 'Calls'], d.repeat.map(r => `<tr><td><b>${escH(r.apt)}</b></td><td>${escH(r.building || '')}</td><td>${escH(r.system_type || '')}</td><td class="r">${r.n}</td></tr>`))}` : ''}

<div class="two">
<div><div class="eb">Vendor spend</div>
${table(['Vendor', 'Total'], d.vendors.byVendor.map(v => `<tr><td>${escH(v.name)}</td><td class="r">${money(v.total)}</td></tr>`))}
<p class="dim">Service contracts on file: ${money(d.vendors.contractAnnual)} per year.</p></div>
<div><div class="eb">Top parts used</div>
${table(['Part', 'Qty', 'Cost'], d.parts.top.map(p => `<tr><td>${escH(p.name)}</td><td class="r">${+p.q} ${escH(p.uom)}</td><td class="r">${money(p.c)}</td></tr>`))}</div>
</div>

<div class="eb">Completed work</div>
${table(['Date', 'Work', 'Where', 'Hrs'], d.completed.map(w => `<tr><td>${escH(String(w.completed_at).slice(5, 10))}</td><td>${w.source === 'pm' ? '<span class="pm">PM</span> ' : ''}${escH(w.title)}</td><td>${escH([w.building, w.apt].filter(Boolean).join(' · '))}</td><td class="r">${w.hours || ''}</td></tr>`))}
<div class="ft">Generated ${escH(d.generated)} by Clubhouse IQ</div>`;

  const css = `
*{box-sizing:border-box}body{margin:0;background:#F3EFE5;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1A2436;font-size:13px;line-height:1.45}
.page{max-width:820px;margin:0 auto;background:#fff;padding:28px 30px 40px;min-height:100vh}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #B79B5B;padding-bottom:12px;margin-bottom:18px}
.hd img{height:64px}.club{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4F6F99}
h1{font-family:Georgia,'Libre Caslon Text',serif;font-size:28px;margin:4px 0 2px;color:#1F3A63}.mo{font-family:Georgia,serif;font-size:16px;color:#9A7B32}
.eb{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4F6F99;margin:22px 0 8px;border-bottom:1px solid #DDD5C3;padding-bottom:4px}
.kp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.k{border:1px solid #DDD5C3;border-radius:4px;padding:10px;background:#FBF9F4}
.k .n{font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#1F3A63}.k .l{font-size:11px;font-weight:600}.k .s{font-size:10px;color:#7C8494}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#7C8494;border-bottom:1px solid #DDD5C3;padding:4px 6px}
td{border-bottom:1px solid #EEE8DA;padding:5px 6px;vertical-align:top}.r{text-align:right;white-space:nowrap}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.dim{color:#7C8494;font-size:12px}
.flags{margin:0;padding-left:18px}.flags li{margin-bottom:5px}.red{color:#B3362D;font-size:11px;text-transform:uppercase;font-weight:bold}
.pm{background:#EDE7D8;color:#6B5320;font-size:9px;padding:1px 4px;border-radius:2px;font-weight:bold}
.sum{background:#FBF9F4;border-left:3px solid #B79B5B;padding:4px 14px 2px;margin-bottom:6px}.sum .eb{border:0;margin-top:10px}
.ft{margin-top:26px;font-size:10px;color:#7C8494;text-align:center}
.bar{position:sticky;top:0;background:#1F3A63;padding:10px;text-align:center;z-index:5}
.bar button{background:#D8BE7C;border:0;color:#1F3A63;font-weight:bold;padding:9px 18px;border-radius:3px;font-size:14px;margin:0 4px}
@media(max-width:640px){.page{padding:18px 14px}.kp{grid-template-columns:1fr 1fr}.two{grid-template-columns:1fr;gap:0}h1{font-size:23px}}
@media print{.bar{display:none}body{background:#fff}.page{padding:0;max-width:none}.eb{break-after:avoid}tr{break-inside:avoid}}`;
  if (opts.fragment) return b;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escH(d.club)} Facilities Report ${escH(d.label)}</title><style>${css}</style></head><body>
${opts.printBar ? '<div class="bar"><button onclick="window.print()">Print or save PDF</button><button onclick="window.close()">Close</button></div>' : ''}
<div class="page">${b}</div></body></html>`;
}

async function emailMonthly(month) {
  const d = monthlyData(month);
  let n = 0;
  for (const { u, p } of recipients('monthly')) {
    if (!p.email) continue;
    if (await sendEmail(u.email, `${d.club} facilities report · ${d.label}`, monthlyHtml(d), `Facilities report for ${d.label}`, 'monthly', d.month)) n++;
  }
  return n;
}

async function aiSummary(d) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('The AI summary needs ANTHROPIC_API_KEY set on the server');
  const facts = JSON.stringify({
    month: d.label, work_orders: d.wo, labor: d.labor, parts: { used: d.parts.used, low_stock: d.parts.low.map(p => p.name) },
    vendors: { spend: d.vendors.total, top: d.vendors.byVendor.slice(0, 4), expiring_contracts: d.vendors.expiring.map(c => ({ title: c.title, vendor: c.vendor, ends: c.end_date })) },
    by_building: d.byBuilding, repeat_equipment: d.repeat, open_issues: d.openNow.map(w => w.title), pm_overdue: d.pmOverdue, safety_devices_out: d.safety,
    completed_sample: d.completed.slice(0, 15).map(w => w.title)
  });
  const prompt = `You write the monthly facilities report summary for the general manager of ${d.club}, a private country club founded in 1902 with a central plant (boilers, cooling tower, water-source heat pump loop), clubhouse, tennis center, pool, and golf facilities.

Here is the month's data as JSON:
${facts}

Write 2 short paragraphs, plain and direct, no headings, no bullet points, no em dashes. First paragraph: what got done and the headline numbers that matter to a GM (work completed, PM compliance, cost avoided by doing work in-house, vendor spend). Second paragraph: what needs attention or a decision next month (expiring contracts, repeat-failure equipment that may need capital replacement, safety items, low stock). Only use facts from the data. If a number is zero or missing, do not make a point of it. Under 170 words total.`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error('Summary service error: ' + (await r.text()).slice(0, 160));
  const data = await r.json();
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').replace(/—/g, ',').trim();
}

/* =================================================================
   DEMO DATA
   ================================================================= */

function seedDemo() {
  if (!DEMO_MODE) return;
  if (db.prepare('SELECT COUNT(*) c FROM parts').get().c === 0) {
    loadStarterParts('demo');
    const parts = db.prepare('SELECT id, min_qty, reorder_qty FROM parts').all();
    parts.forEach((p, i) => {
      const qty = i % 7 === 3 ? 0 : i % 5 === 1 ? Math.max(0, p.min_qty - 1) : p.min_qty + p.reorder_qty;
      if (qty) partTxn(p.id, 'receive', qty, { by: 'Demo', note: 'Opening count' });
    });
    const f = db.prepare(`SELECT id FROM parts WHERE name LIKE 'Pleated filter 20x20%'`).get();
    const c = db.prepare(`SELECT id FROM parts WHERE name LIKE 'Run capacitor 45/5%'`).get();
    if (f) partTxn(f.id, 'use', -8, { by: 'Demo Tech', note: 'Clubhouse heat pump filters' });
    if (c) { const cp = db.prepare('SELECT on_hand FROM parts WHERE id=?').get(c.id); if (cp.on_hand < 1) partTxn(c.id, 'receive', 2, { by: 'Demo', note: 'Received' }); partTxn(c.id, 'use', -1, { by: 'Demo Tech', note: 'HP-CH-03 capacitor' }); }
  }
  if (db.prepare('SELECT COUNT(*) c FROM vendors').get().c === 0) {
    const t = today();
    const v = db.prepare(`INSERT INTO vendors (name, trade, contact, phone, emergency_phone, email, insurance_exp, w9_on_file, rating, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const c = db.prepare(`INSERT INTO contracts (vendor_id, title, scope, covers, start_date, end_date, auto_renew, notice_days, annual_cost, billing, visit_freq_days, next_visit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const inv = db.prepare(`INSERT INTO invoices (vendor_id, contract_id, invoice_no, inv_date, amount, building, description, status, entered_by) VALUES (?,?,?,?,?,?,?,?,?)`);
    const a = v.run('Sample Water Treatment Co.', 'Cooling tower / water treatment', 'Service rep', '501-555-0141', '501-555-0199', 'service@example.com', addDays(t, 200), 1, 4, 'Sample vendor for the demo').lastInsertRowid;
    const ca = c.run(a, 'Cooling tower and loop water treatment', 'Monthly testing, chemical supply, quarterly report', 'Central Plant: cooling tower, closed loop', addDays(t, -300), addDays(t, 24), 1, 30, 9600, 'monthly', 30, addDays(t, 3)).lastInsertRowid;
    inv.run(a, ca, 'WT-2291', addDays(t, -20), 800, 'Central Plant', 'Monthly water treatment service', 'paid', 'Demo');
    inv.run(a, ca, 'WT-2317', addDays(t, -2), 800, 'Central Plant', 'Monthly water treatment service', 'pending', 'Demo');
    const b = v.run('Sample Boiler Service LLC', 'Boiler', 'Dispatcher', '501-555-0172', '501-555-0173', 'dispatch@example.com', addDays(t, -5), 1, 5, 'Sample vendor for the demo').lastInsertRowid;
    c.run(b, 'Annual boiler inspection and combustion tune-up', 'State inspection support, combustion analysis, safety check', 'Central Plant boilers', addDays(t, -340), addDays(t, 60), 0, 45, 3200, 'annual', 365, addDays(t, 40));
    inv.run(b, null, 'BS-10488', addDays(t, -12), 1475, 'Central Plant', 'Replaced boiler 2 flame safeguard, after hours', 'pending', 'Demo');
    const k = v.run('Sample Kitchen Hood Cleaning', 'Grease trap / hood cleaning', 'Office', '501-555-0110', '', 'office@example.com', addDays(t, 150), 0, 3, 'Sample vendor for the demo').lastInsertRowid;
    c.run(k, 'Kitchen hood and duct cleaning', 'NFPA 96 hood, duct, and fan cleaning with certificate', 'Clubhouse kitchen', addDays(t, -150), addDays(t, 215), 1, 30, 2800, 'quarterly', 90, addDays(t, -2));
    inv.run(k, null, 'HC-771', addDays(t, -40), 700, 'Clubhouse', 'Quarterly hood cleaning', 'paid', 'Demo');
    const s = v.run('Sample HVAC Supply House', 'Supply house', 'Counter', '501-555-0133', '', 'orders@example.com', null, 1, 4, 'Account pricing. Sample vendor for the demo').lastInsertRowid;
    db.prepare(`UPDATE parts SET vendor_id=? WHERE category IN ('Filters','Belts','Electrical','Heat pump','Refrigerant')`).run(s);
    db.prepare(`UPDATE parts SET vendor_id=? WHERE category IN ('Water treatment','Cooling tower')`).run(a);
    v.run('Sample Controls Integrator', 'Controls / BAS', 'Project manager', '501-555-0150', '', 'pm@example.com', addDays(t, 90), 1, 4, 'Sample vendor for the demo');
  }
}

/* =================================================================
   ROUTES
   ================================================================= */

function mount(app, auth, hooks = {}) {
  const sign = hooks.sign;
  const mgr = u => u.role === 'admin' || u.role === 'manager';

  /* ----- account ----- */
  app.get('/api/me', auth, (req, res) => {
    if (req.user.id <= 0) return res.json({ user: Object.assign({}, req.user, { role_label: ROLE_LABEL[req.user.role], notify: DEFAULT_NOTIFY[req.user.role], demo: true }) });
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
  });
  app.put('/api/me', auth, (req, res) => {
    if (req.user.id <= 0) return res.status(400).json({ error: 'Demo accounts cannot be changed' });
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const b = req.body || {};
    const notify = b.notify && typeof b.notify === 'object' ? JSON.stringify(b.notify) : u.notify;
    db.prepare('UPDATE users SET name=?, phone=?, notify=? WHERE id=?')
      .run(clip(b.name, 80) || u.name, b.phone === undefined ? u.phone : clip(b.phone, 30), notify, u.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
  });
  app.post('/api/me/password', auth, (req, res) => {
    if (req.user.id <= 0) return res.status(400).json({ error: 'Demo accounts have no password' });
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const b = req.body || {};
    if (!bcrypt.compareSync(b.current || '', u.password_hash)) return res.status(400).json({ error: 'Current password is wrong' });
    if (String(b.next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    db.prepare('UPDATE users SET password_hash=?, must_change=0 WHERE id=?').run(bcrypt.hashSync(b.next, 10), u.id);
    res.json({ ok: true });
  });

  /* ----- team (admin/manager) ----- */
  app.get('/api/users', auth, (req, res) => {
    const users = db.prepare('SELECT * FROM users ORDER BY active DESC, CASE role WHEN \'admin\' THEN 0 WHEN \'manager\' THEN 1 WHEN \'tech\' THEN 2 WHEN \'staff\' THEN 3 ELSE 4 END, name').all().map(publicUser);
    res.json({ users, roles: ROLES.map(r => ({ key: r, label: ROLE_LABEL[r], help: ROLE_HELP[r] })),
               departments: ['Maintenance', 'Kitchen', 'Dining / Banquets', 'Front Desk', 'Golf Shop', 'Tennis', 'Fitness', 'Pool', 'Housekeeping', 'Grounds', 'Administration', 'Other'] });
  });
  const canTouch = (actor, target, newRole) => {
    if (actor.role === 'admin') return null;
    if (target && target.role === 'admin') return 'Only an admin can change an admin account';
    if (newRole === 'admin') return 'Only an admin can make someone an admin';
    return null;
  };
  const adminsLeft = excludeId => db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id != ?`).get(excludeId).c;
  app.post('/api/users', auth, (req, res) => {
    const b = req.body || {};
    const name = clip(b.name, 80), email = clip(b.email, 120).toLowerCase();
    const role = ROLES.includes(b.role) ? b.role : 'tech';
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Name and a valid email are required' });
    const err = canTouch(req.user, null, role); if (err) return res.status(403).json({ error: err });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(400).json({ error: 'That email already has an account' });
    const temp = tempPassword();
    const info = db.prepare(`INSERT INTO users (email, name, password_hash, role, property_id, phone, dept, active, must_change) VALUES (?,?,?,?,1,?,?,1,1)`)
      .run(email, name, bcrypt.hashSync(temp, 10), role, clip(b.phone, 30), clip(b.dept, 60));
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid)), temp_password: temp });
  });
  app.put('/api/users/:id', auth, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Account not found' });
    const b = req.body || {};
    const role = b.role !== undefined && ROLES.includes(b.role) ? b.role : u.role;
    const active = b.active === undefined ? u.active : (b.active ? 1 : 0);
    const err = canTouch(req.user, u, role); if (err) return res.status(403).json({ error: err });
    if (u.role === 'admin' && (role !== 'admin' || !active) && adminsLeft(u.id) === 0) return res.status(400).json({ error: 'You need at least one active admin' });
    db.prepare('UPDATE users SET name=?, role=?, phone=?, dept=?, active=? WHERE id=?')
      .run(clip(b.name, 80) || u.name, role, b.phone === undefined ? u.phone : clip(b.phone, 30), b.dept === undefined ? u.dept : clip(b.dept, 60), active, u.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
  });
  app.post('/api/users/:id/reset', auth, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Account not found' });
    const err = canTouch(req.user, u, u.role); if (err) return res.status(403).json({ error: err });
    const temp = tempPassword();
    db.prepare('UPDATE users SET password_hash=?, must_change=1 WHERE id=?').run(bcrypt.hashSync(temp, 10), u.id);
    res.json({ temp_password: temp });
  });

  /* ----- parts ----- */
  app.get('/api/parts', auth, (req, res) => {
    const rows = db.prepare(`SELECT p.*, v.name vendor_name,
        (SELECT MAX(at) FROM part_txns t WHERE t.part_id=p.id AND t.kind='use') last_used,
        (SELECT COALESCE(SUM(-qty),0) FROM part_txns t WHERE t.part_id=p.id AND t.kind='use' AND date(at) >= date('now','-90 days')) used_90
      FROM parts p LEFT JOIN vendors v ON v.id=p.vendor_id WHERE p.active=1 ORDER BY p.category, p.name`).all();
    const value = rows.reduce((s, p) => s + Math.max(0, p.on_hand) * p.unit_cost, 0);
    const low = rows.filter(p => p.min_qty > 0 && p.on_hand <= p.min_qty).length;
    const out = rows.filter(p => p.on_hand <= 0 && p.min_qty > 0).length;
    res.json({ parts: rows, categories: PART_CATEGORIES, stats: { count: rows.length, value: Math.round(value), low, out } });
  });
  app.get('/api/parts/reorder', auth, (req, res) => {
    const rows = db.prepare(`SELECT p.*, v.name vendor_name, v.phone vendor_phone, v.email vendor_email FROM parts p LEFT JOIN vendors v ON v.id=p.vendor_id
      WHERE p.active=1 AND p.min_qty > 0 AND p.on_hand <= p.min_qty ORDER BY COALESCE(v.name,'zzz'), p.name`).all();
    const groups = {};
    rows.forEach(p => {
      const order = Math.max(p.reorder_qty || 0, p.min_qty * 2 - p.on_hand);
      p.order_qty = Math.ceil(order);
      p.order_cost = Math.round(p.order_qty * p.unit_cost * 100) / 100;
      const k = p.vendor_name || 'No vendor set';
      (groups[k] = groups[k] || { vendor: k, phone: p.vendor_phone || '', email: p.vendor_email || '', items: [], total: 0 });
      groups[k].items.push(p); groups[k].total += p.order_cost;
    });
    res.json({ groups: Object.values(groups) });
  });
  app.get('/api/parts/:id', auth, (req, res) => {
    const p = partRow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Part not found' });
    p.txns = db.prepare(`SELECT t.*, w.title wo_title, u.apt FROM part_txns t LEFT JOIN work_orders w ON w.id=t.wo_id LEFT JOIN units u ON u.id=t.unit_id
      WHERE t.part_id=? ORDER BY t.id DESC LIMIT 60`).all(p.id);
    res.json({ part: p });
  });
  const partFields = b => ({
    name: clip(b.name, 120), part_no: clip(b.part_no, 60), category: PART_CATEGORIES.includes(b.category) ? b.category : 'General',
    manufacturer: clip(b.manufacturer, 60), location: clip(b.location, 80), uom: clip(b.uom, 12) || 'ea',
    min_qty: Math.max(0, num(b.min_qty)), reorder_qty: Math.max(0, num(b.reorder_qty)), unit_cost: Math.max(0, num(b.unit_cost)),
    vendor_id: parseInt(b.vendor_id, 10) || null, fits: clip(b.fits, 200), notes: clip(b.notes, 500)
  });
  app.post('/api/parts', auth, (req, res) => {
    const f = partFields(req.body || {});
    if (!f.name) return res.status(400).json({ error: 'Name the part' });
    const info = db.prepare(`INSERT INTO parts (name, part_no, category, manufacturer, location, uom, min_qty, reorder_qty, unit_cost, vendor_id, fits, notes)
      VALUES (@name,@part_no,@category,@manufacturer,@location,@uom,@min_qty,@reorder_qty,@unit_cost,@vendor_id,@fits,@notes)`).run(f);
    const start = num((req.body || {}).on_hand);
    if (start > 0) partTxn(info.lastInsertRowid, 'count', start, { by: req.user.name, note: 'Starting count' });
    res.json({ part: partRow(info.lastInsertRowid) });
  });
  app.put('/api/parts/:id', auth, (req, res) => {
    const p = db.prepare('SELECT * FROM parts WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Part not found' });
    const f = partFields(Object.assign({}, p, req.body || {}));
    if (!f.name) return res.status(400).json({ error: 'Name the part' });
    db.prepare(`UPDATE parts SET name=@name, part_no=@part_no, category=@category, manufacturer=@manufacturer, location=@location, uom=@uom,
      min_qty=@min_qty, reorder_qty=@reorder_qty, unit_cost=@unit_cost, vendor_id=@vendor_id, fits=@fits, notes=@notes WHERE id=@id`).run(Object.assign(f, { id: p.id }));
    res.json({ part: partRow(p.id) });
  });
  app.delete('/api/parts/:id', auth, (req, res) => {
    db.prepare('UPDATE parts SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/parts/:id/txn', auth, (req, res) => {
    const p = db.prepare('SELECT * FROM parts WHERE id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Part not found' });
    const b = req.body || {};
    const kind = ['receive', 'use', 'adjust', 'count'].includes(b.kind) ? b.kind : null;
    if (!kind) return res.status(400).json({ error: 'Pick receive, use, adjust, or count' });
    let qty = num(b.qty, NaN);
    if (!isFinite(qty)) return res.status(400).json({ error: 'Enter a quantity' });
    let unitId = null;
    if (b.apt) { const u = db.prepare('SELECT id FROM units WHERE apt=?').get(String(b.apt).toUpperCase().trim()); unitId = u ? u.id : null; }
    if (kind === 'count') { qty = qty - p.on_hand; if (!qty) return res.json({ part: partRow(p.id) }); }
    else if (kind === 'use') qty = -Math.abs(qty);
    else if (kind === 'receive') qty = Math.abs(qty);
    partTxn(p.id, kind, qty, { unit_cost: kind === 'receive' ? b.unit_cost : null, note: b.note, by: req.user.name, unit_id: unitId, wo_id: parseInt(b.wo_id, 10) || null });
    res.json({ part: partRow(p.id) });
  });
  app.post('/api/parts/starter', auth, (req, res) => res.json({ created: loadStarterParts(req.user.name) }));

  /* ----- vendors ----- */
  app.get('/api/vendors', auth, (req, res) => {
    const y = today().slice(0, 4) + '-01-01';
    const rows = db.prepare(`SELECT v.*,
        (SELECT COUNT(*) FROM contracts c WHERE c.vendor_id=v.id AND c.active=1) contracts,
        (SELECT COALESCE(SUM(annual_cost),0) FROM contracts c WHERE c.vendor_id=v.id AND c.active=1) contract_annual,
        (SELECT COALESCE(SUM(amount),0) FROM invoices i WHERE i.vendor_id=v.id AND i.status!='void' AND date(inv_date) >= date(?)) ytd,
        (SELECT COUNT(*) FROM invoices i WHERE i.vendor_id=v.id AND i.status='pending') pending,
        (SELECT COUNT(*) FROM work_orders w WHERE w.vendor_id=v.id AND w.status IN ('new','open','in_progress','on_hold')) open_wo
      FROM vendors v WHERE v.active=1 ORDER BY v.name`).all(y);
    const t = today();
    rows.forEach(v => { v.insurance_days = v.insurance_exp ? daysBetween(t, v.insurance_exp) : null; });
    const contracts = db.prepare(`SELECT c.*, v.name vendor FROM contracts c JOIN vendors v ON v.id=c.vendor_id WHERE c.active=1 ORDER BY COALESCE(c.end_date,'9999')`).all()
      .map(c => Object.assign(c, contractState(c, t)));
    const tot = db.prepare(`SELECT COALESCE(SUM(amount),0) ytd FROM invoices WHERE status!='void' AND date(inv_date) >= date(?)`).get(y);
    const pend = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) amt FROM invoices WHERE status='pending'`).get();
    res.json({ vendors: rows, contracts, trades: TRADES,
               stats: { ytd: Math.round(tot.ytd), annual: Math.round(contracts.reduce((s, c) => s + (c.annual_cost || 0), 0)), pending: pend.n, pending_amt: Math.round(pend.amt) } });
  });
  app.get('/api/vendors/:id', auth, (req, res) => {
    const v = db.prepare('SELECT * FROM vendors WHERE id=?').get(req.params.id);
    if (!v) return res.status(404).json({ error: 'Vendor not found' });
    const t = today();
    v.insurance_days = v.insurance_exp ? daysBetween(t, v.insurance_exp) : null;
    v.contracts = db.prepare('SELECT * FROM contracts WHERE vendor_id=? AND active=1 ORDER BY COALESCE(end_date,\'9999\')').all(v.id).map(c => Object.assign(c, contractState(c, t)));
    v.invoices = db.prepare('SELECT i.*, c.title contract FROM invoices i LEFT JOIN contracts c ON c.id=i.contract_id WHERE i.vendor_id=? ORDER BY date(inv_date) DESC, i.id DESC LIMIT 50').all(v.id);
    v.workorders = db.prepare(`SELECT w.id, w.title, w.status, w.priority, w.created_at FROM work_orders w WHERE w.vendor_id=? ORDER BY w.id DESC LIMIT 25`).all(v.id);
    v.parts = db.prepare('SELECT id, name, on_hand, min_qty, uom FROM parts WHERE vendor_id=? AND active=1 ORDER BY name').all(v.id);
    res.json({ vendor: v });
  });
  const vendorFields = b => ({
    name: clip(b.name, 120), trade: clip(b.trade, 60), contact: clip(b.contact, 80), phone: clip(b.phone, 30),
    emergency_phone: clip(b.emergency_phone, 30), email: clip(b.email, 120), account_no: clip(b.account_no, 60),
    website: clip(b.website, 200), address: clip(b.address, 200), insurance_exp: isDate(b.insurance_exp) ? b.insurance_exp : null,
    w9_on_file: b.w9_on_file ? 1 : 0, rating: Math.max(0, Math.min(5, parseInt(b.rating, 10) || 0)), notes: clip(b.notes, 1000)
  });
  app.post('/api/vendors', auth, (req, res) => {
    const f = vendorFields(req.body || {});
    if (!f.name) return res.status(400).json({ error: 'Vendor name is required' });
    const info = db.prepare(`INSERT INTO vendors (name, trade, contact, phone, emergency_phone, email, account_no, website, address, insurance_exp, w9_on_file, rating, notes)
      VALUES (@name,@trade,@contact,@phone,@emergency_phone,@email,@account_no,@website,@address,@insurance_exp,@w9_on_file,@rating,@notes)`).run(f);
    res.json({ id: info.lastInsertRowid });
  });
  app.put('/api/vendors/:id', auth, (req, res) => {
    const v = db.prepare('SELECT * FROM vendors WHERE id=?').get(req.params.id);
    if (!v) return res.status(404).json({ error: 'Vendor not found' });
    const f = vendorFields(Object.assign({}, v, req.body || {}));
    if (!f.name) return res.status(400).json({ error: 'Vendor name is required' });
    db.prepare(`UPDATE vendors SET name=@name, trade=@trade, contact=@contact, phone=@phone, emergency_phone=@emergency_phone, email=@email,
      account_no=@account_no, website=@website, address=@address, insurance_exp=@insurance_exp, w9_on_file=@w9_on_file, rating=@rating, notes=@notes WHERE id=@id`)
      .run(Object.assign(f, { id: v.id }));
    res.json({ id: v.id });
  });
  app.delete('/api/vendors/:id', auth, (req, res) => {
    db.prepare('UPDATE vendors SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  const contractFields = b => ({
    vendor_id: parseInt(b.vendor_id, 10), title: clip(b.title, 160), scope: clip(b.scope, 2000), covers: clip(b.covers, 300),
    start_date: isDate(b.start_date) ? b.start_date : null, end_date: isDate(b.end_date) ? b.end_date : null,
    auto_renew: b.auto_renew ? 1 : 0, notice_days: Math.max(0, parseInt(b.notice_days, 10) || 30), annual_cost: Math.max(0, num(b.annual_cost)),
    billing: ['monthly', 'quarterly', 'annual', 'per visit'].includes(b.billing) ? b.billing : 'annual',
    visit_freq_days: Math.max(0, parseInt(b.visit_freq_days, 10) || 0), next_visit: isDate(b.next_visit) ? b.next_visit : null, notes: clip(b.notes, 1000)
  });
  app.post('/api/contracts', auth, (req, res) => {
    const f = contractFields(req.body || {});
    if (!f.vendor_id || !f.title) return res.status(400).json({ error: 'Vendor and contract title are required' });
    const info = db.prepare(`INSERT INTO contracts (vendor_id, title, scope, covers, start_date, end_date, auto_renew, notice_days, annual_cost, billing, visit_freq_days, next_visit, notes)
      VALUES (@vendor_id,@title,@scope,@covers,@start_date,@end_date,@auto_renew,@notice_days,@annual_cost,@billing,@visit_freq_days,@next_visit,@notes)`).run(f);
    res.json({ id: info.lastInsertRowid });
  });
  app.put('/api/contracts/:id', auth, (req, res) => {
    const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Contract not found' });
    const f = contractFields(Object.assign({}, c, req.body || {}));
    db.prepare(`UPDATE contracts SET title=@title, scope=@scope, covers=@covers, start_date=@start_date, end_date=@end_date, auto_renew=@auto_renew,
      notice_days=@notice_days, annual_cost=@annual_cost, billing=@billing, visit_freq_days=@visit_freq_days, next_visit=@next_visit, notes=@notes WHERE id=@id`)
      .run(Object.assign(f, { id: c.id }));
    res.json({ id: c.id });
  });
  // Log a completed contract visit and roll the next one forward.
  app.post('/api/contracts/:id/visit', auth, (req, res) => {
    const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Contract not found' });
    const next = c.visit_freq_days ? addDays(today(), c.visit_freq_days) : null;
    db.prepare('UPDATE contracts SET next_visit=? WHERE id=?').run(next, c.id);
    res.json({ next_visit: next });
  });
  app.delete('/api/contracts/:id', auth, (req, res) => {
    db.prepare('UPDATE contracts SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  /* ----- invoices ----- */
  app.get('/api/invoices', auth, (req, res) => {
    const st = req.query.status;
    const rows = db.prepare(`SELECT i.*, v.name vendor, c.title contract, w.title wo_title FROM invoices i
      JOIN vendors v ON v.id=i.vendor_id LEFT JOIN contracts c ON c.id=i.contract_id LEFT JOIN work_orders w ON w.id=i.wo_id
      ${st ? 'WHERE i.status=?' : ''} ORDER BY CASE i.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, date(i.inv_date) DESC, i.id DESC LIMIT 200`)
      .all(...(st ? [st] : []));
    res.json({ invoices: rows });
  });
  app.post('/api/invoices', auth, (req, res) => {
    const b = req.body || {};
    const vendor_id = parseInt(b.vendor_id, 10);
    const amount = num(b.amount, NaN);
    if (!vendor_id || !isFinite(amount)) return res.status(400).json({ error: 'Vendor and amount are required' });
    const woId = parseInt(b.wo_id, 10) || null;
    const info = db.prepare(`INSERT INTO invoices (vendor_id, contract_id, wo_id, invoice_no, inv_date, amount, building, description, status, entered_by)
      VALUES (?,?,?,?,?,?,?,?,'pending',?)`).run(vendor_id, parseInt(b.contract_id, 10) || null, woId, clip(b.invoice_no, 40),
      isDate(b.inv_date) ? b.inv_date : today(), amount, clip(b.building, 80), clip(b.description, 500), req.user.name);
    if (woId) db.prepare('UPDATE work_orders SET vendor_cost = COALESCE(vendor_cost,0) + ? WHERE id=?').run(amount, woId);
    res.json({ id: info.lastInsertRowid });
  });
  app.post('/api/invoices/:id/approve', auth, (req, res) => {
    db.prepare(`UPDATE invoices SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=? AND status='pending'`).run(req.user.name, req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/invoices/:id/paid', auth, (req, res) => {
    db.prepare(`UPDATE invoices SET status='paid', approved_by=CASE WHEN approved_by='' THEN ? ELSE approved_by END, approved_at=COALESCE(approved_at, datetime('now')) WHERE id=?`).run(req.user.name, req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/invoices/:id', auth, (req, res) => {
    const i = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
    if (!i) return res.status(404).json({ error: 'Invoice not found' });
    if (i.status !== 'pending' && !mgr(req.user)) return res.status(403).json({ error: 'Only a manager can void an approved invoice' });
    db.prepare(`UPDATE invoices SET status='void' WHERE id=?`).run(i.id);
    if (i.wo_id) db.prepare('UPDATE work_orders SET vendor_cost = MAX(0, COALESCE(vendor_cost,0) - ?) WHERE id=?').run(i.amount, i.wo_id);
    res.json({ ok: true });
  });

  /* ----- alerts ----- */
  app.get('/api/alerts', auth, (req, res) => {
    const alerts = computeAlerts(req.user);
    res.json({ alerts, count: alerts.filter(a => a.level !== 'info').length, total: alerts.length });
  });
  app.get('/api/notify/status', auth, (req, res) => {
    res.json({ email: smtpReady(), sms: smsReady(), public_url: appUrl(), digest_hour: parseInt(process.env.DIGEST_HOUR || '6', 10), tz: TZ });
  });
  app.post('/api/alerts/test', auth, async (req, res) => {
    if (req.user.id <= 0) return res.status(400).json({ error: 'Sign in with a real account to test alerts' });
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const out = {};
    if (smtpReady()) out.email = await sendEmail(u.email, 'Clubhouse IQ test alert', emailShell('Test alert', '<p>Email alerts are working.</p>'), 'Email alerts are working.', 'test', u.id);
    if (smsReady() && u.phone) out.sms = await sendSms(u.phone, 'Clubhouse IQ: text alerts are working.', 'test', u.id);
    if (!Object.keys(out).length) return res.status(400).json({ error: smtpReady() ? 'Add your cell number to get a test text' : 'Email and text are not set up on the server yet' });
    res.json(out);
  });
  app.get('/api/alerts/log', auth, (req, res) => {
    res.json({ log: db.prepare('SELECT * FROM alert_log ORDER BY id DESC LIMIT 60').all() });
  });
  app.post('/api/alerts/digest-preview', auth, (req, res) => res.json({ html: digestHtml(req.user).html }));

  /* ----- monthly report ----- */
  app.get('/api/report/monthly', auth, (req, res) => {
    const d = monthlyData(req.query.month);
    const months = db.prepare(`SELECT DISTINCT substr(created_at,1,7) m FROM work_orders UNION SELECT DISTINCT substr(job_date,1,7) FROM jobs ORDER BY 1 DESC LIMIT 24`).all().map(r => r.m).filter(Boolean);
    if (!months.includes(today().slice(0, 7))) months.unshift(today().slice(0, 7));
    res.json({ data: d, html: monthlyHtml(d, { printBar: true, crest: (hooks.origin ? hooks.origin(req) : '') + '/crest.png' }), months });
  });
  app.post('/api/report/monthly/summary', auth, async (req, res) => {
    try {
      const d = monthlyData((req.body || {}).month);
      d.summary = await aiSummary(d);
      setSetting('summary:' + d.month, d.summary);
      res.json({ summary: d.summary });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
  app.post('/api/report/monthly/email', auth, async (req, res) => {
    if (!smtpReady()) return res.status(400).json({ error: 'Email is not set up on the server yet' });
    const n = await emailMonthly((req.body || {}).month);
    res.json({ sent: n });
  });

  // Demo role switcher.
  app.post('/api/demo-session', (req, res) => {
    if (!DEMO_MODE) return res.status(403).json({ error: 'Demo mode is off' });
    const u = DEMO_USERS[(req.body || {}).role] || DEMO_USERS.admin;
    res.json({ token: sign(u), user: Object.assign({ role_label: ROLE_LABEL[u.role] }, u) });
  });

  seedDemo();
  setInterval(tick, 2 * 60 * 1000);
  setTimeout(tick, 15 * 1000);
}

// Called by the work order routes right after a ticket is saved, so alerts
// go out without waiting for the next tick.
function kick() { setTimeout(tick, 500); }

module.exports = { mount, gate, useParts, announceAssignment, kick, ROLES, ROLE_LABEL, DEMO_USERS, publicUser, notifyPrefs };
