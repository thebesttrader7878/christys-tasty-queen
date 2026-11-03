// Tasty Queen service worker. Caches ONLY static look-and-feel files.
// Never touches: /api (orders, checkout, payments, owner auth, webhooks), /owner dashboard,
// menu.json, app.js, pay.js, any non-GET request, or any other origin (Stripe, fonts, etc).
const V = 'ctq-pwa-v1';
const SHELL = ['/offline.html', '/styles.css', '/manifest.webmanifest', '/pwa.js', '/img/logo.jpg', '/img/favicon.png', '/img/icon-192.png', '/img/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const NEVER = p => p.startsWith('/api') || p.startsWith('/owner') || p === '/sw.js' || p === '/healthz';
const CACHEABLE = p => p === '/styles.css' || p === '/offline.html' || p === '/manifest.webmanifest' || p === '/pwa.js' || p.startsWith('/img/');
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (NEVER(u.pathname)) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match('/offline.html'))); return; }
  if (CACHEABLE(u.pathname)) e.respondWith(caches.open(V).then(c => fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => c.match(r))));
});
