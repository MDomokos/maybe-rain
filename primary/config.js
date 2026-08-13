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

// How far back the drawer may reach, in days before today. Two covers
// last night and the night before, which is the span the question "did
// it rain overnight, and how much?" is asked over. Longer spans are a
// climatology question and the archive API answers those better.
//
// shared/forecast.js trims the parsed days to this rather than showing
// whatever the payload contains. A payload fetched three days ago still
// holds three past days, so without the trim the reach behind today
// would vary with how long ago the app was last opened.
const PAST_DAYS = 2;

// Which sky model paints the rain view's base (DR-38). 'radiance' is the
// two-axis model: clearness sets brightness, sunshine sets how gold.
// 'wmo' is the DR-14 bucket palette, kept runnable in classic as the
// reference implementation. Read at load by shared/colors.js, which is
// why it lives here rather than in app.js.
const SKY_MODEL = 'radiance';
