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
// The leading 2. is permanent and means "primary"; classic is 1. and counts
// separately. The trailing minor.patch moves each release: bump the minor
// for a larger change, the patch for a small one.
const CACHE_PREFIX = 'maybe-rain-2.';
const CACHE_NAME = CACHE_PREFIX + '6.7';
// Caches written before the variant split were named maybe-rain-v45 and so
// on, with no variant segment, and they sit at this scope. The prefix test
// above no longer matches them, so without this they would leak forever.
// Classic's caches never took this shape, so it cannot catch them by
// accident. Droppable once no installed PWA is still carrying a pre-split
// cache.
const LEGACY_CACHE = /^maybe-rain-v\d/;
// Base path of wherever the app is served from (works at a domain root
// or under a subpath like GitHub Pages' /repo-name/).
const BASE = new URL('./', self.location).pathname;
const SHELL = [BASE, BASE + 'index.html', BASE + 'manifest.json'];
// How long the shell waits on the network before the stored copy answers
// instead (see the fetch handler). Long enough that a merely slow connection
// still delivers the current release rather than the last one, short enough
// that a connection going nowhere does not hold the app on a blank screen.
const SHELL_TIMEOUT_MS = 3500;

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
      // Only this variant's own older caches (see CACHE_PREFIX above), plus
      // any pre-split cache this scope left behind.
      .then(keys => Promise.all(keys.filter(k => (k.startsWith(CACHE_PREFIX) || LEGACY_CACHE.test(k)) && k !== CACHE_NAME).map(k => caches.delete(k))))
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
  //
  // Network-first used to mean network-ONLY until the network said no, and a
  // connection that is present but barely moving never does: `fetch` sits
  // there neither resolving nor rejecting, and the app waits on it for as
  // long as the user will. Airplane mode is what hid this — there the fetch
  // fails in the same instant and the stored copy answers, so offline looked
  // like the case that worked.
  //
  // So the stored copy answers a slow network too, on a timer. The request is
  // deliberately NOT aborted: it finishes in the background and refreshes the
  // cache either way, so a load served from the cache still leaves the newer
  // bytes there for the next one.
  if (event.request.mode === 'navigate' || url.pathname === BASE + 'index.html' || url.pathname === BASE || url.pathname === BASE + 'manifest.json') {
    const fetched = fetch(event.request);
    // The stored copy is refreshed whichever answer the page got, and that
    // write is what `waitUntil` holds the worker open for: it used to finish
    // well inside the response it rode on, and now routinely outlives it, so
    // a worker shut down in between would drop it. Called here, in the
    // handler's own turn, because that is the only point at which the event
    // is still being dispatched and will accept it. A failure is offline
    // rather than an error, and is swallowed so it cannot come back as an
    // unhandled rejection on every load.
    event.waitUntil(
      fetched
        .then(response => caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, response.clone())))
        .catch(() => {})
    );
    event.respondWith((async () => {
      const stored = await caches.match(event.request)
        || await caches.match(BASE + 'index.html');
      // Nothing stored to fall back to (a first run): the network is the only
      // answer there is, and waiting for it is the only thing to do.
      if (!stored) return fetched;
      // A rejection resolves to null rather than throwing, so the loser of
      // the race is always the stored copy and never an error page.
      const won = await Promise.race([
        fetched.catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), SHELL_TIMEOUT_MS))
      ]);
      return won || stored;
    })());
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
