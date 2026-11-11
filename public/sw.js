// Mini Casino service worker. The build replaces __BUILD_VERSION__ with a hash of
// the site's files, so every deploy installs a fresh cache and drops the old one.
const VERSION = '__BUILD_VERSION__';
const CACHE = `mini-casino-${VERSION}`;
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/fonts/manrope.woff2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('mini-casino-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function store(request, response) {
  if (response.ok && !response.redirected) {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache the service worker itself or the API (sign-in and saves must always be live).
  if (url.origin !== self.location.origin || url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Pages: network first so a new deploy shows up right away; cached copy when offline.
    event.respondWith(
      fetch(request)
        .then(response => (url.search ? response : store(request, response)))   // skip one-off URLs like the sign-in return
        .catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match('/')))
    );
    return;
  }

  // Files whose name changes whenever their content does (the lab's code chunks), plus fonts
  // and icons: cache first. Everything else (the lab's entry script, the manifest) is network
  // first, so an update can never leave an old file asking for pieces that no longer exist.
  const immutable = url.pathname.startsWith('/lab/chunks/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/');
  if (immutable) {
    event.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(response => store(request, response)))
    );
    return;
  }
  event.respondWith(
    fetch(request)
      .then(response => store(request, response))
      .catch(() => caches.match(request).then(hit => hit || Response.error()))
  );
});
