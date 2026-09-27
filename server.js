const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { db, getOrCreateUnit, unitFull } = require('./db');
const { getProfile, listTypes, requiresErrorCode } = require('./profiles');
const { listManufacturers, getManufacturer } = require('./manufacturers');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false';
const DEMO_MODE = process.env.DEMO_MODE === 'true';

if (DEMO_MODE) {
  console.log('\n  ⚠  DEMO MODE IS ON — anyone with the URL is signed in automatically.');
  console.log('     Never run this way with real property data.\n');
  // Free hosting tiers wipe the disk on restart. Reseed so a demo URL is
  // never empty when someone opens it.
  try {
    const { seed } = require('./seed');
    const r = seed();
    if (r.created) console.log(`  Demo data loaded: ${r.created} unit(s).\n`);
  } catch (e) {
    console.log('  Could not load demo data: ' + e.message);
  }
}

/* ================= AUTH ================= */

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) {
    if (DEMO_MODE) { req.user = { id: 0, email: 'demo@local', name: 'Demo Tech', role: 'manager' }; return next(); }
    return res.status(401).json({ error: 'Not signed in' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    if (DEMO_MODE) { req.user = { id: 0, email: 'demo@local', name: 'Demo Tech', role: 'manager' }; return next(); }
    res.status(401).json({ error: 'Session expired, sign in again' });
  }
}

// Tells the front end whether to show the login screen at all.
app.get('/api/config', (req, res) => {
  res.json({ demo: DEMO_MODE, allowSignup: ALLOW_SIGNUP });
});

// Issues a working session in demo mode so the app can skip the login screen.
app.post('/api/demo-session', (req, res) => {
  if (!DEMO_MODE) return res.status(403).json({ error: 'Demo mode is off' });
  const user = { id: 0, email: 'demo@local', name: 'Demo Tech', role: 'manager' };
  res.json({ token: sign(user), user });
});

app.post('/api/signup', (req, res) => {
  if (!ALLOW_SIGNUP) return res.status(403).json({ error: 'Signups are closed. Ask your manager to create your account.' });
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase());
  if (existing) return res.status(400).json({ error: 'That email already has an account' });

  const isFirst = db.prepare('SELECT COUNT(*) c FROM users').get().c === 0;
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (email,name,password_hash,role,property_id) VALUES (?,?,?,?,1)`)
    .run(email.toLowerCase(), name, hash, isFirst ? 'manager' : 'tech');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  res.json({ token: sign(user), user: { name: user.name, email: user.email, role: user.role } });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email=?').get((email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  res.json({ token: sign(user), user: { name: user.name, email: user.email, role: user.role } });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

/* ================= UNITS ================= */

// System type catalog — drives the Unit Record form and the diagnose tab.
app.get('/api/system-types', auth, (req, res) => {
  const types = listTypes().map(name => {
    const p = getProfile(name);
    return { name, key: p.key, fields: p.fields, firstMove: p.firstMove,
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
    ORDER BY CAST(u.building AS INTEGER), u.side, u.apt
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
  let ctx = `UNIT: ${unit.apt}\n`;
  ctx += `System type: ${unit.system_type || 'unknown'}\n`;
  if (unit.manufacturer) ctx += `Manufacturer: ${unit.manufacturer}\n`;

  // System-specific fields captured for this equipment class
  const meta = unit.system_meta || {};
  const metaLines = (profile.fields || [])
    .filter(f => meta[f.id])
    .map(f => `  ${f.label}: ${meta[f.id]}`);
  if (metaLines.length) ctx += `System details on file:\n${metaLines.join('\n')}\n`;

  if (unit.drain_design) ctx += `Condensate drain design: ${unit.drain_design}\n`;
  ctx += `Float/safety switch present: ${unit.switch_present}; functioning: ${unit.switch_functioning}\n`;
  if (unit.switch_notes) ctx += `Switch notes: ${unit.switch_notes}\n`;
  if (unit.notes) ctx += `Unit notes: ${unit.notes}\n`;

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
            line += `, ${e.warranty_years}yr warranty — ${status} (expires ${exp.toISOString().slice(0,10)})`;
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
    ctx += `\nNo prior service history on file for this unit.\n`;
  }
  return ctx;
}

app.post('/api/triage', auth, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  }
  const { apt, report, error_code } = req.body || {};
  if (!report || !report.trim()) return res.status(400).json({ error: 'Describe the problem first' });

  const unit = apt ? unitFull(getOrCreateUnit(apt).id) : null;
  const systemType = unit ? unit.system_type : null;
  const profile = getProfile(systemType);
  const history = unit ? buildHistoryContext(unit) : 'No unit selected; no history available.';

  // On networked systems, what's happening on neighboring units matters.
  let siblings = '';
  if (unit && profile.key === 'vrf') {
    const others = db.prepare(`
      SELECT u.apt, MAX(j.job_date) last_job, COUNT(j.id) c
      FROM units u LEFT JOIN jobs j ON j.unit_id=u.id
      WHERE u.system_type='VRF / VRV' AND u.building=? AND u.id!=?
      GROUP BY u.id ORDER BY last_job DESC LIMIT 8`).all(unit.building, unit.id);
    if (others.length) {
      siblings = '\nOTHER VRF UNITS IN THIS BUILDING (a fault here may be systemic):\n' +
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

  const prompt = `You are an expert HVAC diagnostic assistant supporting an apartment maintenance technician in the field. You have this specific unit's documented history, equipment type, and manufacturer. Use all of it — repeat offenders, brand-specific weak points, and known design defects should heavily influence your ranking.

=== EQUIPMENT-SPECIFIC DIAGNOSTIC RULES ===
${profile.guidance}
Standard first move on this equipment: ${profile.firstMove}
=== END RULES ===
${mfrBlock}
${history}${siblings}${codeBlock}
TENANT / DISPATCH REPORT:
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
  "systemic_flag": "note if this looks like a system-level or building-level problem rather than a single unit, or omit",
  "warranty_note": "note if a likely-failed component may still be under warranty based on the equipment list, or omit",
  "safety": ["any safety or code concern, or omit if none"],
  "tenant_reply": "2-3 sentence message the tech or office can send the resident"
}

Rank 3-5 causes, highest odds first. Every cause must be plausible for THIS system type and THIS manufacturer — do not offer diagnostics that do not apply to this equipment. If the history shows this is a repeat of a prior failure, say so plainly in history_flags.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1600,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'Diagnostic service error: ' + t.slice(0, 200) });
    }
    const data = await r.json();
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return res.status(502).json({ error: 'Could not read diagnostic response', raw: clean.slice(0, 500) });
    }
    res.json({ triage: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
  const stamp = briefStamp(unit);
  const force = req.query.force === '1';

  if (!force && unit.ai_brief && unit.ai_brief_stamp === stamp) {
    return res.json({ brief: unit.ai_brief, cached: true, at: unit.ai_brief_at });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.json({ brief: '', unavailable: true });
  }

  // Nothing to summarize yet.
  if (!unit.jobs.length && !unit.equipment.length && !unit.drain_design &&
      unit.switch_present === 'unk' && !unit.notes) {
    return res.json({ brief: '', empty: true });
  }

  const profile = getProfile(unit.system_type);
  const mfr = unit.manufacturer ? getManufacturer(unit.manufacturer) : null;
  const ctx = buildHistoryContext(unit);

  const prompt = `You are briefing a maintenance technician who just pulled up this apartment on his phone, standing outside the door. Write what he needs to know before he opens it.

${ctx}
${mfr ? '\nBrand context: ' + mfr.guidance.slice(0, 700) : ''}

Write 2-4 short sentences, plain spoken, no preamble, no bullet points, no headings. Lead with the single most important thing about this unit. Call out repeat failures, known design defects, in-warranty components, and anything that has bitten someone here before. If the unit is clean and unremarkable, say so briefly rather than padding. Do not restate the apartment number. Do not use the words "this unit" more than once.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!r.ok) return res.json({ brief: '', unavailable: true });
    const data = await r.json();
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
    const at = new Date().toISOString();
    db.prepare('UPDATE units SET ai_brief=?, ai_brief_at=?, ai_brief_stamp=? WHERE id=?')
      .run(text, at, stamp, unit.id);
    res.json({ brief: text, cached: false, at });
  } catch (e) {
    res.json({ brief: '', unavailable: true });
  }
});

/* ================= REPORTS ================= */

// Cost avoided rollup — the number you show a regional manager.
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

// Seasonal risk list — units that will flood if nobody acts.
app.get('/api/reports/risk', auth, (req, res) => {
  const switchRisk = db.prepare(`
    SELECT apt, building, switch_present, switch_functioning, drain_design, switch_notes
    FROM units
    WHERE switch_present='no' OR switch_functioning='no'
    ORDER BY CAST(building AS INTEGER), apt`).all();

  const repeatUnits = db.prepare(`
    SELECT u.apt, u.building, COUNT(*) c
    FROM jobs j JOIN units u ON u.id=j.unit_id
    WHERE j.diagnosis LIKE '%condensate%' OR j.diagnosis LIKE '%drain%'
       OR j.diagnosis LIKE '%float%' OR j.reported LIKE '%leak%'
       OR j.reported LIKE '%water%' OR j.reported LIKE '%ceiling%'
    GROUP BY u.apt HAVING c >= 2
    ORDER BY c DESC`).all();

  // Building-level defect patterns
  const byBuilding = db.prepare(`
    SELECT building,
           SUM(CASE WHEN switch_present='no' OR switch_functioning='no' THEN 1 ELSE 0 END) bad_switches,
           COUNT(*) units_logged
    FROM units WHERE building IS NOT NULL
    GROUP BY building HAVING bad_switches > 0
    ORDER BY bad_switches DESC`).all();

  res.json({ switchRisk, repeatUnits, byBuilding });
});

// Warranty watch — parts still covered, and what's expiring soon.
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
  const units = db.prepare('SELECT * FROM units ORDER BY CAST(building AS INTEGER), apt').all();
  const full = units.map(u => unitFull(u.id));
  res.json({ property: db.prepare('SELECT * FROM properties WHERE id=1').get(), units: full });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Unit IQ running on port ' + PORT));
