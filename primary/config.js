// primary/config.js: the variant's frame geometry.
//
// Loaded before shared/, because the shared core reads FORECAST_DAYS
// (shared/api.js builds the request URL from it, shared/cache.js stamps
// and checks it). Everything else this variant declares lives in app.js.

// DR-39: the day axis is elastic. The home week is what the screen rests
// on; a sideways pull accordions further days in from the side they sit
// on, and the home week squishes to pay for them. The frame therefore
// holds every day the pull can reach, all the time, and what moves is the
// columns' widths.
const DAY_SPAN = 7;        // the home week: today plus six, the resting frame
const FUTURE_REACH = 7;    // days the pull can bring in beyond the home week,
                           // so the far end is lead day 13, the 14th day

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

// Every column the elastic can hold at once: the two past days, the home
// week, and the seven days beyond it. Built once per view or city change
// and never rebuilt inside a gesture (DR-39).
const DAY_TOTAL = PAST_DAYS + DAY_SPAN + FUTURE_REACH; // 16
// The fetch horizon is derived from the reach rather than set beside it,
// so the two can never drift: everything the pull can reach, plus the
// rollover spare the app has always carried (at local midnight the past
// day drops out and the spare slides in, so the window stays full without
// waiting on the network).
const FORECAST_DAYS = DAY_SPAN + FUTURE_REACH + 1; // 15

// Which sky model paints the rain view's base (DR-38). 'radiance' is the
// two-axis model: clearness sets brightness, sunshine sets how gold.
// 'wmo' is the DR-14 bucket palette, kept runnable in classic as the
// reference implementation. Read at load by shared/colors.js, which is
// why it lives here rather than in app.js.
const SKY_MODEL = 'radiance';
