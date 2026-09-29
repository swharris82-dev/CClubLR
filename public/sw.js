/* Clubhouse IQ service worker: keeps the app and the last-loaded data on the
   phone so it opens and reads in mechanical rooms with no signal. Writes are
   queued by the page itself (see round2-ui.js) and sent when back online. */
const SHELL = 'ciq-shell-v3';
const DATA = 'ciq-data-v1';
const SHELL_FILES = ['/', '/index.html', '/ops-ui.js', '/round2-ui.js', '/crest.png', '/request.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL, DATA].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts: cache after first load.
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(SHELL).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { c.put(req, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== location.origin) return;
  // Public request page and anything else not the app API: network first.
  const isApi = url.pathname.startsWith('/api/');
  if (isApi && url.pathname.startsWith('/api/public/')) return;
  const cacheName = isApi ? DATA : SHELL;
  e.respondWith(
    fetch(req).then(r => {
      if (r.ok && (isApi || r.type === 'basic')) {
        const copy = r.clone();
        caches.open(cacheName).then(c => c.put(req, copy));
      }
      return r;
    }).catch(() => caches.open(cacheName).then(c => c.match(req, { ignoreVary: true })).then(hit => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('/index.html');
      return new Response(JSON.stringify({ error: 'Offline, and this has not been opened before on this phone' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } });
    }))
  );
});
