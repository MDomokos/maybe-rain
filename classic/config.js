// classic/config.js: the variant's frame geometry.
//
// Loaded before shared/, because the shared core reads FORECAST_DAYS
// (shared/api.js builds the request URL from it, shared/cache.js stamps
// and checks it). Everything else this variant declares lives in app.js.

// Classic shows one fixed week and has no day drawer, so it only ever
// paints lead days 0-6 plus the rollover spare, 8 days of the payload.
//
// It still fetches the same 15 days as primary. Both variants share the
// mr-forecast:<placeKey> cache, and a shared cache holding two different
// horizons is asymmetric in both directions: primary reading a classic
// entry sees a short horizon and forces a network revalidation on every
// load of that place, while classic reading a primary entry holds it for
// about 15 days instead of 7 before forecastExpired fires. Matching the
// horizon makes staleHorizon permanently false in both variants and the
// expiry window correct in both. It costs a larger payload than classic
// displays. In return, switching variants paints from cache with no extra
// fetch and no drift in the stale window.
const FORECAST_DAYS = 15;
