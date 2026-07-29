// primary/config.js: the variant's frame geometry.
//
// Loaded before shared/, because the shared core reads FORECAST_DAYS
// (shared/api.js builds the request URL from it, shared/cache.js stamps
// and checks it). Everything else this variant declares lives in app.js.

// The grid frame never changes size. Both DR-29 reveals slide a fixed
// window over more data instead of growing the grid.
const DAY_SPAN = 7;      // columns in the frame, at rest and revealed
const DAY_OFF_MAX = 7;   // drawer's hard cap: leftmost column = lead day 7,
                         // so the rightmost is lead day 13, the 14th day
// The fetch horizon is derived from the cap rather than set beside it, so
// the two can never drift: everything the drawer can reach, plus the
// rollover spare the app has always carried (at local midnight the past
// day drops out and the spare slides in, so the window stays full without
// waiting on the network).
const FORECAST_DAYS = DAY_SPAN + DAY_OFF_MAX + 1; // 15
