/* Clubhouse IQ native app layer.
   When the page runs inside the Android or iPhone app, this talks to the
   phone through a small bridge: NFC equipment tags, push alerts, on-device
   nameplate and barcode reading, fingerprint / Face ID lock, photos shared
   in from other apps, app shortcuts, the home screen widget, and a full
   offline download. In a normal browser NATIVE is null and the extra
   buttons stay hidden, except Download for offline, which works anywhere.

   Bridge contract (both platforms):
     page -> phone : CIQAndroid.post(json) | webkit.messageHandlers.ciq.postMessage(json)
                     json = {id, method, args}
     phone -> page : CIQNativeReply(id, ok, data)   answer to a call
                     CIQNativeEvent(type, data)     push-token, shared-photo, nfc-url, open-url
*/
const NATIVE = (function () {
  const a = window.CIQAndroid, i = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ciq;
  if (!a && !i) return null;
  let n = 0; const wait = {};
  window.CIQNativeReply = function (id, ok, data) {
    const w = wait[id]; if (!w) return; delete wait[id];
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) {} }
    ok ? w.res(data) : w.rej(new Error((data && data.error) || data || 'The phone could not do that.'));
  };
  function call(method, args) {
    return new Promise((res, rej) => {
      const id = 'c' + (++n); wait[id] = { res, rej };
      const msg = JSON.stringify({ id, method, args: args || {} });
      try { a ? a.post(msg) : i.postMessage(msg); } catch (e) { delete wait[id]; rej(e); }
    });
  }
  return { platform: a ? 'android' : 'ios', call, caps: {} };
})();

(function nativeStyle() {
  const s = document.createElement('style');
  s.textContent = '.nat-only{display:none}.has-native .nat-only{display:revert}' +
    '.nat-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.nat-row .btn-2{flex:1;min-width:140px}' +
    '.nat-tag{display:inline-flex;align-items:center;gap:6px}.nat-tag svg{width:18px;height:18px}' +
    '.shared-img{width:100%;max-height:260px;object-fit:contain;border-radius:var(--r-s);background:var(--deep);border:1px solid var(--edge)}';
  document.head.appendChild(s);
})();
const NFC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 8.3a8 8 0 0 1 0 7.4M9.5 6.3a12 12 0 0 1 0 11.4M13 4.5a16 16 0 0 1 0 15"/></svg>';

/* ---------------- start up ---------------- */
async function nativeBoot() {
  if (!NATIVE) return;
  document.documentElement.classList.add('has-native');
  try { NATIVE.caps = await NATIVE.call('caps') || {}; } catch (e) { NATIVE.caps = {}; }
  ['nfc', 'scan', 'biometric', 'push', 'share', 'widget'].forEach(k => document.documentElement.classList.toggle('nat-' + k, !!NATIVE.caps[k]));
}
nativeBoot();

// Hook sign-in and sign-out so the phone knows the session (widget, push).
(function wrapSession() {
  const enter = window.enterApp;
  if (typeof enter === 'function') {
    window.enterApp = function () {
      const r = enter.apply(this, arguments);
      afterSignIn();
      return r;
    };
  }
  const out = document.getElementById('outBtn');
  if (out) out.addEventListener('click', () => {
    if (!NATIVE) return;
    const t = NATIVE._pushToken;
    NATIVE.call('session', { token: null }).catch(() => {});
    if (t && TOKEN) fetch('/api/devices', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ token: t }) }).catch(() => {});
  }, true);
})();

async function afterSignIn() {
  handleLinkParams();
  if (!NATIVE || !ME) return;
  try { await NATIVE.call('session', { token: TOKEN, origin: location.origin, name: ME.name, role: ME.role }); } catch (e) {}
  if (NATIVE.caps.push && ME.role !== 'staff') registerPush(false);
  // Keep the whole plant on the phone: refresh the offline copy twice a day.
  if (ME.role !== 'staff') {
    let last = 0; try { last = +localStorage.getItem('ciq_offline_at') || 0; } catch (e) {}
    if (Date.now() - last > 12 * 3600e3 && navigator.onLine) setTimeout(() => downloadOffline(true), 8000);
  }
}

async function registerPush(ask) {
  try {
    const r = await NATIVE.call('push.register', { ask: !!ask });
    if (r && r.token) await saveDeviceToken(r.token);
    return r;
  } catch (e) { if (ask) toast(e.message); return null; }
}
async function saveDeviceToken(token) {
  NATIVE._pushToken = token;
  try { await api('/devices', { method: 'POST', body: { platform: NATIVE.platform, token, app_version: NATIVE.caps.version || '' } }); } catch (e) {}
}

/* ---------------- events from the phone ---------------- */
window.CIQNativeEvent = function (type, data) {
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) {} }
  if (type === 'push-token' && data && data.token && ME) saveDeviceToken(data.token);
  if (type === 'nfc-url' || type === 'open-url') openAppLink(data && data.url);
  if (type === 'shared-photo' && data && data.dataUrl) sharedPhoto(data.dataUrl, data.name || '');
};

/* Links: tag (?u=), work order (?wo=), screen (?tab=), shortcut (?action=). */
function openAppLink(url) {
  if (!url) return;
  let u; try { u = new URL(url, location.origin); } catch (e) { return; }
  if (u.origin !== location.origin) return;
  const p = u.searchParams;
  if (p.get('u')) return whenSignedIn(() => scanOpen(p.get('u')));
  linkParams(p);
}
function handleLinkParams() {
  let p; try { p = new URLSearchParams(location.search); } catch (e) { return; }
  if (!p.get('wo') && !p.get('tab') && !p.get('action')) return;
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  linkParams(p);
}
function linkParams(p) {
  whenSignedIn(() => {
    const wo = parseInt(p.get('wo'), 10), tab = p.get('tab'), act = p.get('action');
    if (wo) { showTab('work'); openWo(wo); }
    else if (tab && typeof ALLTABS !== 'undefined' && ALLTABS.includes(tab)) showTab(tab);
    if (act === 'newwo' && typeof newWoForm === 'function') { showTab('work'); newWoForm(); }
    if (act === 'nfc') nfcRead();
    if (act === 'scan') { showTab('record'); setTimeout(() => (window.scanTag || nfcRead)(), 300); }
  });
}
function whenSignedIn(fn) {
  let n = 0;
  const t = setInterval(() => { if (ME && TOKEN) { clearInterval(t); setTimeout(fn, 200); } else if (++n > 100) clearInterval(t); }, 150);
}

/* ---------------- NFC equipment tags ---------------- */
function tagFromText(text) {
  text = String(text || '').trim();
  try { const u = new URL(text); return (u.searchParams.get('u') || '').toUpperCase(); } catch (e) {}
  return /^[A-Z0-9_.\-]{2,40}$/i.test(text) ? text.toUpperCase() : '';
}
async function nfcRead() {
  if (!NATIVE || !NATIVE.caps.nfc) return toast('NFC is not available on this phone.');
  try {
    const r = await NATIVE.call('nfc.read', { prompt: 'Hold the top of your phone to the equipment tag.' });
    const tag = tagFromText(r && (r.url || r.text));
    if (!tag) return toast('That tag is not a Clubhouse IQ equipment tag.');
    scanOpen(tag);
  } catch (e) { if (!/cancel/i.test(e.message)) toast(e.message); }
}
async function nfcWrite(apt) {
  if (!NATIVE || !NATIVE.caps.nfc) return toast('NFC is not available on this phone.');
  const url = location.origin + '/?u=' + encodeURIComponent(apt);
  try {
    await NATIVE.call('nfc.write', { url, prompt: 'Hold your phone to a blank NFC tag for ' + apt + '.' });
    toast('Tag written for ' + apt);
  } catch (e) { if (!/cancel/i.test(e.message)) toast(e.message); }
}
// Buttons: "Tap tag" next to the equipment lookup, "Write NFC tag" on the plate.
(function nfcButtons() {
  const ob = document.getElementById('openBtn');
  if (ob && ob.parentNode) {
    const b = document.createElement('button');
    b.className = 'btn-2 nat-only nat-tag'; b.type = 'button'; b.id = 'nfcReadBtn';
    b.innerHTML = NFC_ICON + 'Tap tag'; b.onclick = nfcRead;
    ob.parentNode.insertBefore(b, ob.nextSibling);
  }
  const dp = window.drawPlate;
  if (typeof dp === 'function') window.drawPlate = function () {
    const r = dp.apply(this, arguments);
    try {
      const plate = document.getElementById('plate');
      if (plate && UNIT && NATIVE && NATIVE.caps.nfc && canWork()) {
        let row = document.getElementById('nfcWriteRow');
        if (!row) { row = document.createElement('div'); row.id = 'nfcWriteRow'; row.className = 'nat-row'; plate.appendChild(row); }
        row.innerHTML = '<button class="btn-2 nat-tag" type="button" onclick="nfcWrite(UNIT.apt)">' + NFC_ICON + 'Write NFC tag for ' + esc(UNIT.apt) + '</button>';
      }
    } catch (e) {}
    return r;
  };
})();

/* ---------------- on-device nameplate and barcode reading ---------------- */
function parsePlate(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean), out = {};
  const grab = (re) => {
    for (let k = 0; k < lines.length; k++) {
      const m = lines[k].match(re);
      if (m) { const v = (m[1] || '').trim() || (lines[k + 1] || '').trim(); if (v) return v.replace(/^[:#.\s]+/, '').split(/\s+/)[0]; }
    }
    return '';
  };
  out.model = grab(/\b(?:MODEL\s*(?:NO|NUMBER|#)|MOD\.?\s*(?:NO|#)|M\/N|MDL|MODEL)\b\.?\s*[:#.]?\s*(.*)$/i);
  out.serial = grab(/\b(?:SERIAL\s*(?:NO|NUMBER|#)|SER\.?\s*(?:NO|#)|S\/N|SERIAL|SN)\b\.?\s*[:#.]?\s*(.*)$/i);
  out.refrigerant = (String(text).match(/\bR[- ]?(22|134A|410A|407C|32|454B|513A|1234ZE|123)\b/i) || [])[0] || '';
  const brands = ['York', 'Trane', 'Carrier', 'Lennox', 'Daikin', 'Mitsubishi', 'LG', 'Rheem', 'Goodman', 'Bryant', 'McQuay', 'AAON', 'Liebert',
    'Hoshizaki', 'Manitowoc', 'Scotsman', 'True', 'Taco', 'Bell & Gossett', 'Grundfos', 'Lochinvar', 'Raypak', 'Baltimore Aircoil', 'Evapco', 'ABB', 'Greenheck'];
  out.manufacturer = brands.find(b => new RegExp('\\b' + b.replace(/[&]/g, '\\&') + '\\b', 'i').test(text)) || '';
  if (out.refrigerant) out.refrigerant = out.refrigerant.toUpperCase().replace(/^R[- ]?/, 'R-');
  return out;
}
async function scanPlateOnDevice() {
  if (!NATIVE || !NATIVE.caps.scan) return;
  const msg = document.getElementById('eScanMsg');
  try {
    const r = await NATIVE.call('scan.text', { prompt: 'Point at the data plate' });
    const f = parsePlate(r && r.text);
    const set = (id, v) => { const el = document.getElementById(id); if (el && v && !el.value) el.value = v; };
    set('eM', f.manufacturer); set('eMo', f.model); set('eS', f.serial); set('eR', f.refrigerant);
    const got = ['manufacturer', 'model', 'serial', 'refrigerant'].filter(k => f[k]);
    if (msg) msg.textContent = got.length ? 'Read on the phone: ' + got.join(', ') + '. Check them against the plate before you save.'
      : 'Could not find model or serial in that photo. Try closer, or use Scan data plate for the AI reader.';
  } catch (e) { if (!/cancel/i.test(e.message) && msg) msg.textContent = e.message; }
}
async function scanCodeOnDevice() {
  if (!NATIVE || !NATIVE.caps.scan) return;
  try {
    const r = await NATIVE.call('scan.barcode', {});
    const v = String(r && r.value || '').trim();
    const tag = tagFromText(v);
    if (/^https?:/i.test(v) && tag) return scanOpen(tag);
    const s = document.getElementById('eS');
    if (s && !s.value) { s.value = v; toast('Barcode put in Serial'); } else toast('Read: ' + v);
  } catch (e) { if (!/cancel/i.test(e.message)) toast(e.message); }
}
(function scanButtons() {
  const dr = window.drawRecord;
  if (typeof dr === 'function') window.drawRecord = function () {
    const r = dr.apply(this, arguments);
    try {
      const m = document.getElementById('eScanMsg');
      if (m && NATIVE && NATIVE.caps.scan && !document.getElementById('natScanRow')) {
        const row = document.createElement('div'); row.className = 'nat-row'; row.id = 'natScanRow';
        row.innerHTML = '<button class="btn-2" type="button" onclick="scanPlateOnDevice()">Read plate on phone (works offline)</button>' +
          '<button class="btn-2" type="button" onclick="scanCodeOnDevice()">Scan barcode</button>';
        m.parentNode.insertBefore(row, m);
      }
    } catch (e) {}
    return r;
  };
})();

/* ---------------- photos shared in from other apps ---------------- */
let SHARED = null;
async function sharedPhoto(dataUrl, name) {
  SHARED = dataUrl;
  whenSignedIn(async () => {
    if (!canWork()) { toast('Your role cannot add photos to work orders.'); return; }
    let list = [];
    try { list = (await api('/workorders?view=open')).workorders.slice(0, 25); } catch (e) {}
    sheet('Shared photo', name || 'Add it to a work order',
      '<div class="panel"><img class="shared-img" src="' + SHARED + '" alt="Shared photo"></div>' +
      '<div class="panel"><div class="eyebrow">New work order</div>' +
      '<input id="shTitle" placeholder="What is wrong?"><input id="shTag" placeholder="Equipment tag (optional)" style="margin-top:8px;text-transform:uppercase">' +
      '<button class="btn full" style="margin-top:10px" onclick="sharedNew()">Create with this photo</button>' + errBox('shMsg') + '</div>' +
      (list.length ? '<div class="panel"><div class="eyebrow">Or add to an open one</div>' +
        list.map(w => '<div class="att" onclick="sharedAttach(' + w.id + ')"><div style="flex:1;min-width:0"><div class="t">#' + w.id + ' ' + esc(w.title) + '</div>' +
          '<div class="m">' + esc([w.apt, w.building].filter(Boolean).join(' · ')) + '</div></div></div>').join('') + '</div>' : ''));
  });
}
async function sharedPhotoUpload(id) {
  const data = String(SHARED).split(',').pop();
  await api('/workorders/' + id + '/photos', { method: 'POST', body: { kind: 'before', data } });
}
async function sharedAttach(id) {
  try { await sharedPhotoUpload(id); SHARED = null; closeSheet(); toast('Photo added to #' + id); openWo(id); }
  catch (e) { toast(e.message); }
}
async function sharedNew() {
  const title = (document.getElementById('shTitle').value || '').trim(), apt = (document.getElementById('shTag').value || '').trim().toUpperCase();
  if (!title) return showErr('shMsg', new Error('Say what is wrong first.'));
  try {
    const d = await api('/workorders', { method: 'POST', body: Object.assign({ title, priority: 'normal', category: 'General', photo: String(SHARED).split(',').pop() }, apt ? { apt } : {}) });
    const id = d.workorder && d.workorder.id;
    SHARED = null; closeSheet(); toast('Work order #' + id + ' created'); if (id) { showTab('work'); openWo(id); }
  } catch (e) { showErr('shMsg', e); }
}

/* ---------------- full offline download ---------------- */
// Loads every equipment record, its tag lookup, the open work and its
// details once, so the service worker has them cached for no-signal areas.
let OFFLINE_BUSY = false;
async function downloadOffline(quiet) {
  if (OFFLINE_BUSY) return; OFFLINE_BUSY = true;
  const btn = document.getElementById('offDl'), say = t => { if (btn) btn.textContent = t; };
  let n = 0, fail = 0;
  const get = async p => { try { await api(p); n++; } catch (e) { fail++; } };
  try {
    say('Downloading...');
    const units = ((await api('/units')).units || []);
    for (const u of units) { await get('/unit/' + encodeURIComponent(u.apt)); await get('/scan/' + encodeURIComponent(u.apt)); say('Equipment ' + n + ' of ' + units.length * 2); }
    for (const v of ['open', 'new', 'mine']) {
      try { const d = await api('/workorders?view=' + v); n++;
        for (const w of (d.workorders || []).slice(0, 150)) await get('/workorders/' + w.id);
      } catch (e) { fail++; }
    }
    await get('/pm'); await get('/plant');
    try { localStorage.setItem('ciq_offline_at', String(Date.now())); } catch (e) {}
    say('Download for offline');
    if (!quiet) toast('Saved ' + n + ' records on this phone' + (fail ? ' (' + fail + ' skipped)' : ''));
    const st = document.getElementById('offAt'); if (st) st.textContent = 'Last saved just now';
  } catch (e) { say('Download for offline'); if (!quiet) toast(e.message); }
  finally { OFFLINE_BUSY = false; }
}

/* ---------------- My account: phone settings ---------------- */
(function accountExtras() {
  const as = window.accountSheet;
  if (typeof as !== 'function') return;
  window.accountSheet = async function () {
    const r = await as.apply(this, arguments);
    try {
      const host = document.querySelector('#sheetBg .sheet-bd');
      if (!host || document.getElementById('phonePanel') || !ME || ME.role === 'staff') return r;
      let at = 0; try { at = +localStorage.getItem('ciq_offline_at') || 0; } catch (e) {}
      const p = document.createElement('div'); p.className = 'panel'; p.id = 'phonePanel';
      let h = '<div class="eyebrow">This phone</div>' +
        '<div class="dim" style="font-size:14px">Keep every equipment record and the open work on this phone for mechanical rooms with no signal. Work you log offline sends when you are back online.</div>' +
        '<button class="btn-2 full" id="offDl" style="margin-top:10px" onclick="downloadOffline(false)">Download for offline</button>' +
        '<div class="dim" id="offAt" style="font-size:12.5px;margin-top:6px">' + (at ? 'Last saved ' + new Date(at).toLocaleString() : 'Not saved yet') + '</div>';
      if (NATIVE && NATIVE.caps.push) h += '<div class="nat-row"><button class="btn-2" onclick="pushSetup()">Turn on alerts</button><button class="btn-2" onclick="pushTest()">Send a test alert</button></div>' +
        '<div class="dim" style="font-size:12.5px;margin-top:6px">Plant alarms, emergencies, new requests, and work assigned to you.</div>';
      if (NATIVE && NATIVE.caps.biometric) {
        let on = false; try { on = !!(await NATIVE.call('biometric.get')).on; } catch (e) {}
        h += '<label class="chk" style="margin-top:12px;display:flex;gap:10px;align-items:center"><input type="checkbox" id="bioOn"' + (on ? ' checked' : '') + ' onchange="bioSet(this)"> Require ' +
          (NATIVE.platform === 'ios' ? 'Face ID or Touch ID' : 'fingerprint or face unlock') + ' to open the app</label>';
      }
      p.innerHTML = h;
      const anchor = host.querySelector('#delReqs') || host.querySelector('.panel:last-of-type');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(p, anchor); else host.appendChild(p);
    } catch (e) {}
    return r;
  };
})();
async function pushSetup() { const r = await registerPush(true); if (r && r.token) toast('Alerts are on for this phone'); }
async function pushTest() { try { await registerPush(false); await api('/devices/test', { method: 'POST' }); toast('Test alert sent'); } catch (e) { toast(e.message); } }
async function bioSet(el) {
  try { await NATIVE.call('biometric.set', { on: el.checked }); toast(el.checked ? 'The app will ask to unlock' : 'Unlock turned off'); }
  catch (e) { el.checked = !el.checked; toast(e.message); }
}
