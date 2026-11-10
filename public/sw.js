// Mini Casino service worker. The build replaces __BUILD_VERSION__ with a hash of
// the site's files, so every deploy installs a fresh cache and drops the old one.
const VERSION = '__BUILD_VERSION__';
const CACHE = `mini-casino-${VERSION}`;
const PRECACHE = [
  '/',
  '/blackjack',
  '/manifest.webmanifest',
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
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    // Pages: network first so a new deploy shows up right away; cached copy when offline.
    event.respondWith(
      fetch(request)
        .then(response => store(request, response))
        .catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match('/')))
    );
    return;
  }

  // Icons, manifest and other files: cache first.
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => store(request, response)))
  );
});
