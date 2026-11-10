const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { db, getOrCreateUnit, unitFull } = require('./db');
const { getProfile, listTypes, requiresErrorCode } = require('./profiles');
const { listManufacturers, getManufacturer } = require('./manufacturers');
const ops = require('./ops');
const ai = require('./ai');

const app = express();
// Data plate photos arrive as base64 in the request body, so this has to be
// larger than the 1mb an all-text API would need.
app.use(express.json({ limit: '12mb' }));

// Language: the app sends X-Lang: es when a user picks Spanish.
const wantsSpanish = req => String(req.get('x-lang') || '').toLowerCase().startsWith('es');
const SPANISH_NOTE = `\n\nLANGUAGE: The technician reading this has the app set to Spanish. Write every piece of human-readable text in clear, plain Latin American Spanish that a maintenance crew would use. Keep JSON keys, enum values (like priority), asset tags, model and serial numbers, fault codes, part numbers, and units exactly as they are. Common trade terms the crew says in English on the job (breaker, contactor, capacitor, chiller) may stay in English in parentheses after the Spanish word.`;
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false';
const DEMO_MODE = process.env.DEMO_MODE === 'true';

if (DEMO_MODE) {
  console.log('\n  DEMO MODE IS ON. Anyone with the URL is signed in automatically.');
  console.log('     Never run this way with real property data.\n');
  // Free hosting tiers wipe the disk on restart. Reseed so a demo URL is
  // never empty when someone opens it.
  try {
    const { seed } = require('./seed');
    const r = seed();
    if (r.created) console.log(`  Demo data loaded: ${r.created} asset(s).\n`);
  } catch (e) {
    console.log('  Could not load demo data: ' + e.message);
  }
}

/* ================= AUTH ================= */

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

// Every signed-in route runs through here. The role comes from the database,
// not the token, so a role change or a deactivated account takes effect
// right away instead of when the 30-day token runs out.
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  let payload = null;
  if (token) { try { payload = jwt.verify(token, JWT_SECRET); } catch (e) { payload = null; } }
  if (!payload) {
    if (DEMO_MODE) payload = ops.DEMO_USERS.admin;
    else return res.status(401).json({ error: token ? 'Session expired, sign in again' : 'Not signed in' });
  }
  if (payload.id <= 0) {
    if (!DEMO_MODE) return res.status(401).json({ error: 'Sign in again' });
    const d = Object.values(ops.DEMO_USERS).find(u => u.id === payload.id) || ops.DEMO_USERS.admin;
    req.user = Object.assign({}, d);
  } else {
    const u = db.prepare('SELECT id, email, name, role, active, dept FROM users WHERE id=?').get(payload.id);
    if (!u) return res.status(401).json({ error: 'Account not found, sign in again' });
    if (!u.active) return res.status(401).json({ error: 'This account is turned off. Ask a manager.' });
    req.user = u;
  }
  const denied = ops.gate(req);
  if (denied) return res.status(403).json({ error: denied });
  next();
}

// Tells the front end whether to show the login screen at all.
app.get('/api/config', (req, res) => {
  const prop = db.prepare('SELECT name, city FROM properties WHERE id=1').get() || {};
  res.json({ demo: DEMO_MODE, allowSignup: ALLOW_SIGNUP, property: prop.name || '', city: prop.city || '', ai: ai.ready(), live: ai.liveReady() });
});


app.post('/api/signup', (req, res) => {
  if (!ALLOW_SIGNUP) return res.status(403).json({ error: 'Signups are closed. Ask your manager to create your account.' });
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase());
  if (existing) return res.status(400).json({ error: 'That email already has an account' });

  // The first account runs the place. Everyone after that signs up as
  // department staff and waits for a manager to turn them on and set a role.
  const isFirst = db.prepare('SELECT COUNT(*) c FROM users').get().c === 0;
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (email,name,password_hash,role,property_id,active) VALUES (?,?,?,?,1,?)`)
    .run(email.toLowerCase(), name, hash, isFirst ? 'admin' : 'staff', isFirst ? 1 : 0);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  if (!isFirst) return res.json({ pending: true, message: 'Account created. A manager needs to approve it before you can sign in.' });
  db.prepare(`UPDATE users SET last_login=datetime('now') WHERE id=?`).run(user.id);
  res.json({ token: sign(user), user: ops.publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email=?').get((email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  if (!user.active) {
    return res.status(403).json({ error: user.last_login ? 'This account is turned off. Ask a manager.' : 'Your account is waiting for a manager to approve it.' });
  }
  db.prepare(`UPDATE users SET last_login=datetime('now') WHERE id=?`).run(user.id);
  res.json({ token: sign(user), user: ops.publicUser(user) });
});

/* ================= ACCOUNTS, PARTS, VENDORS, ALERTS, MONTHLY REPORT ================= */
require('./round2').mount(app, auth);
ops.mount(app, auth, { sign, origin: req => (process.env.PUBLIC_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}` });

/* ================= WORK ORDERS, PM, REQUESTS, DASHBOARD ================= */
require('./workorders')(app, auth);

/* ================= PM: READINGS, ROUNDS, KITS, TRIGGERS, SHUTDOWNS, SCORECARD ================= */
require('./pm2').mount(app, auth);

// Air handling units from the club's AHU sheet. Adds any that are missing,
// never overwrites ones already edited in the app.
try {
  const n = require('./ahus').loadAhus();
  if (n) console.log(`  Added ${n} air handling unit(s) from the AHU sheet.`);
} catch (e) { console.log('  Could not load AHU list: ' + e.message); }

/* ================= BACKUP AND RESTORE ================= */

// One file with everything in it. Used for safekeeping and for moving the
// app to a new host. Admin only.
const fs = require('fs');
const os = require('os');
const { DB_FILE } = require('./db');

app.get('/api/admin/backup', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can download a backup' });
  const tmp = path.join(os.tmpdir(), `ciq-backup-${Date.now()}.db`);
  try {
    await db.backup(tmp);
    res.download(tmp, `clubhouse-iq-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.unlink(tmp, () => {}));
  } catch (e) { res.status(500).json({ error: 'Backup failed: ' + e.message }); }
});

app.post('/api/admin/restore', auth, express.raw({ type: 'application/octet-stream', limit: '300mb' }), (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can restore a backup' });
  if (DEMO_MODE) return res.status(400).json({ error: 'Restore is turned off in demo mode' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 4096 || buf.slice(0, 15).toString() !== 'SQLite format 3') {
    return res.status(400).json({ error: 'That is not a Clubhouse IQ backup file' });
  }
  const incoming = DB_FILE + '.incoming';
  try {
    fs.writeFileSync(incoming, buf);
    const Database = require('better-sqlite3');
    const test = new Database(incoming, { readonly: true });
    const ok = test.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('units','users','jobs')").get().c === 3;
    const users = ok ? test.prepare('SELECT COUNT(*) c FROM users').get().c : 0;
    test.close();
    if (!ok) { fs.unlinkSync(incoming); return res.status(400).json({ error: 'That file is a database, but not a Clubhouse IQ backup' }); }
    if (!users) { fs.unlinkSync(incoming); return res.status(400).json({ error: 'That backup has no accounts in it, so nobody could sign in afterward' }); }
    // Keep the current data beside it, in case the restore was a mistake.
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
    db.close();
    try { fs.copyFileSync(DB_FILE, DB_FILE + '.before-restore'); } catch (e) {}
    ['-wal', '-shm'].forEach(x => { try { fs.unlinkSync(DB_FILE + x); } catch (e) {} });
    fs.renameSync(incoming, DB_FILE);
    res.json({ ok: true });
    console.log('  Database restored from an uploaded backup. Restarting.');
    setTimeout(() => process.exit(0), 800); // the host starts it again on the new data
  } catch (e) {
    try { fs.unlinkSync(incoming); } catch (x) {}
    res.status(500).json({ error: 'Restore failed: ' + e.message });
  }
});

/* ================= UNITS ================= */

// Equipment type catalog. Drives the Record form and the diagnose tab.
app.get('/api/system-types', auth, (req, res) => {
  const types = listTypes().map(name => {
    const p = getProfile(name);
    return { name, key: p.key, fields: p.fields, firstMove: p.firstMove,
             safetyLabel: p.safetyLabel, waterLabel: p.waterLabel, loop: !!p.loop,
             requiresErrorCode: requiresErrorCode(name),
             manufacturers: listManufacturers(p.key) };
  });
  res.json({ types });
});

app.get('/api/units', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM jobs j WHERE j.unit_id=u.id) AS job_count,
      (SELECT MAX(date(job_date)) FROM jobs j WHERE j.unit_id=u.id) AS last_job
    FROM units u
    ORDER BY COALESCE(u.building,'zzz'), u.apt
  `).all();
  res.json({ units: rows });
});

app.get('/api/unit/:apt', auth, (req, res) => {
  const unit = getOrCreateUnit(req.params.apt);
  res.json({ unit: unitFull(unit.id) });
});

app.put('/api/unit/:apt', auth, (req, res) => {
  const unit = getOrCreateUnit(req.params.apt);
  const b = req.body || {};
  db.prepare(`
    UPDATE units SET
      system_type=COALESCE(?,system_type),
      building=COALESCE(?,building),
      manufacturer=COALESCE(?,manufacturer),
      system_meta=COALESCE(?,system_meta),
      drain_design=COALESCE(?,drain_design),
      switch_present=COALESCE(?,switch_present),
      switch_functioning=COALESCE(?,switch_functioning),
      switch_notes=COALESCE(?,switch_notes),
      notes=COALESCE(?,notes),
      updated_by=?, updated_at=datetime('now')
    WHERE id=?`)
    .run(b.system_type,
         b.building === undefined ? null : (String(b.building).trim() || null),
         b.manufacturer,
         b.system_meta ? JSON.stringify(b.system_meta) : null,
         b.drain_design, b.switch_present, b.switch_functioning,
         b.switch_notes, b.notes, req.user.name, unit.id);
  res.json({ unit: unitFull(unit.id) });
});

/* ================= EQUIPMENT ================= */

app.post('/api/unit/:apt/equipment', auth, (req, res) => {
  const unit = getOrCreateUnit(req.params.apt);
  const b = req.body || {};
  if (!b.component) return res.status(400).json({ error: 'Component is required' });
  db.prepare(`
    INSERT INTO equipment (unit_id,component,manufacturer,model,serial,install_date,warranty_years,refrigerant)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(unit.id, b.component, b.manufacturer || '', b.model || '', b.serial || '',
         b.install_date || '', parseInt(b.warranty_years || 0, 10), b.refrigerant || '');
  res.json({ unit: unitFull(unit.id) });
});

app.delete('/api/equipment/:id', auth, (req, res) => {
  const row = db.prepare('SELECT unit_id FROM equipment WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM equipment WHERE id=?').run(req.params.id);
  res.json({ unit: unitFull(row.unit_id) });
});

/* ================= JOBS ================= */

app.post('/api/unit/:apt/job', auth, (req, res) => {
  const unit = getOrCreateUnit(req.params.apt);
  const b = req.body || {};
  db.prepare(`
    INSERT INTO jobs (unit_id,job_date,reported,category,priority,diagnosis,work_performed,
                      parts_used,triage_json,vendor_cost_avoided,cost_basis,hours,logged_by,error_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(unit.id,
         b.job_date || new Date().toISOString().slice(0, 10),
         b.reported || '', b.category || 'HVAC', b.priority || 'normal',
         b.diagnosis || '', b.work_performed || '', b.parts_used || '',
         b.triage_json ? JSON.stringify(b.triage_json) : null,
         parseFloat(b.vendor_cost_avoided || 0), b.cost_basis || '',
         parseFloat(b.hours || 0), req.user.name, b.error_code || '');
  res.json({ unit: unitFull(unit.id) });
});

app.delete('/api/job/:id', auth, (req, res) => {
  const row = db.prepare('SELECT unit_id FROM jobs WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM jobs WHERE id=?').run(req.params.id);
  res.json({ unit: unitFull(row.unit_id) });
});

/* ================= TRIAGE (history-aware) ================= */

function buildHistoryContext(unit) {
  const profile = getProfile(unit.system_type);
  let ctx = `ASSET: ${unit.apt}\n`;
  if (unit.building) ctx += `Building: ${unit.building}\n`;
  ctx += `Equipment type: ${unit.system_type || 'unknown'}\n`;
  if (unit.manufacturer) ctx += `Manufacturer: ${unit.manufacturer}\n`;

  // System-specific fields captured for this equipment class
  const meta = unit.system_meta || {};
  const metaLines = (profile.fields || [])
    .filter(f => meta[f.id])
    .map(f => `  ${f.label}: ${meta[f.id]}`);
  if (metaLines.length) ctx += `System details on file:\n${metaLines.join('\n')}\n`;

  if (unit.drain_design) ctx += `${profile.waterLabel || 'Water side'}: ${unit.drain_design}\n`;
  ctx += `${profile.safetyLabel || 'Safety device'} present: ${unit.switch_present}; functioning: ${unit.switch_functioning}\n`;
  if (unit.switch_notes) ctx += `Safety device notes: ${unit.switch_notes}\n`;
  if (unit.notes) ctx += `Notes: ${unit.notes}\n`;

  if (unit.equipment.length) {
    ctx += `\nEQUIPMENT ON FILE:\n`;
    unit.equipment.forEach(e => {
      const parts = [e.component, e.manufacturer, e.model].filter(Boolean).join(' ');
      let line = `- ${parts}`;
      if (e.serial) line += ` (SN ${e.serial})`;
      if (e.install_date) {
        line += `, installed ${e.install_date}`;
        if (e.warranty_years) {
          const inst = new Date(e.install_date);
          if (!isNaN(inst)) {
            const exp = new Date(inst); exp.setFullYear(exp.getFullYear() + e.warranty_years);
            const status = exp > new Date() ? 'IN WARRANTY' : 'out of warranty';
            line += `, ${e.warranty_years}yr warranty, ${status} (expires ${exp.toISOString().slice(0,10)})`;
          }
        }
      }
      if (e.refrigerant) line += `, refrigerant ${e.refrigerant}`;
      ctx += line + '\n';
    });
  }

  if (unit.jobs.length) {
    ctx += `\nPRIOR SERVICE HISTORY (most recent first, ${unit.jobs.length} total):\n`;
    unit.jobs.slice(0, 12).forEach(j => {
      let line = `- ${j.job_date}: `;
      if (j.error_code) line += `[code ${j.error_code}] `;
      if (j.reported) line += `reported "${j.reported}". `;
      if (j.diagnosis) line += `Diagnosis: ${j.diagnosis}. `;
      if (j.work_performed) line += `Work: ${j.work_performed}.`;
      ctx += line + '\n';
    });
  } else {
    ctx += `\nNo prior service history on file for this asset.\n`;
  }
  return ctx;
}

// The central plant is one system. Anything recent on other plant equipment
// (chiller, tower, pumps, boilers, air handlers, fan coils) goes into the
// diagnosis so the AI can call a plant-wide problem.
function loopContext(unit) {
  if (!unit || !getProfile(unit.system_type).loop) return '';
  const loopTypes = listTypes().filter(t => getProfile(t).loop);
  const ph = loopTypes.map(() => '?').join(',');
  const recent = db.prepare(`
    SELECT u.apt, u.building, u.system_type, j.job_date, j.reported, j.diagnosis, j.error_code
    FROM jobs j JOIN units u ON u.id=j.unit_id
    WHERE u.id != ? AND date(j.job_date) >= date('now','-45 days') AND u.system_type IN (${ph})
    ORDER BY date(j.job_date) DESC LIMIT 15`).all(unit.id, ...loopTypes);
  const badSafety = db.prepare(`
    SELECT apt, building, system_type, switch_notes FROM units
    WHERE id != ? AND system_type IN (${ph}) AND (switch_present='no' OR switch_functioning='no')`).all(unit.id, ...loopTypes);
  if (!recent.length && !badSafety.length) return '\nCENTRAL PLANT: No other plant equipment has logged problems in the last 45 days.\n';
  let out = '\nCENTRAL PLANT STATUS (other equipment on the same chilled water / hot water system, last 45 days):\n';
  recent.forEach(r => {
    out += `- ${r.job_date} ${r.apt} (${r.system_type}${r.building ? ', ' + r.building : ''}): ` +
      (r.error_code ? `[code ${r.error_code}] ` : '') + (r.reported || '') + (r.diagnosis ? `. Dx: ${r.diagnosis}` : '') + '\n';
  });
  badSafety.forEach(b => {
    out += `- OPEN SAFETY ISSUE on ${b.apt} (${b.system_type}): ${b.switch_notes || 'safety device missing or failed'}\n`;
  });
  return out;
}

app.post('/api/triage', auth, async (req, res) => {
  const { apt, report, error_code } = req.body || {};
  if (!report || !report.trim()) return res.status(400).json({ error: 'Describe the problem first' });

  const unit = apt ? unitFull(getOrCreateUnit(apt).id) : null;
  const systemType = unit ? unit.system_type : null;
  const profile = getProfile(systemType);
  const history = unit ? buildHistoryContext(unit) : 'No asset selected; no history available.';

  // On networked systems, what's happening on neighboring equipment matters.
  let siblings = loopContext(unit);
  if (unit && profile.key === 'vrf') {
    const others = db.prepare(`
      SELECT u.apt, MAX(j.job_date) last_job, COUNT(j.id) c
      FROM units u LEFT JOIN jobs j ON j.unit_id=u.id
      WHERE u.system_type='VRF / VRV' AND u.building=? AND u.id!=?
      GROUP BY u.id ORDER BY last_job DESC LIMIT 8`).all(unit.building, unit.id);
    if (others.length) {
      siblings += '\nOTHER VRF UNITS IN THIS BUILDING (a fault here may be systemic):\n' +
        others.map(o => `- ${o.apt}: ${o.c} job(s)` + (o.last_job ? `, last ${o.last_job}` : '')).join('\n') + '\n';
    }
  }

  const codeBlock = error_code && error_code.trim()
    ? `\nFAULT CODE REPORTED BY THE EQUIPMENT: ${error_code.trim()}\nInterpret this code for the specific system type and manufacturer above and let it drive your ranking.\n`
    : (requiresErrorCode(systemType)
      ? `\nNO FAULT CODE WAS PROVIDED. This equipment self-reports faults. Your FIRST cause or check must be retrieving the code, and you should state plainly that ranking is low-confidence without it.\n`
      : '');

  const mfr = unit && unit.manufacturer ? getManufacturer(unit.manufacturer) : null;
  const mfrBlock = mfr
    ? `\n=== MANUFACTURER-SPECIFIC RULES (${unit.manufacturer}) ===\nWhere codes are read: ${mfr.codes}\n${mfr.guidance}\n=== END MANUFACTURER RULES ===\n`
    : '';

  const prompt = `You are an expert facilities and HVAC diagnostic assistant supporting the on-site maintenance technician at the Country Club of Little Rock, a private club founded in 1902 with older buildings, a central plant (water-cooled chiller, cooling tower, PHX-1 free cooling heat exchanger, boilers, and pumps) feeding chilled water and hot water to multizone air handlers and fan coil units, commercial kitchens with walk-ins, a pool, and indoor tennis. Most clubhouse air handlers date to 1968. An Alerton BAS runs the plant. You have this asset's documented history, equipment type, manufacturer, and the status of the rest of the plant. Use all of it. Repeat failures, brand-specific weak points, plant-wide problems, and known defects should heavily influence your ranking. Write in plain language and never use em dashes.

=== EQUIPMENT-SPECIFIC DIAGNOSTIC RULES ===
${profile.guidance}
Standard first move on this equipment: ${profile.firstMove}
=== END RULES ===
${mfrBlock}
${history}${siblings}${codeBlock}
REPORT FROM STAFF, MEMBER, OR DISPATCH:
"${report}"

Respond with ONLY a JSON object, no preamble and no markdown fences, in this exact shape:
{
  "priority": "emergency" | "same-day" | "normal" | "low",
  "priority_reason": "one short sentence",
  "first_move": "the single thing to do first on this equipment, one sentence",
  "code_meaning": "what the supplied fault code means on this brand, or omit if no code was given",
  "causes": [
    {"cause":"short name","odds":"percentage like 45%","why":"one sentence, cite unit history, the fault code, or a known brand weak point explicitly when relevant","check":"the specific test or measurement to confirm"}
  ],
  "truck_list": ["part or tool", "..."],
  "history_flags": ["short note about a pattern in this unit's history, or omit if none"],
  "systemic_flag": "note if this looks like a central plant, BAS, or building-level problem rather than this one piece of equipment, or omit",
  "warranty_note": "note if a likely-failed component may still be under warranty based on the equipment list, or omit",
  "safety": ["any safety or code concern, or omit if none"],
  "tenant_reply": "2-3 sentence plain message the tech can send the department head or staff member who reported it (kitchen, tennis, pool, front desk), saying what is happening and when it will be handled"
}

Rank 3-5 causes, highest odds first. Every cause must be plausible for THIS equipment type and THIS manufacturer. Do not offer diagnostics that do not apply to this equipment. If the history shows this is a repeat of a prior failure, say so plainly in history_flags. If the central plant status shows other plant equipment failing, weigh a plant-wide cause heavily and say so in systemic_flag.` + (wantsSpanish(req) ? SPANISH_NOTE : '');

  try {
    const parsed = await ai.askJson({ prompt, maxTokens: 4000 });
    if (!Array.isArray(parsed.causes)) parsed.causes = [];
    res.json({ triage: parsed });
  } catch (e) {
    res.status(e.kind === 'nokey' ? 503 : 502).json({ error: e.message });
  }
});

/* ================= AI STATUS ================= */

// Runs a real test call against each AI service so a manager can see why
// diagnosis is or is not working, in plain words.
app.get('/api/ai/status', auth, async (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.json({ ready: ai.ready(), live: ai.liveReady() });
  }
  try { res.json(await ai.status()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ================= LIVE VIDEO DIAGNOSIS ================= */

// The tech points the phone at the equipment and talks. Video and voice go
// straight from the phone to Gemini Live. This route hands the phone a
// single-use pass and the instructions for the session, built from the
// equipment record the same way the written diagnosis is.
function liveInstructions(unit, spanish, userName) {
  const profile = getProfile(unit ? unit.system_type : null);
  const mfr = unit && unit.manufacturer ? getManufacturer(unit.manufacturer) : null;
  let t = `You are a senior facilities and HVAC technician on a live video call with ${userName || 'the on-site technician'} at the Country Club of Little Rock. You can see through the phone camera and hear the tech. The club has a central plant (water-cooled chiller, cooling tower, PHX-1 free cooling heat exchanger, boilers, pumps) feeding chilled and hot water to multizone air handlers and fan coils, commercial kitchens with walk-ins, a pool, and indoor tennis. Most clubhouse air handlers date to 1968. An Alerton BAS runs the plant.

How to run the call:
- Talk like a coworker standing next to him. Short sentences. One step at a time, then wait for what he sees or measures.
- Say what you actually see in the video: nameplates, gauges, wiring, burn marks, ice, leaks, fault lights, display codes. If you cannot see something clearly, ask him to move closer, hold steady, or add light. Never pretend to read something you cannot read.
- Ask for the fault code or reading before guessing on equipment that reports its own faults.
- Work cheapest and most likely checks first. Give the expected reading with every measurement you ask for.
- Safety comes first. Before any step near live voltage, rotating parts, gas, steam, hot water, refrigerant, or confined spaces, say the hazard and the lockout or PPE step in one sentence. If something looks unsafe, say stop.
- If the problem looks like the central plant or the BAS rather than this one piece of equipment, say so.
- When the cause is found, finish with: the cause, what fixed it or what part is needed, and anything to log.
- Never use em dashes.`;
  if (unit) {
    t += `\n\n=== EQUIPMENT ON THIS CALL ===\n${buildHistoryContext(unit)}${loopContext(unit)}`;
    t += `\n=== RULES FOR THIS EQUIPMENT TYPE ===\n${profile.guidance}\nStandard first move: ${profile.firstMove}`;
    if (mfr) t += `\n=== ${unit.manufacturer} ===\nWhere codes are read: ${mfr.codes}\n${mfr.guidance}`;
  } else {
    t += `\n\nNo equipment record is open. Start by asking what he is looking at and have him show you the data plate.`;
  }
  if (spanish) t += `\n\nSpeak in clear, plain Latin American Spanish that a maintenance crew would use. Trade terms the crew says in English (breaker, contactor, capacitor, chiller) can stay in English.`;
  return t.slice(0, 24000);
}

app.post('/api/live/token', auth, async (req, res) => {
  if (!['admin', 'manager', 'tech'].includes(req.user.role)) return res.status(403).json({ error: 'Live diagnosis is for maintenance staff' });
  const { apt, note } = req.body || {};
  try {
    const unit = apt ? unitFull(getOrCreateUnit(apt).id) : null;
    let systemText = liveInstructions(unit, wantsSpanish(req), req.user.name);
    if (note && String(note).trim()) systemText += `\n\nWhat was reported before the call: "${String(note).trim().slice(0, 600)}"`;
    const pass = await ai.liveToken({ systemText, spanish: wantsSpanish(req) });
    res.json(Object.assign(pass, { apt: unit ? unit.apt : null }));
  } catch (e) {
    res.status(e.kind === 'nokey' ? 503 : 502).json({ error: e.message });
  }
});

// Turns the call transcript into a draft history entry the tech can edit.
app.post('/api/live/summary', auth, async (req, res) => {
  const { transcript, apt } = req.body || {};
  const lines = Array.isArray(transcript) ? transcript : [];
  const text = lines.map(l => `${l.who === 'tech' ? 'TECH' : 'AI'}: ${String(l.text || '').trim()}`).filter(l => l.length > 6).join('\n').slice(-14000);
  if (text.length < 40) return res.status(400).json({ error: 'There was not enough conversation to summarize.' });
  const prompt = `Below is the transcript of a live video diagnosis call between a maintenance technician and an AI assistant at the Country Club of Little Rock${apt ? `, about equipment ${apt}` : ''}. The tech's lines came from speech recognition and may have small errors.

${text}

Write a service history entry from it. Only use what was actually said. Do not invent readings or repairs. Never use em dashes. Respond with ONLY a JSON object:
{
  "reported": "the problem as it was first described, one sentence",
  "diagnosis": "the cause that was found, or the most likely cause if it was not confirmed, one sentence",
  "work_performed": "what the tech actually did or measured during the call, 1 to 3 sentences, or empty if nothing was done yet",
  "error_code": "any fault code that was read, or empty",
  "parts": "parts named as needed, or empty",
  "follow_up": "anything left to do, or empty",
  "priority": "emergency" | "same-day" | "normal" | "low"
}` + (wantsSpanish(req) ? SPANISH_NOTE : '');
  try { res.json({ summary: await ai.askJson({ prompt, maxTokens: 2000 }) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

/* ================= DATA PLATE READER ================= */

// Reads a photo of an equipment data plate and returns the fields that belong
// on an equipment registry line. Everything it returns is a suggestion the tech
// checks against the plate before saving. It never invents a value it cannot read.
app.post('/api/plate-read', auth, async (req, res) => {
  const { image, media_type, system_type, manufacturer } = req.body || {};
  if (!image) return res.status(400).json({ error: 'No photo came through. Try again.' });

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const mt = allowed.includes(media_type) ? media_type : 'image/jpeg';

  const context = [
    system_type ? `The tech says this plate is on a ${system_type}.` : '',
    manufacturer ? `The equipment record lists the manufacturer as ${manufacturer}.` : ''
  ].filter(Boolean).join(' ');

  const prompt = `You are reading the data plate on a piece of commercial HVAC, refrigeration, boiler, kitchen, or pool equipment at a country club. ${context}

Read ONLY what is printed on the plate. Never guess a value that is not legible. If a field is missing or you cannot read it with confidence, return an empty string for it and name it in "unreadable".

Return ONLY a JSON object, with no markdown fence:
{
  "component": "what this equipment is, in 1 to 3 words, the way a tech would name it on a registry line. Examples: Boiler, Condensing unit, Air handler, Cooling tower, Circulator pump, Compressor, Ice machine",
  "manufacturer": "brand as printed, or empty",
  "model": "model number exactly as printed, or empty",
  "serial": "serial number exactly as printed, or empty",
  "refrigerant": "refrigerant type such as R-410A or R-448A, or empty if this unit carries no refrigerant",
  "date": "YYYY-MM-DD if a date is printed or can be decoded from the serial, else YYYY-MM, else YYYY, else empty",
  "date_kind": "manufactured, installed, or unknown",
  "date_basis": "short note on where the date came from, such as 'printed MFG date' or 'decoded from serial', or empty",
  "electrical": "voltage, phase, MCA and MOCP as printed, on one line, or empty",
  "capacity": "tonnage, MBH, GPM, HP or similar capacity as printed, or empty",
  "unreadable": ["names of the fields you could not read"],
  "confidence": "high, medium, or low, for the reading overall"
}

Transcribe the serial number character by character. Do not normalize it, do not drop leading zeros, and do not correct what looks like a typo. Where a character is ambiguous between 0 and O, or 1 and I, use the most likely character and add "serial" to "unreadable" so the tech re-checks it.`;

  try {
    const parsed = await ai.askJson({ prompt, image, mediaType: mt, maxTokens: 2000 });
    res.json({ plate: parsed });
  } catch (e) {
    res.status(e.kind === 'nokey' ? 503 : 502).json({ error: e.message });
  }
});

/* ================= AI UNIT BRIEF ================= */

// A fingerprint of everything that should invalidate the cached brief.
function briefStamp(unit) {
  const bits = [
    unit.system_type, unit.manufacturer, unit.drain_design,
    unit.switch_present, unit.switch_functioning, unit.switch_notes, unit.notes,
    JSON.stringify(unit.system_meta || {}),
    unit.equipment.map(e => e.id + ':' + e.component + e.model + e.install_date + e.warranty_years).join('|'),
    unit.jobs.map(j => j.id + ':' + j.job_date + j.diagnosis + j.error_code).join('|')
  ].join('~');
  let h = 0;
  for (let i = 0; i < bits.length; i++) { h = ((h << 5) - h + bits.charCodeAt(i)) | 0; }
  return String(h);
}

app.get('/api/unit/:apt/brief', auth, async (req, res) => {
  const unit = unitFull(getOrCreateUnit(req.params.apt).id);
  const stamp = briefStamp(unit) + (wantsSpanish(req) ? ':es' : '');
  const force = req.query.force === '1';

  if (!force && unit.ai_brief && unit.ai_brief_stamp === stamp) {
    return res.json({ brief: unit.ai_brief, cached: true, at: unit.ai_brief_at });
  }
  if (!ai.ready()) {
    return res.json({ brief: '', unavailable: true });
  }

  // Nothing to summarize yet.
  if (!unit.jobs.length && !unit.equipment.length && !unit.drain_design &&
      unit.switch_present === 'unk' && !unit.notes) {
    return res.json({ brief: '', empty: true });
  }

  const profile = getProfile(unit.system_type);
  const mfr = unit.manufacturer ? getManufacturer(unit.manufacturer) : null;
  const ctx = buildHistoryContext(unit) + loopContext(unit);

  const prompt = `You are briefing the maintenance technician at the Country Club of Little Rock who just pulled up this piece of equipment on his phone, standing in front of it. Write what he needs to know before he starts.

${ctx}
${mfr ? '\nBrand context: ' + mfr.guidance.slice(0, 700) : ''}

Write 2-4 short sentences, plain spoken, no preamble, no bullet points, no headings, no em dashes. Lead with the single most important thing about this equipment. Call out repeat failures, open safety device problems, in-warranty components, inspection or certificate dates, anything happening on the central plant that affects it, and anything that has bitten someone here before. If it is clean and unremarkable, say so briefly rather than padding. Do not restate the asset tag.` + (wantsSpanish(req) ? SPANISH_NOTE : '');

  try {
    const text = (await ai.ask({ prompt, maxTokens: 1200 })).replace(/\s+/g, ' ').trim();
    const at = new Date().toISOString();
    db.prepare('UPDATE units SET ai_brief=?, ai_brief_at=?, ai_brief_stamp=? WHERE id=?')
      .run(text, at, stamp, unit.id);
    res.json({ brief: text, cached: false, at });
  } catch (e) {
    res.json({ brief: '', unavailable: true });
  }
});

/* ================= REPORTS ================= */

// Cost avoided rollup. The number you show the GM.
app.get('/api/reports/cost-avoided', auth, (req, res) => {
  const since = req.query.since || '1900-01-01';
  const total = db.prepare(`
    SELECT COALESCE(SUM(vendor_cost_avoided),0) total,
           COUNT(*) jobs,
           COALESCE(SUM(hours),0) hours
    FROM jobs WHERE date(job_date) >= date(?)`).get(since);
  const byMonth = db.prepare(`
    SELECT substr(job_date,1,7) month,
           COALESCE(SUM(vendor_cost_avoided),0) total,
           COUNT(*) jobs
    FROM jobs WHERE date(job_date) >= date(?)
    GROUP BY month ORDER BY month DESC LIMIT 24`).all(since);
  const topUnits = db.prepare(`
    SELECT u.apt, COALESCE(SUM(j.vendor_cost_avoided),0) total, COUNT(*) jobs
    FROM jobs j JOIN units u ON u.id=j.unit_id
    WHERE date(j.job_date) >= date(?)
    GROUP BY u.apt ORDER BY total DESC LIMIT 15`).all(since);
  res.json({ total, byMonth, topUnits });
});

// Risk list: safety devices out, repeat problems, loop activity.
app.get('/api/reports/risk', auth, (req, res) => {
  const switchRisk = db.prepare(`
    SELECT apt, building, system_type, switch_present, switch_functioning, drain_design, switch_notes
    FROM units
    WHERE switch_present='no' OR switch_functioning='no'
    ORDER BY building, apt`).all()
    .map(u => Object.assign(u, { safety_label: getProfile(u.system_type).safetyLabel || 'Safety device' }));

  // Equipment that keeps coming back: 2+ jobs in the last 12 months.
  const repeatUnits = db.prepare(`
    SELECT u.apt, u.building, u.system_type, COUNT(*) c
    FROM jobs j JOIN units u ON u.id=j.unit_id
    WHERE date(j.job_date) >= date('now','-365 days')
    GROUP BY u.id HAVING c >= 2
    ORDER BY c DESC`).all();

  // Central plant activity, last 45 days.
  const loopTypes = listTypes().filter(t => getProfile(t).loop);
  const loopEvents = db.prepare(`
    SELECT u.apt, u.building, u.system_type, j.job_date, j.reported, j.error_code
    FROM jobs j JOIN units u ON u.id=j.unit_id
    WHERE date(j.job_date) >= date('now','-45 days') AND u.system_type IN (${loopTypes.map(() => '?').join(',')})
    ORDER BY date(j.job_date) DESC LIMIT 20`).all(...loopTypes);

  // Work and problems by building
  const byBuilding = db.prepare(`
    SELECT u.building,
           COUNT(DISTINCT u.id) units_logged,
           SUM(CASE WHEN u.switch_present='no' OR u.switch_functioning='no' THEN 1 ELSE 0 END) bad_switches,
           (SELECT COUNT(*) FROM jobs j JOIN units x ON x.id=j.unit_id WHERE x.building=u.building) jobs
    FROM units u WHERE u.building IS NOT NULL
    GROUP BY u.building
    ORDER BY jobs DESC`).all();

  res.json({ switchRisk, repeatUnits, byBuilding, loopEvents });
});

// Warranty watch: parts still covered, and what is expiring soon.
app.get('/api/reports/warranty', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, u.apt FROM equipment e JOIN units u ON u.id=e.unit_id
    WHERE e.install_date != '' AND e.warranty_years > 0`).all();
  const now = new Date();
  const out = rows.map(e => {
    const inst = new Date(e.install_date);
    if (isNaN(inst)) return null;
    const exp = new Date(inst);
    exp.setFullYear(exp.getFullYear() + e.warranty_years);
    const days = Math.round((exp - now) / 86400000);
    return { apt: e.apt, component: e.component, manufacturer: e.manufacturer,
             model: e.model, expires: exp.toISOString().slice(0, 10),
             days_left: days, in_warranty: days > 0 };
  }).filter(Boolean).sort((a, b) => a.days_left - b.days_left);
  res.json({ equipment: out });
});

app.get('/api/export', auth, (req, res) => {
  const units = db.prepare("SELECT * FROM units ORDER BY COALESCE(building,'zzz'), apt").all();
  const full = units.map(u => unitFull(u.id));
  res.json({ property: db.prepare('SELECT * FROM properties WHERE id=1').get(), units: full });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Clubhouse IQ running on port ' + PORT));
