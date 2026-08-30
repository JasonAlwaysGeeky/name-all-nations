/*
 * Offline play, and the fetch handler Chrome wants before it will offer
 * to install the app to the home screen.
 *
 * Deliberately network-first for everything the game is *made of*: this
 * is a repo that gets pushed to Pages several times a day, and a cache
 * that serves yesterday's app.js on the phone you're testing on is worse
 * than no cache at all. The network answer is what you get whenever
 * there is one; the cache is the fallback, kept fresh on every hit.
 *
 * The three map files are the exception — three quarters of a megabyte
 * of borders that only change when the map itself is regenerated, so
 * they come from the cache first and only bump when CACHE does.
 */

const CACHE = 'nan-v1';

// Enough to boot the game with no network at all. world-full.svg (1.4MB)
// is left out on purpose: it is fetched lazily for deep zoom, and it
// lands in the cache the first time that happens.
const CORE = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/countries.js',
  './map/world.svg',
  './map/world-lo.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const IMMUTABLE = /\/map\/[^/]+\.(svg|json)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // One miss (a typo, a file mid-deploy) shouldn't fail the whole
      // install and leave the app with no worker at all.
      .then(c => Promise.allSettled(CORE.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Borders: cache first, and top the cache up in the background.
  if (IMMUTABLE.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }))
    );
    return;
  }

  // Everything else: whatever the network says, falling back to the last
  // copy that worked.
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      // Only a page request falls back to the shell; handing index.html
      // to a fetch() that wanted JSON just moves the failure downstream.
      .catch(() => caches.match(req)
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
