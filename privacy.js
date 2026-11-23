/**
 * Account deletion requests (needed for the Google Play listing).
 *
 * Two ways in:
 *   - Public web form at /delete-account.html  -> POST /api/account-deletion
 *   - Signed-in users, My account sheet         -> POST /api/me/delete-request
 *
 * Requests show on the admin dashboard alert list and in the admin's
 * My account sheet. "Delete account" there wipes the person's name, email,
 * phone and sign-in, and closes the request. The privacy policy is the static page /privacy.html.
 *
 * Mounted from server.js:  require('./privacy').mount(app, auth)
 */
const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS deletion_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  name        TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  user_id     INTEGER,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  done_at     TEXT,
  done_by     TEXT
);
`);

// Light rate limit for the public form: 5 per address per hour.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 5;
}
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function open() {
  return db.prepare('SELECT * FROM deletion_requests WHERE done_at IS NULL ORDER BY created_at').all();
}

function mount(app, auth) {
  app.post('/api/account-deletion', (req, res) => {
    if (limited(req.ip)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    const b = req.body || {};
    const email = clean(b.email, 160).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter the email you sign in with.' });
    const u = db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email);
    // Same answer whether or not the account exists, so the form can't be used to check emails.
    if (u && !db.prepare('SELECT id FROM deletion_requests WHERE user_id=? AND done_at IS NULL').get(u.id)) {
      db.prepare('INSERT INTO deletion_requests (email, name, note, user_id, source) VALUES (?,?,?,?,?)')
        .run(email, clean(b.name, 120), clean(b.note, 1000), u.id, 'web');
    }
    res.json({ ok: true });
  });

  app.post('/api/me/delete-request', auth, (req, res) => {
    const u = db.prepare('SELECT id, email, name FROM users WHERE id=?').get(req.user.id);
    if (!u) return res.status(404).json({ error: 'Account not found' });
    if (!db.prepare('SELECT id FROM deletion_requests WHERE user_id=? AND done_at IS NULL').get(u.id)) {
      db.prepare('INSERT INTO deletion_requests (email, name, note, user_id, source) VALUES (?,?,?,?,?)')
        .run(u.email, u.name, clean((req.body || {}).note, 1000), u.id, 'app');
    }
    res.json({ ok: true });
  });

  app.get('/api/account-deletions', auth, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    res.json({ requests: open() });
  });

  // Delete the person's account details, then close the request. Work records they
  // made stay with the club (they point at the now-anonymous account).
  app.post('/api/account-deletions/:id/done', auth, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    const r = db.prepare('SELECT * FROM deletion_requests WHERE id=? AND done_at IS NULL').get(req.params.id);
    if (!r) return res.json({ requests: open() });
    const u = r.user_id ? db.prepare('SELECT * FROM users WHERE id=?').get(r.user_id) : null;
    if (u) {
      if (u.id === req.user.id) return res.status(400).json({ error: 'You can\'t delete your own account here. Have another admin do it.' });
      if (u.role === 'admin' && db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1 AND id != ?`).get(u.id).c === 0)
        return res.status(400).json({ error: 'This is the last admin. Make someone else an admin first.' });
      db.prepare(`UPDATE users SET name=?, email=?, phone='', dept='', notify=NULL, password_hash=?, active=0, must_change=0 WHERE id=?`)
        .run('Deleted user #' + u.id, 'deleted-' + u.id + '@deleted.invalid', 'x' + crypto.randomBytes(24).toString('hex'), u.id);
    }
    db.transaction(() => {
      db.prepare(`UPDATE deletion_requests SET done_at=datetime('now'), done_by=? WHERE id=?`).run(req.user.name, r.id);
      // The request itself held their email and name; keep only that it happened.
      db.prepare(`UPDATE deletion_requests SET email='(deleted)', name='', note='' WHERE user_id=?`).run(r.user_id || -1);
    })();
    res.json({ requests: open() });
  });
}

function alerts(user) {
  if (!user || user.role !== 'admin') return [];
  try {
    return open().map(r => ({
      level: 'warn', kind: 'account', title: 'Account deletion request: ' + (r.name || r.email),
      detail: r.email + ' asked to have their account and data deleted. Delete it under My account.',
      go: { tab: 'team' }
    }));
  } catch (e) { return []; }
}

module.exports = { mount, alerts };
