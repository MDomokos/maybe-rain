// --- City search (Open-Meteo geocoding, URL-encoded) --------------
const searchCity = async query => {
    if (query.length < 2) return [];
    try {
        const response = await fetch(
            'https://geocoding-api.open-meteo.com/v1/search' +
            `?name=${encodeURIComponent(query)}&count=5&language=en&format=json`
        );
        if (!response.ok) throw new Error('Search failed');
        return (await response.json()).results || [];
    } catch (error) {
        console.error('Search error:', error);
        return [];
    }
};

// --- Recents + favorites (search shortcuts) -----------------------
// Two lists surface in the search panel. Recents: opening a city
// auto-saves it (MRU order, capped), ✕-removable. Favorites: cities
// the user explicitly ★-stars (capped at MAX_FAVORITES); these sit at
// the top of the resting list and are the set ↑/↓ / swipe cycle between.
const loadCities = key => {
    const list = loadJSON(key);
    return Array.isArray(list) ? list.filter(c => c?.name && c.latitude != null) : [];
};
let savedCities = loadCities(LS_CITIES);   // recents (MRU)
let favorites = loadCities(LS_FAVORITES);  // explicit ★

// Recents carry `seenAt` so a variant can tell "looked at this morning"
// from "looked at this in March" — primary's switcher uses it to age out
// its transient tier. MRU order alone can't do that; it only says which
// entry is newer, not whether either is actually recent.
//
// Entries saved before this field existed are stamped once here instead
// of being treated as already expired, which would empty the transient
// tier the moment this update lands. Each gets one full TTL window to
// earn a real timestamp; anything not revisited within it ages out
// normally after that.
{
    let patched = false;
    savedCities = savedCities.map(c =>
        c.seenAt ? c : (patched = true, { ...c, seenAt: Date.now() }));
    if (patched) saveJSON(LS_CITIES, savedCities);
}

const rememberCity = place => {
    const before = savedCities.length;
    savedCities = [{ ...place, seenAt: Date.now() },
                   ...savedCities.filter(c => placeKey(c) !== placeKey(place))]
        .slice(0, MAX_CITIES);
    saveJSON(LS_CITIES, savedCities);
    // An MRU eviction can orphan the evicted place's cache.
    if (before >= MAX_CITIES) sweepForecasts();
};
const isFav = p => favorites.some(f => placeKey(f) === placeKey(p));
const isRecent = p => savedCities.some(c => placeKey(c) === placeKey(p));
// Star toggles favorite; appended (not prepended) so cycle order stays
// stable. Unfavoriting a city that's also a recent leaves it in recents.
// Returns false (no-op) when adding would exceed MAX_FAVORITES, so the
// caller can surface a hint rather than silently evicting a saved city.
const toggleFavorite = place => {
    if (isFav(place)) {
        favorites = favorites.filter(f => placeKey(f) !== placeKey(place));
        saveJSON(LS_FAVORITES, favorites);
        // Unfavoriting can orphan the place's cache (when it is
        // not also a recent or the place on screen).
        sweepForecasts();
    } else {
        if (favorites.length >= MAX_FAVORITES) return false;
        favorites = [...favorites, place];
        saveJSON(LS_FAVORITES, favorites);
    }
    return true;
};
// primary's promotion model, in place of the ★ toggle. One glyph that
// meant two opposite things depending on state you had to read off the
// row before you could press it is a control that cannot be aimed at;
// these are one-way, and each row shows only the one that applies to it.
//
// classic keeps toggleFavorite: it has its own search list, its own
// vocabulary, and no tier for a demoted city to fall into.
const pinCity = place => isFav(place) ? true : toggleFavorite(place);
const unpinCity = place => {
    if (!isFav(place)) return;
    // A demotion, not a delete: the place drops into the transient tier
    // and ages out on its own, so unpinning never leaves anything needing
    // manual cleanup.
    //
    // Appended rather than prepended, since unpinning isn't a visit and
    // the head of the MRU list means "the city you were just on". It's
    // stamped with a fresh `seenAt` either way, so it gets a full TTL
    // window before it can expire. Room for it is freed from the old end
    // of the list first, so it can't be the entry the cap immediately drops.
    const rest = savedCities.filter(c => placeKey(c) !== placeKey(place))
        .slice(0, MAX_CITIES - 1);
    savedCities = [...rest, { ...place, seenAt: Date.now() }];
    saveJSON(LS_CITIES, savedCities);
    // Ordered after the write so the place is already a recent when
    // toggleFavorite's sweepForecasts runs, or its cached forecast would
    // be swept as orphaned in the same breath.
    toggleFavorite(place);
};

// Transient advisory shown in the search panel when the favorites cap is
// hit. Prepended to the results (amber, self-clearing); a later re-render
// or keystroke wipes it, whichever comes first. The message is a
// parameter because the two variants call the same list different things.
const flashFavHint = (msg = `Favorites are limited to ${MAX_FAVORITES}. Unfavorite one to add another.`) => {
    const box = $('searchResults');
    let hint = box.querySelector('.fav-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.className = 'fav-hint';
        hint.setAttribute('role', 'status');
        box.prepend(hint);
    }
    hint.textContent = msg;
    clearTimeout(hint._t);
    hint._t = setTimeout(() => hint.remove(), 3500);
};

// --- Shareable place: deep-link URL + branded card ---------------
// The place lives in the URL, so any view is a link someone can send.
// Coords are the source of truth (the fetch needs only lat/lon);
// name/admin1/country are cosmetic. Coords round to 3 dp (~110 m), so
// a shared "my location" link never carries pinpoint GPS.
const placeFromURL = () => {
    const q = new URLSearchParams(location.search);
    const lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return {
        name: q.get('name') || 'Shared location',
        admin1: q.get('admin1') || '', country: q.get('country') || '',
        latitude: lat, longitude: lon
    };
};
const shareURL = p => {
    const q = new URLSearchParams({
        lat: (+p.latitude).toFixed(3), lon: (+p.longitude).toFixed(3), name: p.name
    });
    if (p.admin1) q.set('admin1', p.admin1);
    if (p.country) q.set('country', p.country);
    return `${location.origin}${location.pathname}?${q}`;
};
// Keep the address bar shareable, without stacking history entries.
const syncURL = p => {
    try { history.replaceState(null, '', shareURL(p)); } catch { /* non-fatal */ }
};

// --- "Use my location" ---------------------------------------------
const useMyLocation = () => {
    if (!navigator.geolocation) { setStatus('Geolocation not supported here', 'stale', { transient: true }); return; }
    setStatus('Locating…', 'updating');
    navigator.geolocation.getCurrentPosition(async pos => {
        const { latitude, longitude } = pos.coords;
        // Keyless reverse geocode for a display name; fall back to
        // "My location" rather than guessing a city name.
        const place = { name: 'My location', country: '', admin1: '', latitude, longitude };
        try {
            const r = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client' +
                `?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
            if (r.ok) {
                const g = await r.json();
                place.name = g.city || g.locality || place.name;
                place.admin1 = g.principalSubdivision || '';
                place.country = g.countryCode || g.countryName || '';
            }
        } catch { /* keep the fallback name */ }
        changeCity(place);
    }, () => setStatus('Location unavailable. Try search', 'stale', { transient: true }),
       { timeout: 10000, maximumAge: 5 * 60 * 1000 });
};

// --- First-visit location guess: browser timezone → city ----------
// Fully local: reads the OS timezone (no IP, no third party, no
// permission prompt), then resolves it to coordinates through the
// same Open-Meteo geocoding endpoint the city search already uses.
// Coarse by design: a timezone is a region, so this is a "somewhere
// sensible in your part of the world" guess, not "your exact city".
// Only used on a first visit with no shared link and no saved place;
// the hardcoded default stays the final fallback if this can't
// resolve. Own abortable 4s timeout so a stalled geocode still yields
// to the default rather than hanging on the skeleton.
const guessPlaceFromTimezone = async () => {
    let tz;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
    // Need a Region/City zone; skip offset-only names (Etc/GMT±X, UTC).
    if (!tz || tz.indexOf('/') === -1 || /^Etc\//i.test(tz) || /GMT|UTC/i.test(tz)) return null;
    // Last path segment is the representative city:
    // "Europe/Budapest" → "Budapest", "America/Argentina/Buenos_Aires" → "Buenos Aires".
    const city = tz.split('/').pop().replace(/_/g, ' ');
    if (city.length < 2) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    let results;
    try {
        const r = await fetch(
            'https://geocoding-api.open-meteo.com/v1/search' +
            `?name=${encodeURIComponent(city)}&count=5&language=en&format=json`,
            { signal: ctrl.signal }
        );
        if (!r.ok) return null;
        results = (await r.json()).results;
    } catch { return null; }
    finally { clearTimeout(timer); }
    if (!results || !results.length) return null;
    // Prefer the hit whose own timezone matches the browser's, since it
    // disambiguates repeated city names to the one actually in your
    // zone; else fall back to the top (most-populated) match.
    const hit = results.find(x => x.timezone === tz) || results[0];
    if (hit.latitude == null || hit.longitude == null) return null;
    return {
        name: hit.name, country: hit.country_code || hit.country || '',
        admin1: hit.admin1 || '', latitude: hit.latitude, longitude: hit.longitude
    };
};
