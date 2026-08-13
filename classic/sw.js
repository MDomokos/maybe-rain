// Bump this version on every deploy so installed PWAs pick up changes.
//
// The name carries the variant, because cache storage is keyed per-origin
// rather than per-SW-scope: both variants' caches sit in the same bucket, so
// the activate sweep below must only ever delete its OWN variant's old
// versions. CACHE_PREFIX is what scopes that sweep, and it is also the build
// id build.mjs stamps into __APP_VERSION__, so a cache name, a build id and
// a release tag are all the same string. Neither variant's prefix may be a
// prefix of the other, or one variant's activation would evict the other's
// shell and break its offline open.
//
// The leading 1. is permanent and means "classic"; primary is 2. and counts
// separately. The trailing minor.patch moves each release, only when
// classic itself changes: bump the minor for a larger change, the patch
// for a small one. Classic's history up to v40 is in its CHANGELOG under
// the old flat numbering.
const CACHE_PREFIX = 'maybe-rain-1.';
const CACHE_NAME = CACHE_PREFIX + '2.1';
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
      // Only this variant's own older caches (see CACHE_PREFIX above).
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))))
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
