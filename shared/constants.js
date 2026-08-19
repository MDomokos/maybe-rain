const FRESH_TIME = 10 * 60 * 1000;   // consider data fresh for 10 min
const FETCH_TIMEOUT = 10 * 1000;     // abort a stalled forecast fetch after 10s
const HOUR_START = 6, HOUR_END = 21; // displayed hours (inclusive)
const GUST_MIN = 8; // km/h a gust must exceed the sustained wind by before the tooltip shows it
// The forecast uses Open-Meteo "Best Match" (a different model per
// location, whose identity the API never returns). For the freshness
// line we read the *run* time of the global model that drives the
// 7-day horizon (DWD ICON, 6-hourly, hourly, 7.5 days) as an honest
// reference for how recent the underlying model output is. The
// metadata endpoint is tiny and is NOT counted against rate limits.
const META_URL = 'https://api.open-meteo.com/data/dwd_icon/static/meta.json';
// Regional high-resolution models Best Match may use for the near-term
// hours; each refreshes more often than the global run and covers a
// limited area. bbox = [latMin, lonMin, latMax, lonMax], read from each
// model's own meta.json. Best Match never reveals which model it picked
// per point, so this is an approximation: of the models whose grid
// contains the location, pick the one whose center is nearest (see
// localModelFor). A location outside every box → global indicator only.
const LOCAL_MODELS = [
    { slug: 'meteofrance_arome_france_hd',     label: 'AROME',    bbox: [37.5, -12.0, 55.4, 16.0] },
    { slug: 'dwd_icon_d2',                     label: 'ICON-D2',  bbox: [43.18, -3.94, 58.08, 20.34] },
    { slug: 'knmi_harmonie_arome_netherlands', label: 'HARMONIE', bbox: [49.0, 0.0, 56.0, 11.28] },
    { slug: 'ukmo_uk_deterministic_2km',       label: 'UKMO',     bbox: [44.51, -17.15, 61.93, 15.35] },
    { slug: 'ncep_hrrr_conus',                 label: 'HRRR',     bbox: [21.14, -122.72, 47.84, -60.92] },
    { slug: 'jma_msm',                         label: 'MSM',      bbox: [22.4, 120.0, 47.6, 150.0] }
];
const localMetaURL = slug => `https://api.open-meteo.com/data/${slug}/static/meta.json`;
const localModelFor = (lat, lon) => {
    let best = null, bestD = Infinity;
    for (const m of LOCAL_MODELS) {
        const [a, b, c, d] = m.bbox;
        if (lat < a || lat > c || lon < b || lon > d) continue;
        const dist = (lat - (a + c) / 2) ** 2 + (lon - (b + d) / 2) ** 2;
        if (dist < bestD) { bestD = dist; best = m; }
    }
    return best;
};
// The line counts down to the next model update, estimated from the
// current run's own publish lag. Once that estimate passes by more than
// this grace, the update is genuinely overdue → warn amber.
const NEXT_UPDATE_GRACE = 60 * 60 * 1000;
// The status line is the app's single state channel. A transient
// message (a copy confirmation, a geolocation error, "Back online")
// lives this long, then the line reverts to its resting freshness job.
const STATUS_TRANSIENT_MS = 2200;
// How long the post-update "New version · see ⚙" note owns the status
// line before reverting to freshness. A touch longer than a plain
// confirmation, since it invites an action (open What's new).
const WHATS_NEW_MS = 4000;
// A service-worker update seen within this window of load is the cache
// catching up to the network-first HTML we already run, not a newer
// build, so it is not reload-worthy (see the SW block). Generous so a
// slow first install can't cross it; genuine mid-session deploys land
// minutes later, well past it.
const SW_SETTLE_MS = 10 * 1000;
// Don't re-check sw.js more often than this on refocus.
const SW_CHECK_THROTTLE = 15 * 60 * 1000;
// Staleness escalation is normally tied to the model's
// cadence (a missed next-release, see forecastOverdue). This 24h age is
// only the fallback used when no model metadata is available to reason
// about cadence, so a day-old forecast still escalates to the amber
// dated warning instead of the calm grey "outdated".
const DEEP_STALE_TIME = 24 * 60 * 60 * 1000;
// Change detection: per-view "meaningfully moved" thresholds. A cell
// whose forecast moved at least this much since the previous model
// run pulses once in the matching view; the was/now detail rides
// the tooltip. Per-view because a single pop-based rule would leave
// the temp and wind views inert.
const CHANGE_POP = 30;  // percentage points of rain probability
const CHANGE_TEMP = 3;  // °C
const CHANGE_WIND = 15; // km/h
const DEFAULT_PLACE = {
    name: 'Whakatane', country: 'New Zealand', admin1: 'Bay of Plenty',
    latitude: -37.9586, longitude: 176.9854
};
const LS_PLACE = 'mr-place';
// Per-place cache prefix. Entries live at mr-forecast:<placeKey>
// → {timestamp, payload}, so switching cities paints instantly.
const LS_FORECAST = 'mr-forecast';
const LS_CITIES = 'mr-cities';   // saved search shortcuts, MRU, max 12
const LS_SETTINGS = 'mr-settings';
const LS_VIEW = 'mr-view';       // 'rain' | 'temp' | 'wind' grid mode
const LS_INSTALL = 'mr-install-dismissed';
const LS_FAVORITES = 'mr-favorites'; // explicit ★ favorites (capped, user-curated)
const LS_META = 'mr-model-meta';     // cached global model-run metadata (run time + cadence)
const LS_META_LOCAL = 'mr-model-meta-local'; // cached regional model meta, keyed by model slug
const LS_VERSION = 'mr-version';     // build id last seen on this device (drives the post-update note)
// City-local date the day note last popped for. One date, not a set: the
// note is once a day and there is nothing to remember about the days before
// it. Keyed by date rather than by place, so switching city does not earn a
// second one.
const LS_DAY_NOTE = 'mr-day-note';
// The running build's id. build.mjs swaps __APP_VERSION__ for sw.js's
// CACHE_NAME at publish, so the version lives in one place. An unbuilt dev
// copy keeps the literal token, so the post-update note just never fires.
const APP_VERSION = '__APP_VERSION__';
const MAX_CITIES = 12;   // cap on recent cities (MRU-evicted); favorites are separate
// Max pinned (★) favorites in primary's switcher. Used to be 9 back when
// the switcher only held favorites; the sheet now also carries a
// transient tier and two anchor rows, so 9 pinned would mean 14 rows
// total, more than fits in one thumb sweep. 5 pinned + 3 transient + 2
// anchors = 10, matching the old list's reach.
//
// The cap only blocks adding new favorites. Anyone already holding more
// keeps them until they unpin one.
//
// classic shares the same `mr-favorites` storage (via toggleFavorite /
// flashFavHint) and is bound by this cap too, even without referencing
// the constant directly.
const MAX_FAVORITES = 5;
// Second, unpinned tier in primary's switcher: cities looked up but not
// saved. Capped at 3 so the whole sheet still fits one thumb sweep.
const MAX_TRANSIENT = 3;
// Total visible rows across all tiers. 5 pinned + 3 transient + 2 anchor
// rows = 10, which doesn't fit: at 44px/row that's 440px versus the
// ~335px of list height available on the smallest supported phone.
//
// Overflow used to drop from the bottom, which cut the two anchor rows
// (the current city and the one before it) — the rows nearest the thumb
// and the ones the swipe gesture moves between. It now drops from the
// top instead, since those rows are scrolled past anyway.
//
// This is a render cap, not a storage one: MAX_FAVORITES only blocks
// adding, so anyone who pinned more before the cap was lowered still has
// them and can still overflow the list. `openSheet` scrolls the list to
// the bottom in that case, so the current city stays visible.
const MAX_SHEET_ROWS = 8;
// How long an unpinned (transient) city stays in the switcher before
// expiring. Long enough to survive a restart mid-trip, short enough that
// it doesn't become a second favorites list.
const TRANSIENT_TTL_MS = 72 * 60 * 60 * 1000;
// ⌘ on Apple platforms, Ctrl elsewhere, for the shortcut hint label.
const MOD = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
