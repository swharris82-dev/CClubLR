/**
 * Native app support: push notifications, the home screen widget summary,
 * and the files that let NFC/QR tag links open the installed app.
 *
 * Push
 *   Android: Firebase Cloud Messaging HTTP v1.
 *     env FIREBASE_SERVICE_ACCOUNT  = the service account JSON (one line) from
 *                                     Firebase console > Project settings > Service accounts
 *   iPhone: Apple Push Notification service, token auth.
 *     env APNS_KEY       = contents of the .p8 key (newlines may be written as \n)
 *     env APNS_KEY_ID    = the key's 10-character ID
 *     env APPLE_TEAM_ID  = your Apple developer Team ID
 *     env APNS_BUNDLE_ID = org.cclr.clubhouseiq (default)
 *     env APNS_SANDBOX   = true for development builds run from Xcode
 *   Pushes go out for plant alarms, emergencies, new staff requests, and work
 *   assigned to you. Missing settings just mean that platform gets no pushes.
 *
 * App links
 *   /.well-known/assetlinks.json            env ANDROID_CERT_SHA256 (comma list,
 *                                           Play App Signing + upload key fingerprints)
 *   /.well-known/apple-app-site-association uses APPLE_TEAM_ID + APNS_BUNDLE_ID
 *   Tag links look like https://<host>/?u=AHU-2 (the same link the QR tags use).
 *
 * Mounted from server.js:  require('./native').mount(app, auth)
 */
const http2 = require('http2');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const BUNDLE = () => process.env.APNS_BUNDLE_ID || 'org.cclr.clubhouseiq';
const ANDROID_PKG = 'org.cclr.clubhouseiq';
const WORK_ROLES = ['admin', 'manager', 'tech'];

db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  platform    TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  app_version TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
`);

/* ---------------- Firebase (Android) ---------------- */
let fcmSa = null, fcmTok = null, fcmExp = 0;
function fcmAccount() {
  if (fcmSa !== null) return fcmSa;
  try { fcmSa = process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : false; }
  catch (e) { console.error('[push] FIREBASE_SERVICE_ACCOUNT is not valid JSON'); fcmSa = false; }
  return fcmSa;
}
async function fcmAccess() {
  const sa = fcmAccount();
  if (!sa) return null;
  if (fcmTok && Date.now() < fcmExp) return fcmTok;
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }, sa.private_key, { algorithm: 'RS256' });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + assertion });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('Firebase sign-in failed: ' + (d.error_description || d.error || r.status));
  fcmTok = d.access_token; fcmExp = Date.now() + 50 * 60e3;
  return fcmTok;
}
async function sendFcm(token, m) {
  const sa = fcmAccount(), access = await fcmAccess();
  if (!access) return 'off';
  const body = { message: { token,
    notification: { title: m.title, body: m.body },
    data: { url: m.url || '/', kind: m.kind || '' },
    android: { priority: m.urgent ? 'HIGH' : 'NORMAL',
      notification: { channel_id: m.urgent ? 'alarms' : 'work', tag: m.tag || undefined, sound: 'default' } } } };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, { method: 'POST',
    headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.ok) return 'ok';
  const d = await r.json().catch(() => ({}));
  const code = d.error && d.error.details && d.error.details.map(x => x.errorCode).filter(Boolean)[0];
  if (r.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') return 'gone';
  throw new Error('Firebase ' + r.status + ' ' + (d.error && d.error.message || ''));
}

/* ---------------- Apple (iPhone) ---------------- */
let apnsJwt = null, apnsJwtAt = 0, apnsSession = null;
function apnsReady() { return !!(process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APPLE_TEAM_ID); }
function apnsToken() {
  if (apnsJwt && Date.now() - apnsJwtAt < 40 * 60e3) return apnsJwt;
  const key = process.env.APNS_KEY.replace(/\\n/g, '\n');
  apnsJwt = jwt.sign({ iss: process.env.APPLE_TEAM_ID, iat: Math.floor(Date.now() / 1000) }, key,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: process.env.APNS_KEY_ID } });
  apnsJwtAt = Date.now();
  return apnsJwt;
}
function apnsConn() {
  if (apnsSession && !apnsSession.closed && !apnsSession.destroyed) return apnsSession;
  const host = /^(1|true|yes)$/i.test(process.env.APNS_SANDBOX || '') ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  apnsSession = http2.connect(host);
  apnsSession.on('error', () => { apnsSession = null; });
  apnsSession.setTimeout(10 * 60e3, () => { try { apnsSession.close(); } catch (e) {} apnsSession = null; });
  return apnsSession;
}
function sendApns(token, m) {
  if (!apnsReady()) return Promise.resolve('off');
  const payload = JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: 'default',
    'interruption-level': m.urgent ? 'time-sensitive' : 'active', 'thread-id': m.kind || 'work' }, url: m.url || '/' });
  return new Promise((resolve, reject) => {
    let status = 0, data = '';
    const req = apnsConn().request({ ':method': 'POST', ':path': '/3/device/' + token,
      authorization: 'bearer ' + apnsToken(), 'apns-topic': BUNDLE(), 'apns-push-type': 'alert',
      'apns-priority': m.urgent ? '10' : '5', ...(m.tag ? { 'apns-collapse-id': String(m.tag).slice(0, 60) } : {}) });
    req.setTimeout(15000, () => { req.close(); reject(new Error('Apple push timed out')); });
    req.on('response', h => { status = h[':status']; });
    req.on('data', c => { data += c; });
    req.on('end', () => {
      if (status === 200) return resolve('ok');
      let reason = ''; try { reason = JSON.parse(data).reason; } catch (e) {}
      if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') return resolve('gone');
      reject(new Error('Apple ' + status + ' ' + reason));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

/* ---------------- sending ---------------- */
async function sendToDevices(devs, m) {
  let sent = 0;
  for (const d of devs) {
    try {
      const r = d.platform === 'ios' ? await sendApns(d.token, m) : await sendFcm(d.token, m);
      if (r === 'ok') sent++;
      if (r === 'gone') db.prepare('DELETE FROM devices WHERE id=?').run(d.id);
    } catch (e) { console.error('[push]', e.message); }
  }
  return sent;
}
function devicesFor(where, args) {
  return db.prepare(`SELECT d.* FROM devices d JOIN users u ON u.id=d.user_id WHERE u.active=1 AND ${where}`).all(...args);
}
/** Push to everyone with one of these roles. Never throws. */
function pushRoles(roles, m) {
  const devs = devicesFor(`u.role IN (${roles.map(() => '?').join(',')})`, roles);
  if (devs.length) sendToDevices(devs, m).catch(() => {});
}
function pushUserName(name, m) {
  const devs = devicesFor('u.name=?', [name]);
  if (devs.length) sendToDevices(devs, m).catch(() => {});
}

/* Hooks called from other modules. */
function plantAlarm(a) {
  pushRoles(WORK_ROLES, { title: (a.level === 'critical' ? 'Plant alarm: ' : 'Plant warning: ') + a.title,
    body: a.detail || '', url: '/?tab=plant', kind: 'plant', tag: 'plant-' + a.rule, urgent: a.level === 'critical' });
}
function workOrder(w) {
  const em = w.priority === 'emergency';
  const where = [w.building, w.location].filter(Boolean).join(' · ');
  pushRoles(em ? WORK_ROLES : ['admin', 'tech'], { title: (em ? 'EMERGENCY #' : 'New request #') + w.id + ': ' + w.title,
    body: where || (w.description || ''), url: '/?wo=' + w.id, kind: em ? 'emergency' : 'request', tag: 'wo-' + w.id, urgent: em });
}
function assigned(w, name) {
  pushUserName(name, { title: 'Assigned to you: #' + w.id + ' ' + w.title,
    body: [w.building, w.location].filter(Boolean).join(' · '), url: '/?wo=' + w.id, kind: 'assigned', tag: 'wo-' + w.id });
}

/* ---------------- widget summary ---------------- */
function widgetSummary() {
  const OPEN = `('new','open','in_progress','on_hold')`;
  const w = db.prepare(`SELECT
      SUM(CASE WHEN status IN ${OPEN} AND source!='pm' THEN 1 ELSE 0 END) open,
      SUM(CASE WHEN status IN ${OPEN} AND priority='emergency' THEN 1 ELSE 0 END) emergency,
      SUM(CASE WHEN status IN ${OPEN} AND priority='high' THEN 1 ELSE 0 END) high,
      SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) new_requests
    FROM work_orders`).get();
  let pmDue = 0;
  try { pmDue = db.prepare(`SELECT COUNT(*) c FROM pm_tasks WHERE active=1 AND date(next_due) <= date('now','localtime')`).get().c; } catch (e) {}
  let plant = null;
  try {
    const v = {};
    db.prepare(`SELECT r.key, r.value, r.text, r.ts FROM plant_readings r JOIN (SELECT key, MAX(ts) ts FROM plant_readings GROUP BY key) m
                ON m.key=r.key AND m.ts=r.ts`).all().forEach(r => { v[r.key] = r; });
    const last = Object.values(v).reduce((m, r) => r.ts > m ? r.ts : m, '');
    const alarms = db.prepare('SELECT level, title FROM plant_alarms WHERE cleared_at IS NULL').all();
    plant = { live: !!last && Date.now() - Date.parse(last) < 10 * 60e3, last_ts: last || null,
      chiller: v.fault_text && v.fault_text.text ? 'TRIPPED' : v.comp_running ? (v.comp_running.value === 1 ? 'RUNNING' : 'OFF') : null,
      chws: v.chws ? v.chws.value : null, walkin: v.walkin_temp ? v.walkin_temp.value : null,
      alarms: alarms.length, critical: alarms.filter(a => a.level === 'critical').length, top: alarms[0] ? alarms[0].title : '' };
  } catch (e) {}
  return { at: new Date().toISOString(), open: w.open || 0, emergency: w.emergency || 0, high: w.high || 0,
    new_requests: w.new_requests || 0, pm_due: pmDue, plant };
}

/* ---------------- routes ---------------- */
function mount(app, auth) {
  app.post('/api/devices', auth, (req, res) => {
    const b = req.body || {}, platform = b.platform === 'ios' ? 'ios' : b.platform === 'android' ? 'android' : '';
    const token = String(b.token || '').trim();
    if (!platform || token.length < 20 || token.length > 512) return res.status(400).json({ error: 'Bad device' });
    if (req.user.id < 0) return res.json({ ok: true, demo: true });
    db.prepare(`INSERT INTO devices (user_id, platform, token, app_version) VALUES (?,?,?,?)
                ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, platform=excluded.platform,
                app_version=excluded.app_version, last_seen=datetime('now')`)
      .run(req.user.id, platform, token, String(b.app_version || '').slice(0, 40));
    res.json({ ok: true });
  });
  app.delete('/api/devices', auth, (req, res) => {
    db.prepare('DELETE FROM devices WHERE token=? AND user_id=?').run(String((req.body || {}).token || ''), req.user.id);
    res.json({ ok: true });
  });
  app.post('/api/devices/test', auth, async (req, res) => {
    const devs = db.prepare('SELECT * FROM devices WHERE user_id=?').all(req.user.id);
    if (!devs.length) return res.status(400).json({ error: 'This account has no phone registered for alerts yet. Open the app on your phone and allow notifications.' });
    const sent = await sendToDevices(devs, { title: 'Clubhouse IQ test alert', body: 'Alerts are working on this phone.', url: '/', kind: 'test' });
    if (!sent) return res.status(400).json({ error: 'Not delivered. Push is not set up on the server for this phone yet (Firebase for Android, Apple keys for iPhone).' });
    res.json({ ok: true, sent });
  });
  app.get('/api/push/status', auth, (req, res) => {
    res.json({ android: !!fcmAccount(), ios: apnsReady(),
      devices: db.prepare('SELECT platform, app_version, last_seen FROM devices WHERE user_id=?').all(req.user.id) });
  });
  app.get('/api/widget', auth, (req, res) => {
    if (req.user.role === 'staff') return res.status(403).json({ error: 'Not available' });
    res.json(widgetSummary());
  });

  // App links. Tag links (/?u=TAG) and alert links open the installed app.
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const fps = String(process.env.ANDROID_CERT_SHA256 || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    res.json(fps.length ? [{ relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: ANDROID_PKG, sha256_cert_fingerprints: fps } }] : []);
  });
  app.get('/.well-known/apple-app-site-association', (req, res) => {
    const id = (process.env.APPLE_TEAM_ID || 'TEAMID') + '.' + BUNDLE();
    res.json({ applinks: { details: [{ appIDs: [id], components: [
      { '/': '/', '?': { u: '*' }, comment: 'Equipment tag links' },
      { '/': '/', '?': { wo: '*' } }, { '/': '/', '?': { tab: '*' } }] }] },
      webcredentials: { apps: [id] } });
  });
}

module.exports = { mount, plantAlarm, workOrder, assigned, pushRoles, widgetSummary, _test: { sendToDevices, apnsToken, fcmAccess } };
