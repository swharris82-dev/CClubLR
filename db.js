const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// On Render, mount a persistent disk at /var/data and set DATA_DIR=/var/data
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'clubhouseiq.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'tech',
  property_id   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS properties (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  city       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per piece of equipment (asset tag), grouped by building. 'apt' holds the asset tag.
CREATE TABLE IF NOT EXISTS units (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id         INTEGER NOT NULL DEFAULT 1,
  apt                 TEXT NOT NULL,
  building            TEXT,
  side                TEXT,
  floor               INTEGER,
  system_type         TEXT DEFAULT 'Other',
  drain_design        TEXT DEFAULT '',
  switch_present      TEXT DEFAULT 'unk',
  switch_functioning  TEXT DEFAULT 'unk',
  switch_notes        TEXT DEFAULT '',
  notes               TEXT DEFAULT '',
  updated_by          TEXT,
  updated_at          TEXT,
  UNIQUE(property_id, apt)
);

-- Equipment registry. Model, serial, warranty.
CREATE TABLE IF NOT EXISTS equipment (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id        INTEGER NOT NULL,
  component      TEXT NOT NULL,
  manufacturer   TEXT DEFAULT '',
  model          TEXT DEFAULT '',
  serial         TEXT DEFAULT '',
  install_date   TEXT DEFAULT '',
  warranty_years INTEGER DEFAULT 0,
  refrigerant    TEXT DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(unit_id) REFERENCES units(id) ON DELETE CASCADE
);

-- Work history. Every visit, diagnosis, and repair.
CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id         INTEGER NOT NULL,
  job_date        TEXT NOT NULL,
  reported        TEXT DEFAULT '',
  category        TEXT DEFAULT 'HVAC',
  priority        TEXT DEFAULT 'normal',
  diagnosis       TEXT DEFAULT '',
  work_performed  TEXT DEFAULT '',
  parts_used      TEXT DEFAULT '',
  triage_json     TEXT,
  vendor_cost_avoided REAL DEFAULT 0,
  cost_basis      TEXT DEFAULT '',
  hours           REAL DEFAULT 0,
  callback_of     INTEGER,
  logged_by       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(unit_id) REFERENCES units(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_unit ON jobs(unit_id);
CREATE INDEX IF NOT EXISTS idx_equip_unit ON equipment(unit_id);
`);

// --- migrations for databases created before a column existed ---
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumnIfMissing('units', 'system_meta', `system_meta TEXT DEFAULT '{}'`);
addColumnIfMissing('jobs', 'error_code', `error_code TEXT DEFAULT ''`);
addColumnIfMissing('units', 'manufacturer', `manufacturer TEXT DEFAULT ''`);
addColumnIfMissing('units', 'ai_brief', `ai_brief TEXT DEFAULT ''`);
addColumnIfMissing('units', 'ai_brief_at', `ai_brief_at TEXT`);
addColumnIfMissing('units', 'ai_brief_stamp', `ai_brief_stamp TEXT DEFAULT ''`);

/* ---------------- work orders and preventive maintenance ---------------- */
db.exec(`
-- A work order is a request or task. It can be tied to a piece of equipment
-- (unit_id) or just a building and location ("Men's locker room, sink 3").
CREATE TABLE IF NOT EXISTS work_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id           INTEGER,
  building          TEXT DEFAULT '',
  location          TEXT DEFAULT '',
  title             TEXT NOT NULL,
  description       TEXT DEFAULT '',
  category          TEXT DEFAULT 'General',
  priority          TEXT DEFAULT 'normal',
  status            TEXT DEFAULT 'open',
  source            TEXT DEFAULT 'tech',
  pm_id             INTEGER,
  requested_by      TEXT DEFAULT '',
  requester_dept    TEXT DEFAULT '',
  requester_contact TEXT DEFAULT '',
  assigned_to       TEXT DEFAULT '',
  due_date          TEXT,
  photo             TEXT,
  track_code        TEXT,
  resolution        TEXT DEFAULT '',
  hours             REAL DEFAULT 0,
  cost_avoided      REAL DEFAULT 0,
  job_id            INTEGER,
  created_by        TEXT DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT,
  completed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_unit ON work_orders(unit_id);
CREATE INDEX IF NOT EXISTS idx_wo_pm ON work_orders(pm_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wo_track ON work_orders(track_code);

CREATE TABLE IF NOT EXISTS wo_notes (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_id  INTEGER NOT NULL,
  kind   TEXT DEFAULT 'note',
  body   TEXT NOT NULL,
  by     TEXT DEFAULT '',
  at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(wo_id) REFERENCES work_orders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_won_wo ON wo_notes(wo_id);

-- Recurring preventive maintenance. When a task comes due, a work order is
-- opened for it automatically. Closing that work order rolls the due date.
CREATE TABLE IF NOT EXISTS pm_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id     INTEGER,
  building    TEXT DEFAULT '',
  title       TEXT NOT NULL,
  checklist   TEXT DEFAULT '',
  category    TEXT DEFAULT 'HVAC',
  freq_days   INTEGER NOT NULL DEFAULT 30,
  lead_days   INTEGER NOT NULL DEFAULT 7,
  next_due    TEXT NOT NULL,
  last_done   TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pm_unit ON pm_tasks(unit_id);
`);
addColumnIfMissing('jobs', 'wo_id', `wo_id INTEGER`);

// Seed a default property so single-property installs just work.
const propCount = db.prepare('SELECT COUNT(*) c FROM properties').get().c;
if (propCount === 0) {
  db.prepare('INSERT INTO properties (id, name, city) VALUES (1, ?, ?)')
    .run(process.env.PROPERTY_NAME || 'Country Club of Little Rock', process.env.PROPERTY_CITY || 'Little Rock, AR');
}

/* ---------------- helpers ---------------- */

// Club assets are named by tag (BLR-1, CT-1, HP-CH-01). Building is set on the
// record, not parsed from the tag.
function parseApt(apt) {
  return { building: null, side: null, floor: null };
}

function getOrCreateUnit(apt, propertyId = 1) {
  const clean = String(apt).trim().toUpperCase();
  let unit = db.prepare('SELECT * FROM units WHERE property_id=? AND apt=?').get(propertyId, clean);
  if (!unit) {
    const p = parseApt(clean);
    const info = db.prepare(`
      INSERT INTO units (property_id, apt, building, side, floor)
      VALUES (?,?,?,?,?)`).run(propertyId, clean, p.building, p.side, p.floor);
    unit = db.prepare('SELECT * FROM units WHERE id=?').get(info.lastInsertRowid);
  }
  return unit;
}

function unitFull(unitId) {
  const unit = db.prepare('SELECT * FROM units WHERE id=?').get(unitId);
  if (!unit) return null;
  try { unit.system_meta = JSON.parse(unit.system_meta || '{}'); }
  catch (e) { unit.system_meta = {}; }
  unit.equipment = db.prepare('SELECT * FROM equipment WHERE unit_id=? ORDER BY component').all(unitId);
  unit.jobs = db.prepare('SELECT * FROM jobs WHERE unit_id=? ORDER BY date(job_date) DESC, id DESC').all(unitId);
  unit.open_wos = db.prepare(`SELECT id, title, priority, status, due_date, source FROM work_orders
    WHERE unit_id=? AND status NOT IN ('done','cancelled') ORDER BY id DESC`).all(unitId);
  unit.pms = db.prepare(`SELECT id, title, freq_days, next_due, last_done FROM pm_tasks
    WHERE unit_id=? AND active=1 ORDER BY date(next_due)`).all(unitId);
  return unit;
}

module.exports = { db, getOrCreateUnit, unitFull, parseApt };
