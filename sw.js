// Bump this version on every deploy so installed PWAs pick up changes.
const CACHE_NAME = 'maybe-rain-v12';
// Base path of wherever the app is served from (works at a domain root
// or under a subpath like GitHub Pages' /repo-name/).
const BASE = new URL('./', self.location).pathname;
const SHELL = [BASE, BASE + 'index.html', BASE + 'manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cross-origin (weather/geocoding APIs): network only, never cached here.
  if (url.origin !== location.origin) return;

  // App shell: network-first so deploys reach installed PWAs immediately;
  // cache fallback keeps offline open working.
  if (event.request.mode === 'navigate' || url.pathname === BASE + 'index.html' || url.pathname === BASE) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached => cached || caches.match(BASE + 'index.html'))
        )
    );
    return;
  }

  // Static assets (manifest, icons): cache-first.
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
    )
  );
});
