// Bump this version on every deploy so installed PWAs pick up changes.
const CACHE_NAME = 'maybe-rain-v44';
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

  // The hourly-data explainer (opened in an iframe from the settings menu):
  // edited independently of app releases and changes often, so it's
  // deliberately excluded from every cache path below, including the
  // shell's own (an iframe load is also a 'navigate' request, so without
  // this it would otherwise be caught by the next block). Straight to the
  // network, nothing stored, nothing to go stale or need busting.
  if (url.pathname === BASE + 'how-hourly-data-is-made.html') {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell + manifest: network-first so deploys reach installed PWAs
  // immediately. Keeping the manifest network-first means new (content-hashed)
  // icon URLs are seen right away instead of being pinned to a cached copy.
  // Cache fallback keeps offline open working.
  if (event.request.mode === 'navigate' || url.pathname === BASE + 'index.html' || url.pathname === BASE || url.pathname === BASE + 'manifest.json') {
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

  // Static assets (content-hashed icons, etc.): cache-first. Safe because the
  // filename changes when the bytes change, so a new icon = a new URL = a miss.
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
