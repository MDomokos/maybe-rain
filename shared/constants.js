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
// DR-7: the status line is the app's single state channel. A transient
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
// DR-6/DR-7: staleness escalation is normally tied to the model's
// cadence (a missed next-release, see forecastOverdue). This 24h age is
// only the fallback used when no model metadata is available to reason
// about cadence, so a day-old forecast still escalates to the amber
// dated warning instead of the calm grey "outdated".
const DEEP_STALE_TIME = 24 * 60 * 60 * 1000;
// DR-6 layer 2: per-view "meaningfully moved" thresholds. A cell
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
// DR-6: per-place cache prefix. Entries live at mr-forecast:<placeKey>
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
// The running build's id. build.mjs swaps __APP_VERSION__ for sw.js's
// CACHE_NAME at publish, so the version lives in one place. An unbuilt dev
// copy keeps the literal token, so the post-update note just never fires.
const APP_VERSION = '__APP_VERSION__';
const MAX_CITIES = 12;   // cap on recent cities (MRU-evicted); favorites are separate
// Cap on ★ favorites — the pinned tier in primary's switcher. Nine was
// DR-32's figure, set when the switcher held favorites and nothing else;
// primary's sheet now carries a transient tier and two anchor rows on top
// of them, and nine pinned would put it at fourteen rows, well past the
// one thumb sweep the gesture is built around. Five pinned plus three
// transient plus the two anchors is ten, which is the same reach the old
// nine-row list had.
//
// The cap only gates ADDING. Anyone already holding more keeps them and
// simply cannot pin another until they unpin one, which is the same rule
// the cap has always enforced, just from a different number.
//
// classic is bound by it too — it never names the constant, but it reaches
// it through toggleFavorite and flashFavHint, and the two variants share
// one `mr-favorites` under one origin. So this is a real change to classic
// as well, and the honest reading is that one list cannot have two caps.
const MAX_FAVORITES = 5;
// primary's switcher carries a second, transient tier below the pinned
// one: the cities you looked up rather than the ones you keep. Three,
// because the whole sheet has to stay inside one thumb sweep, and three
// unpinned places is already more than a trip usually needs at once.
const MAX_TRANSIENT = 3;
// The whole switcher, every tier together. Five pinned plus three transient
// plus the two anchors is ten, and ten does not fit: at 44px a row, ten rows
// is 440px of list, and the sheet only ever gives the list about 335 of it.
// The overflow fell off the BOTTOM, taking `back` and `here` with it — the
// two rows the gesture is built to move between, and the two nearest the
// thumb. A list that drops its cheapest rows to keep its most expensive ones
// has the trade exactly backwards.
//
// Eight is the figure because of reach rather than pixels. Nine fit on a
// 6.1" phone and eight on the smallest one still worth supporting, but the
// swipe is a single unbroken gesture that starts at the very bottom of the
// screen, and the sheet at its full height already reaches the top of the
// thumb's arc. Rows past the eighth are ones you can see and cannot
// comfortably swipe to, which is a worse failure than not showing them.
//
// The tiers are not each capped to fit; the TRANSIENT tier absorbs it. Its
// rows are the disposable ones — they expire on their own after
// TRANSIENT_TTL_MS — where a pinned city is a thing someone chose to keep,
// and MAX_FAVORITES is a number the interface has already told them. So the
// squeeze falls on the tier that costs nothing, oldest first and silently.
//
// This is a render cap, not a storage one, and it cannot be relied on alone:
// MAX_FAVORITES only gates ADDING, so anyone who pinned more before the cap
// dropped still has them and can still overflow the list. `openSheet` pins
// the list's scroll to the bottom for that case, so what is lost is lost off
// the far end.
const MAX_SHEET_ROWS = 8;
// How long a place stays in that tier without being visited. A trip
// spans days, so it survives a restart; a week later it is not "recent"
// by any reading, and a tier that never expires is just a worse
// favourites list that nobody asked for.
const TRANSIENT_TTL_MS = 72 * 60 * 60 * 1000;
// ⌘ on Apple platforms, Ctrl elsewhere, for the shortcut hint label.
const MOD = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
