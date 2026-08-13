// ---------------------------------------------------------------
// Maybe Rain? A single-file weather app.
// Data: Open-Meteo (keyless, true hourly, 7 days, city-local time).
// ---------------------------------------------------------------

// --- The reveal windows (DR-29) ----------------------------------
// The grid frame never changes size. Both reveals slide a fixed window
// over more data instead of growing the grid: the viewport is already
// full at 7x16, so more rows or columns could only come out of block
// size, and shrinking blocks to fit a temporary look degrades the
// resting glance to pay for it. A block therefore always holds exactly
// one hour, never a blend of two.
// DAY_SPAN, DAY_OFF_MAX and FORECAST_DAYS live in config.js: the shared
// core reads the horizon, so it has to be declared before shared/ loads.
const HOUR_SPAN = HOUR_END - HOUR_START + 1; // 16 slots
// Both offsets are transient view state, never persisted: the app always
// opens on the default week and the default hours (principle 2).
let dayOff = 0;   // lead day of the leftmost column; latched by the drawer
let hourOff = 0;  // whole hours the hour window has slid; springs back
// Bumped whenever dayOff/hourOff changes for a reason OTHER than the
// home-tween's own tick (a fresh drag, a step, a reset), so a tween
// already in flight notices it has been superseded and stops touching
// the offset instead of fighting whatever set it next.
let dayHomeGen = 0, hourHomeGen = 0;

// `dayOff` counts days from TODAY, not from the start of state.data: 0
// is today-first, positive reaches forward into the forecast, negative
// reaches back into the past days processData keeps. Measuring from
// today is what keeps the home model intact now that the array no longer
// begins at today. `!dayOff` still means home, `dayHome` still tweens to
// 0, and the ⌂ chip still shows whenever the frame is off today, with no
// second variable for where home sits.
//
// How far the drawer may reach either way. Capped by the data in hand as
// well as by the configured limits, so a short or stale cached payload
// cannot be stepped into columns that do not exist (principle 4).
const maxDayOff = () =>
    Math.max(0, Math.min(DAY_OFF_MAX, state.data.length - state.todayIndex - DAY_SPAN));
// Backward is bounded by the past days actually parsed. An entry that
// predates past_days has todayIndex 0 and no reach behind it, so the
// drawer behaves as it did before this shipped until the first
// revalidation lands; staleHorizon forces that on the next load.
const minDayOff = () => -Math.min(PAST_DAYS, state.todayIndex);
// Hour peek travel, in whole hours, either side of the default window.
// Clamped so the window can never leave the real day: earliest slot
// 00:00, latest 23:00. In 24-hour mode the window already fills the day,
// so the range collapses to zero and the peek has nothing to reveal.
const hourPeekRange = () => settings.allHours
    ? { min: 0, max: 0 } : { min: -HOUR_START, max: 24 - HOUR_SPAN - HOUR_START };

const hourRange = () => {
    if (settings.allHours) return { start: 0, end: 23 };
    const { min, max } = hourPeekRange();
    const s = HOUR_START + Math.max(min, Math.min(max, hourOff));
    return { start: s, end: s + HOUR_SPAN - 1 };
};

// The window rendered: 7 columns from the current day offset, across the
// current hour window. Kept as a function so its callers still read
// { start, end, days } unchanged; `off` is the day the frame starts on.
//
// `off` stays an ABSOLUTE index into state.data/state.days, which is how
// every caller already reads it: updateDisplay and buildCols slice with
// it, renderTimes compares today's absolute index against it to decide
// whether there is a "now" on screen, and buildCols stamps
// `off + dayIndex` into data-day so a tooltip opened with the drawer out
// reads the right day back. Only `dayOff` changed meaning, so the
// conversion happens here and nowhere else.
const visibleWindow = () => {
    const { start, end } = hourRange();
    const rel = Math.max(minDayOff(), Math.min(maxDayOff(), dayOff));
    return { start, end, days: DAY_SPAN, off: state.todayIndex + rel };
};

// The drawer's ⌂ chip is the only thing either reveal ever draws, and it
// exists only while the drawer is away from today. At rest both reveals
// are invisible and the screen is unchanged.
let revealTimer = null;
// The go-home fn (`dayHome` or `springHours`) the last `armRevealIdle`
// call armed, kept even while `revealTimer` itself is paused for an
// open tooltip. See `armRevealIdle` and `showTooltip`/`hideTooltip`
// below. Shares the single timer's "last one armed wins" model rather
// than tracking the two axes independently, same as `revealTimer`
// already did before this existed.
let pendingRevealFn = null;
const renderDayHome = () => {
    const chip = $('dayHome');
    chip.hidden = !dayOff;
    chip.textContent = dayOff ? '⌂' : '';
};
// Send both windows home without repainting, for callers that are about
// to repaint anyway (a view or city change, which own the whole grid).
// Neither offset is ever persisted, so the app always opens on the
// default week and the default hours (principle 2).
const resetReveal = () => {
    clearTimeout(revealTimer);
    pendingRevealFn = null;
    dayHomeGen++; hourHomeGen++;
    dayOff = 0; hourOff = 0;
    renderDayHome();
};
const applyBand = () => {
    const w = visibleWindow();
    document.documentElement.style.setProperty('--band', `${100 / (w.end - w.start + 1)}%`);
};

// --- UI state ---------------------------------------------------
// DR-7: the freshness line under the grid (#status) is the app's one
// place for all app-level state. It has two layers. The *resting* layer
// (updateStatus) is its home state: model run + next update, or offline,
// outdated, deep-stale, or no-data. The *transient* layer briefly
// overlays it (a copy confirmation, a geolocation error, "Back online")
// and then clears back down on its own via one shared timer, so a
// "copied" message never sits stranded. Every user-visible message goes
// through here: no alert, toast, or second banner anywhere.
let statusTimer = null;
// Separate from statusTimer: the post-update note re-shows itself on every
// repaint inside this window (so a fetch/paint can't clobber it), then
// clears. A shared transient timer can't express "re-show while active".
let whatsNewTimer = null;
const setStatus = (text, cls = '', opts = {}) => {
    const el = $('status');
    // Any new status cancels a pending auto-clear first, so transient
    // messages never stack or clear early.
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    // A leading "↻ " marks the refresh/update CTA: draw it as the
    // refresh icon, then the (escaped) label. Every other message is
    // plain text via textContent, so no markup can slip in.
    const cta = text.startsWith('↻ ');
    const label = cta ? text.slice(2) : text;
    if (cta) el.innerHTML = `<span class="status-icon">${MR_ICON.refresh}</span>${esc(label)}`;
    else el.textContent = text;
    el.className = `status ${cls}`.trim();
    // It's a button now, so always name the refresh action; updateStatus
    // overrides with a richer description for the run line.
    el.setAttribute('aria-label', label ? `${label}. Refresh forecast` : 'Refresh forecast');
    // Transient messages (opts.transient) carry a ~2s life, after which
    // the line reverts to whatever the resting layer now says. Resting
    // states are set without the flag and persist until their own
    // condition changes.
    if (opts.transient) {
        statusTimer = setTimeout(() => { statusTimer = null; updateStatus(); }, STATUS_TRANSIENT_MS);
    }
};

// Shared time-axis labels (real grid and skeleton alike).
// (i + 0.5) * band% = vertical middle of hour band i, so each label
// sits level with its row of blocks. Every hour is labelled.
// Side "now" indicator: when today's column and the current
// hour are both on screen, that hour's label becomes a gold marker
// with the current temp; no temp data, arrow only (never a guess).
const renderTimes = () => {
    const { start, end, days, off } = visibleWindow();
    const rows = end - start + 1;
    const band = 100 / rows;
    const step = 1;
    const now = cityNow().hour;
    const ti = state.days.findIndex(d => d.isToday);
    // Today has to be inside the *shown* columns as well as the shown
    // hours: with the day drawer open past today, or the hour window
    // peeked away from the current hour, there is no now to mark.
    const hasNow = ti >= off && ti < off + days && now >= start && now <= end;
    // Separator lines run above every labeled row except the first
    // (that boundary is the grid's own top edge, left bare) so the
    // grid's top and bottom stay free of lines.
    let firstLabel = true;
    $('times').innerHTML = Array(rows).fill().map((_, i) => {
        const h = start + i;
        if (hasNow && h === now) {
            // Current hour: the label becomes the exact current time to the
            // minute (white bold). The white bar on today's current block
            // is the graphic marker; no triangle, no temp duplication.
            const sep = firstLabel ? '' : `<div class="hour-sep" style="top:${i * band}%;"></div>`;
            firstLabel = false;
            return `${sep}<div class="time-label now" style="top:${(i + 0.5) * band}%;"
                         aria-label="Now">${runClockLabel(Date.now())}</div>`;
        }
        if (h % step) return '';
        const sep = firstLabel ? '' : `<div class="hour-sep" style="top:${i * band}%;"></div>`;
        firstLabel = false;
        return `${sep}<div class="time-label" style="top:${(i + 0.5) * band}%;">${hourLabel(h)}</div>`;
    }).join('');
};

// Placeholder grid while no forecast is available yet.
// Colorless by design (no fake weather): a dim pulse across the
// week, replaced in place by real data.
const renderSkeleton = () => {
    const { start, end, days } = visibleWindow();
    const rows = end - start + 1;
    $('days').innerHTML = Array(days).fill('<div class="day-label">–</div>').join('');
    $('temps').className = `temp-row${settings.unit === 'F' ? ' unit-f' : ''}`;
    $('temps').innerHTML = Array(days).fill(
        `<div class="temp-item"><span class="temp-max">–</span><span class="temp-sep">/</span><span class="temp-min">–</span></div>`
    ).join('');
    renderTimes();
    $('locationNow').textContent = ''; // no data yet, no readout
    $('sunLines').innerHTML = ''; // no data, no lines
    $('grid').innerHTML = Array(days).fill().map((_, d) =>
        `<div class="day-column">${
            `<div class="weather-block skeleton" style="animation-delay:${(d * 0.12).toFixed(2)}s"></div>`.repeat(rows)
        }</div>`
    ).join('');
};

const setLoading = loading => {
    state.loading = loading;
    if (!loading) return;
    if (!state.data.length) {
        // Nothing to show yet: skeleton grid + explicit indicator.
        renderSkeleton();
        setStatus('Loading forecast…', 'updating');
    } else {
        // Stale data stays on screen; just hint at the background refresh.
        setStatus('Updating…', 'updating');
    }
};

// No separate error banner: the freshness label carries the failure
// and doubles as the retry button (tap/click to refetch). The message
// is remembered so updateStatus can restate it (it holds until a fetch
// succeeds, since nothing else can render). Resting layer, no timer.
const showError = (msg = 'No data. Tap to retry') => {
    state.loading = false;
    state.lastError = msg;
    updateStatus();
};

// City-local calendar parts for any instant (date + hour + minute),
// using the forecast's IANA timezone so times match the grid. One
// cached formatter, rebuilt only when the timezone changes (every
// forecast response may overwrite state.tz), serves both this and
// cityNow instead of each rebuilding its own.
let cityFmt = null, cityFmtTz = null;
const cityParts = ms => {
    if (cityFmtTz !== state.tz) {
        cityFmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: state.tz, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        });
        cityFmtTz = state.tz;
    }
    const parts = cityFmt.formatToParts(new Date(ms));
    const g = t => parts.find(p => p.type === t).value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, h: +g('hour'), m: +g('minute') };
};
// "Now" in the city's timezone: date + hour only (the grid keys the
// current block on cityNow().hour). Folded onto cityParts so there is
// one city formatter, not two.
const cityNow = () => { const p = cityParts(Date.now()); return { date: p.date, hour: p.h }; };
// Clock time of an instant, in the user's 12/24h style (reuses timeLabel
// so it matches the grid's own axis labels).
const runClockLabel = ms => { const p = cityParts(ms); return timeLabel(p.h, p.m); };
// Expected next-release clock time; adds a day hint when it lands after
// midnight (the interval is at most a few hours, so "tomorrow" covers it).
const nextTimeLabel = ms => {
    const p = cityParts(ms);
    const label = timeLabel(p.h, p.m);
    return p.date === cityParts(Date.now()).date ? label : `${label} tomorrow`;
};
// Coarse "time until" for the tooltip/aria (Minutes < 1h, hours < 1d).
const relFuture = ms => {
    const min = Math.round(ms / 60000);
    if (min < 60) return `in ${Math.max(1, min)}m`;
    const h = Math.round(min / 60);
    if (h < 24) return `in ${h}h`;
    return `in ${Math.round(h / 24)}d`;
};

// Absolute "Tue 14:00" stamp (city-local) for the deep-stale warning.
const WEEKDAY_3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const staleStamp = ms => {
    const p = cityParts(ms);
    return `${WEEKDAY_3[dowOf(p.date)]} ${timeLabel(p.h, p.m)}`;
};

// DR-7 resting layer: updateStatus computes the line's home state and is
// the tie-break when several conditions are true. Priority, highest
// first: (1) no-data error (nothing can render, so it holds until a
// fetch succeeds); (2) offline with a forecast on screen (name the
// honest state, principle 4); (3) a waiting app version (reload CTA);
// (4) deep-stale / out-of-date CTA; (5) the normal freshness line (model
// run + next update, else the fetch-time fallback). In-flight notices
// ("Loading forecast…", "Updating…", "Locating…") outrank this layer and
// are set directly; they clear when their process ends, which re-runs
// updateStatus on success or drops to the relevant resting state.
// Staleness is measured against the model's own cadence, not a wall
// clock (owner-directed): the forecast is "overdue" once the next
// expected model release has come and gone (by more than the grace),
// i.e. a newer forecast should exist, whether or not we can reach it.
// With no model metadata to reason about cadence, fall back to a 24h
// age. stampMs dates the forecast we're showing: the model run when
// known, else our fetch time.
const forecastOverdue = () => state.modelRun
    ? Date.now() - state.modelRun.nextUpdate > NEXT_UPDATE_GRACE
    : !!state.fetchedAt && Date.now() - state.fetchedAt > DEEP_STALE_TIME;
const forecastStampMs = () => state.modelRun ? state.modelRun.init : state.fetchedAt;

const updateStatus = () => {
    // A resting repaint means the brief "New version" note is no longer
    // up, so its tap-opens-changelog mode ends here.
    state.updateNote = false;
    // (1) No data at all: the retry CTA holds. While actively loading,
    // "Loading forecast…" owns the line, so leave it be.
    if (!state.data.length) {
        if (state.loading) return;
        setStatus(state.lastError || 'No data. Tap to retry', 'stale');
        return;
    }
    const overdue = forecastOverdue();
    // (2) Offline with a forecast on screen. While the data is still
    // within its model cycle, the calm grey notice is honest enough.
    // Once a release has been missed it escalates to amber and dates the
    // forecast, so "how stale" is visible even with no way to refresh.
    if (!state.online) {
        const stampMs = forecastStampMs();
        if (overdue && stampMs) {
            const stamp = staleStamp(stampMs);
            // Show *when* the shown data is from: offline for a long
            // time, the stamp is the real signal of how stale it is.
            // The amber pill already reads as the warning; the stamp
            // carries the age. Fits a phone row in 12h and 24h forms.
            setStatus(`Offline · from ${stamp}`, 'outdated');
            $('status').setAttribute('aria-label',
                `Offline. The forecast is stale, from ${stamp}; a newer model run is due. It will refresh when the connection returns.`);
        } else {
            setStatus('Offline · last forecast', 'stale');
        }
        return;
    }
    // (3) A newer app version is waiting: one reload CTA, styled like the
    // outdated pill, in this same line instead of a separate banner.
    if (state.swUpdate) {
        setStatus('↻ Update app', 'outdated');
        $('status').setAttribute('aria-label',
            'A new version of the app is available. Tap to reload.');
        return;
    }
    // Post-update note. A build we hadn't seen before is now running (the
    // update already landed, via network-first HTML or a prior reload):
    // point at what changed. Fired from here, the resting layer, so it
    // only appears once the line is at a clean freshness state (data
    // present, online, not overdue) and waits behind no-data / offline /
    // reload / overdue states, which outrank it. It owns the line for
    // WHATS_NEW_MS and is re-shown on every repaint inside that window,
    // so a cache paint or the startup revalidation can't clobber it (the
    // fix for it showing inconsistently); then it clears back to
    // freshness on its own. whatsNewPending is armed once per new build.
    if (state.whatsNewPending && !overdue) {
        if (!whatsNewTimer) {
            whatsNewTimer = setTimeout(() => {
                whatsNewTimer = null;
                state.whatsNewPending = false;
                state.updateNote = false;
                updateStatus();
            }, WHATS_NEW_MS);
        }
        state.updateNote = true; // a tap now opens the changelog (What's new)
        setStatus('New version · see ⚙', 'outdated');
        $('status').setAttribute('aria-label', 'New version available. Open what\'s new, also under the settings menu');
        return;
    }
    // (4) The normal freshness line reports the weather model's *run*
    // time (when the forecast was computed, not when we fetched it) and
    // the time until the next model update. When that update is overdue
    // it warns amber. Falls back to fetch time if the metadata API
    // hasn't answered.
    const m = state.modelRun;
    if (m) {
        const toNext = m.nextUpdate - Date.now();
        const loc = state.localRun;
        if (overdue) {
            // A newer run should be out, so present an explicit refresh CTA.
            setStatus('↻ Update forecast', 'outdated');
            $('status').setAttribute('aria-label',
                `Forecast out of date (global model last run ${runClockLabel(m.init)}). Refresh to update.`);
        } else if (loc) {
            // Two-model line: the regional high-res model drives the
            // near-term hours and refreshes more often; the global run
            // covers the full 7-day horizon. Show both run times so
            // "how fresh" is honest for each. Overdue stays tied to the
            // global cadence (above), since it governs the whole grid.
            setStatus(`Local ${runClockLabel(loc.init)} · Global ${runClockLabel(m.init)}`, '');
            const toLoc = loc.nextUpdate - Date.now();
            $('status').setAttribute('aria-label',
                `Forecast freshness: ${loc.label} local model last run at ${runClockLabel(loc.init)}` +
                (toLoc > 0 ? ` (next update ~${nextTimeLabel(loc.nextUpdate)})` : ' (update due)') +
                `; global model last run at ${runClockLabel(m.init)}` +
                (toNext > 0 ? ` (next ~${nextTimeLabel(m.nextUpdate)})` : ' (update due)') +
                '. Click to refresh.');
        } else {
            const tail = toNext > 0 ? `next ~${nextTimeLabel(m.nextUpdate)}` : 'update due';
            setStatus(`Run ${runClockLabel(m.init)} · ${tail}`, '');
            $('status').setAttribute('aria-label',
                `Forecast freshness: weather model last run at ${runClockLabel(m.init)}; ` +
                (toNext > 0
                    ? `next update expected around ${nextTimeLabel(m.nextUpdate)} (${relFuture(toNext)}). `
                    : 'next update is due. ') +
                'Click to refresh.');
        }
        return;
    }
    // Fallback: no model metadata yet → fetch-time wording. Past the 24h
    // fallback (overdue with no cadence), escalate to the amber dated
    // warning, matching the model-driven path above.
    if (!state.fetchedAt) { setStatus(''); return; }
    const age = Date.now() - state.fetchedAt;
    const minutes = Math.floor(age / 60000);
    if (age < 60000) {
        setStatus('Data is fresh', 'fresh');
    } else if (overdue) {
        const stamp = staleStamp(state.fetchedAt);
        setStatus('↻ Update forecast', 'outdated');
        $('status').setAttribute('aria-label',
            `Forecast is stale, last updated ${stamp}. Tap to refresh.`);
    } else if (age > FRESH_TIME) {
        setStatus('Data may be outdated', 'stale');
    } else {
        setStatus(`Updated ${minutes} minute${minutes !== 1 ? 's' : ''} ago`);
    }
};

const renderLocation = () => {
    document.title = state.place.name;
    $('location').classList.remove('locating');
    // Set the inner span (not .location itself) so the ellipsis rule
    // applies and the ↓ arrow pseudo-element is preserved.
    $('locationName').textContent = state.place.name;
};
// Current-hour temperature shown inline in the header. Independent of
// the grid's visible hour window (all hours live in state.data), so it
// still answers "what is it right now?" at night when the current hour
// sits outside the 06:00–21:00 grid. Empty when there's no today column
// or no reading for this hour; :empty CSS then collapses the node.
const renderNowTemp = () => {
    const ti = state.days.findIndex(d => d.isToday);
    const t = ti >= 0 ? state.data[ti]?.find(x => x.hour === cityNow().hour)?.temp : null;
    $('locationNow').textContent = t != null ? `${displayTemp(t)}°` : '';
};
// First-visit holding state, shown while the timezone guess resolves so
// the hardcoded default never flashes before the real nearby city. The
// .locating class hides the ↓ arrow; the title stays generic (no city).
const renderLocating = () => {
    document.title = 'Maybe Rain?';
    $('location').classList.add('locating');
    $('locationName').textContent = 'Locating…';
    $('locationNow').textContent = '';   // no reading yet
};

// --- Render ------------------------------------------------------
// --- Pixel grid painter --------------------------------------------
// One primitive drives every grid transition: a cell blinks to black,
// then to its (new) colour. Motion is implied purely by the ORDER of
// those blinks; pixels never move. `anim` selects the order:
//   null                     instant, no blink (cached paint, prefs)
//   {type:'reveal'}          column sweep left→right, no black (first load)
//   {type:'wave',axis,dir}   directional wave (city = 'y', view = 'x');
//                            dir +1 fills from index 0, −1 from the last
//   {type:'refresh'}         only changed cells blink, scattered (poll)
// A random per-cell jitter is added so repeats never reveal identically.
//
// DR-32 (2026-07-28): the schedule used to be fire-and-forget, one
// setTimeout per cell handing the rest to a CSS background-color
// transition. That cannot express the two things the detented city
// selector needs, because once the timeouts are queued the timeline
// belongs to CSS and there is nothing left to read: a sweep must be
// RETARGETABLE mid-flight (the finger crosses another detent, so cells
// already flipped repaint to the newer city while cells the sweep has
// not reached carry on toward the old one) and it must RUN BACKWARDS
// (the finger reverses, so the sweep rewinds to the city on screen
// before setting off the other way with the stagger flipped).
//
// So the schedule is now a PLAYHEAD: per-cell delays are computed once
// into an array and a single rAF ticker advances one clock `t` across
// them. Retarget = swap `to`, keep `t` and the delays. Rewind = run `t`
// down. Nothing else about the animation changes: the same delays, the
// same 45/45/110 black/hold/colour envelope, so it looks like the wave
// that already shipped. Because the delays are stored rather than
// recomputed per frame, the per-cell Math.random() jitter above stays
// stable for the life of a sweep without needing a positional hash.
let nextRevealAnim = null; // directional/first hint for the next fresh paint
let gridTimers = [];       // pending blink timeouts, all cancelled on the next paint
let pendingRefresh = null; // a refresh deferred until a running sweep settles
const GRID_BLACK_MS = 45, GRID_HOLD_MS = 45, GRID_COLOR_MS = 110;
const CELL_MS = GRID_HOLD_MS + GRID_COLOR_MS;  // one cell's whole blink; see cellPhase
const REWIND_RATE = 1.7;  // a rewind is quicker than a completion (DR-30)
const rankStep = n => Math.min(23, 160 / Math.max(1, n - 1));

const cellDelay = (anim, c, r, nCols, nRows, desc) => {
    if (anim.type === 'refresh') return desc.moved ? Math.random() * 220 : -1;
    if (anim.type === 'reveal') { const s = rankStep(nCols); return c * s + Math.random() * s; }
    if (anim.type === 'wave') {
        const idx = anim.axis === 'y' ? r : c;
        const n = anim.axis === 'y' ? nRows : nCols;
        const rank = anim.dir > 0 ? idx : (n - 1 - idx);
        const s = rankStep(n);
        // The vertical wave packs many rows into a short span, so it reads
        // as a tidy sweep. Extra scatter (≈2.6 ranks vs 1 for horizontal)
        // gives it the same dithered feel as the wider view switch.
        const jitter = anim.axis === 'y' ? s * 2.6 : s;
        return rank * s + Math.random() * jitter;
    }
    return -1;
};

const buildCell = desc => desc.empty
    ? '<div class="weather-block empty"></div>'
    : `<div class="weather-block${desc.current ? ' current' : ''}${desc.past ? ' past' : ''}" style="background:rgb(${desc.rgb});color:${desc.textColor}" tabindex="0" aria-label="${esc(desc.info)}" data-day="${desc.dayIndex}" data-hour="${desc.hour}" data-info="${esc(desc.info)}">${desc.marks}</div>`;

// A cell the sweep has not reached yet, or a destination with no data to
// paint. Black is the page background rather than a value in any
// palette, so it reads as ABSENT and never as a wrong number, which is
// what lets an uncached favourite be swept to honestly (DR-32: every
// rung is reachable, but only the ones with a cached forecast have
// colours to arrive at; the rest land black and fill in on fetch).
const blankDesc = { blank: true, rgb: [0, 0, 0], textColor: '#fff', marks: '', info: '', current: false, past: false, dayIndex: 0, hour: 0 };
const blankCols = (nCols, nRows) =>
    Array.from({ length: nCols }, () => Array.from({ length: nRows }, () => blankDesc));

// Swap a cell's CONTENT (marks, labels, dataset). Called once per cell
// per sweep, at the moment the playhead flips it from `from` to `to`,
// or again if the sweep is retargeted onto a different destination while
// that cell is already flipped. Never per frame: only the colour moves
// every frame, and it is set directly rather than by a CSS transition,
// because the playhead now owns the timeline.
const applyCellContent = (node, desc) => {
    if (desc.empty) {
        node.className = 'weather-block empty';
        ['tabindex', 'aria-label', 'data-day', 'data-hour', 'data-info'].forEach(a => node.removeAttribute(a));
        node.style.transition = 'none'; node.innerHTML = '';
        return;
    }
    node.className = 'weather-block' + (desc.current ? ' current' : '') + (desc.past ? ' past' : '');
    node.innerHTML = desc.marks;
    node.style.transition = 'none';
    node.style.color = desc.textColor;
    if (desc.blank) {
        ['tabindex', 'aria-label', 'data-day', 'data-hour', 'data-info'].forEach(a => node.removeAttribute(a));
        return;
    }
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', desc.info);
    node.dataset.day = desc.dayIndex;
    node.dataset.hour = desc.hour;
    node.dataset.info = desc.info;
};

// Where one cell sits on the envelope. `k` is which of the two grids it
// is showing (0 = from, 1 = to); `black` is how far it has been pulled
// toward the page background. A negative delay means "no blink": the
// cell is simply already there.
//
// This reproduces the SHIPPED timeline exactly rather than the idealised
// black/hold/colour one the constants' names suggest. The old scheduler
// started a GRID_BLACK_MS transition to black at `delay`, then waited
// GRID_HOLD_MS before applying the new colour over GRID_COLOR_MS, and
// because those two constants are both 45, the black fade finished at
// the same instant the recolour began. There was never a dwell at black.
// Adding one here would have lengthened every transition by 45ms per
// cell and moved the moment a cell changes hands, so the flip stays at
// GRID_HOLD_MS after the blackout starts.
const cellPhase = (t, delay) => {
    if (delay < 0) return { k: 1, black: 0 };
    const u = t - delay;
    if (u <= 0) return { k: 0, black: 0 };
    if (u < GRID_BLACK_MS) return { k: 0, black: u / GRID_BLACK_MS };
    const v = (u - GRID_HOLD_MS) / GRID_COLOR_MS;
    return v >= 1 ? { k: 1, black: 0 } : { k: 1, black: 1 - Math.max(0, v) };
};

// --- The playhead ---------------------------------------------------
// `from` is the grid as painted, `to` is where it is heading, `t` is the
// clock between them. When `t` completes, `to` becomes `from` and the
// clock resets, so a sweep that is retargeted again simply carries on
// from wherever it is, which is DR-32's "retargets rather than restarts"
// falling out of the model rather than being special-cased.
// Ticked on a timer rather than requestAnimationFrame, deliberately.
// `t` is advanced from real elapsed time, so the animation is
// frame-rate independent either way and the interval is only how often
// it is sampled; what a timer buys is that it cannot monopolise the
// event loop. A rAF chain that reschedules itself every frame runs as
// fast as the host will dispatch it, and under jsdom that is a tight
// loop with no vsync to pace it, which starves the timer queue outright,
// so every harness that awaits anything during a sweep hangs. The old
// scheduler this replaces was timer-driven for the same practical
// reason, and 16ms is finer than the eye needs for a 350ms wipe.
const FRAME_MS = 16;
let wave = null;      // { grid, from, to, delays, shown, dir, anim, t, total, pending }
let waveRaf = 0, waveLast = 0;
let lastCols = null;  // the grid as last painted, the `from` of the next sweep

const gridBusy = () => !!wave && wave.anim.type !== 'refresh';
const waveSweeping = w => w.to !== w.from || w.t > 0.001;

const buildDelays = (anim, from, to, nCols, nRows) => {
    const delays = new Float64Array(nCols * nRows);
    let total = 0;
    for (let c = 0; c < nCols; c++) {
        for (let r = 0; r < nRows; r++) {
            // A refresh only blinks cells whose value actually moved, so
            // it asks the DESTINATION desc whether this cell changed.
            const d = cellDelay(anim, c, r, nCols, nRows, to[c][r]);
            delays[c * nRows + r] = to[c][r].empty ? -1 : d;
            if (d > total) total = d;
        }
    }
    return { delays, total: total + CELL_MS };
};

const waveFrame = () => {
    const w = wave, kids = w.grid.children;
    let flipped = false;
    for (let c = 0; c < w.nCols; c++) {
        const colNode = kids[c];
        if (!colNode) continue;
        for (let r = 0; r < w.nRows; r++) {
            const node = colNode.children[r];
            if (!node) continue;
            const i = c * w.nRows + r;
            const ph = cellPhase(w.t, w.delays[i]);
            const desc = ph.k ? w.to[c][r] : w.from[c][r];
            // Identity, not a flag: a retarget hands us different desc
            // objects, so cells already flipped repaint to the newer
            // destination for free while unreached cells stay put.
            if (w.shown[i] !== desc) { applyCellContent(node, desc); w.shown[i] = desc; flipped = true; }
            if (desc.empty) { node.style.background = 'transparent'; continue; }
            const [cr, cg, cb] = desc.rgb, f = 1 - ph.black;
            node.style.background = ph.black > 0
                ? `rgb(${Math.round(cr * f)},${Math.round(cg * f)},${Math.round(cb * f)})`
                : `rgb(${cr},${cg},${cb})`;
        }
    }
    // DR-28: an open tooltip survives a city change and reads out the
    // new city's value for the same grid position. Only worth doing on
    // a frame where a cell actually changed hands, not on every frame
    // of the colour ramp.
    //
    // DR-30 is the one case where it must NOT happen: throughout a
    // horizontal scrub the tooltip keeps reading the COMMITTED view.
    // The two axes differ in what a half-transitioned cell means. A
    // city sweep swaps one city's number for another city's number for
    // the same reading, so either is a true value and DR-28's re-read
    // is right. A view scrub swaps the READING itself, so a cell the
    // playhead has flipped is a colour belonging to a scale the legend
    // is not showing, and printing a number for it would invent data.
    // The scrub is reversible, so until release there is no committed
    // answer to report.
    if (flipped && !w.scrub) refreshActiveTooltip();

    // DR-30: the view underline is driven off the playhead, not off the
    // finger, so the scrub, the completion and the rewind all move it by
    // the same rule. `destView` is cleared the instant the sweep lands,
    // which leaves the bar parked on the destination for `setView` to
    // take over from without a frame of it snapping back.
    if (w.destView) renderViewBar(w.total ? w.t / w.total : 0, w.destView);
};

// What is on screen RIGHT NOW, cell by cell, which mid-sweep is a mix
// of `from` and `to`, since the whole point of the stagger is that the
// two are visible at once. A sweep can be abandoned at any moment by a
// newer paint, and the next sweep has to start from what the eye can
// actually see: reporting `from` would claim the grid still shows the
// old city when half of it does not, and reporting `to` would claim a
// sweep finished that never did. Either way the next sweep starts from
// a grid that was never on screen, and cells jump.
const endWave = () => {
    const w = wave;
    lastCols = [];
    for (let c = 0; c < w.nCols; c++) {
        const col = [];
        for (let r = 0; r < w.nRows; r++) col.push(w.shown[c * w.nRows + r] || w.from[c][r]);
        lastCols.push(col);
    }
    wave = null;
    if (waveRaf) { clearTimeout(waveRaf); waveRaf = 0; }
};

const waveTick = now => {
    waveRaf = 0;
    const w = wave;
    if (!w) return;
    // The two modes must never both advance `t`. While a scrubbed drag
    // is live the finger owns the clock outright, so the paced ticker
    // stops dead here rather than running on underneath the hand. This is the
    // structural rule carried over from DR-30's prototype, whose ticker
    // returns early for exactly this reason. `hold` is NOT this: it
    // freezes a PACED sweep where it is and leaves the ticker running.
    if (w.scrub) return;
    const dt = Math.min(64, Math.max(0, now - waveLast));
    waveLast = now;
    // DR-30's rewind: the destination is KEPT and the clock runs down,
    // so cells un-flip in reverse stagger order and the transition
    // plays backwards. Distinct from DR-32's reversal below, which
    // points `to` at `from` and therefore snaps the content back and
    // only unwinds the darkness, right there, because that sweep is
    // about to set off the other way with the stagger flipped, and
    // wrong here, where the gesture is being taken back rather than
    // redirected. `to` is collapsed onto `from` at the bottom of the
    // run-back so the wave settles the ordinary way.
    if (w.rewind) {
        w.t = Math.max(0, w.t - dt * (w.rate || REWIND_RATE));
        if (w.t <= 0) { w.to = w.from; w.rewind = false; w.destView = null; }
    }
    // The paced half (DR-32): the wave runs at the shipped tempo no
    // matter how fast the finger arrived, which is what stops four
    // detents crossed in one sweep from cramming four waves into a few
    // milliseconds and strobing.
    else if (w.to !== w.from) {
        // Completion CONTINUES from wherever the playhead was left, at
        // 1x, so the remaining duration is already the distance left,
        // and a scrub released at 90% has ~10% of the wave to play and
        // finishes almost instantly. The animation followed the hand,
        // so there is little left. A toolbar tap arrives here with
        // `t` at 0 and therefore plays the whole shipped wave.
        w.t = Math.min(w.total, w.t + dt);
        if (w.t >= w.total) { w.from = w.to; w.t = 0; w.destView = null; }
    } else if (w.t > 0) {
        // A rewind is quicker than a completion, and `w.rate` is where
        // a release computes one from where the playhead was left
        // rather than taking the bare constant: an abandoned scrub is
        // floored to a visible run-back instead of snapping (see
        // `endViewScrub`). Nothing sets it on the paced path.
        w.t = Math.max(0, w.t - dt * (w.rate || REWIND_RATE));
    }
    // The playhead is at rest, so the stagger can be flipped without a
    // jump and the queued reversal can set off.
    if (w.pending && w.t <= 0.0001) {
        const p = w.pending; w.pending = null;
        w.dir = p.dir; w.to = p.cols;
        const built = buildDelays({ ...w.anim, dir: p.dir }, w.from, w.to, w.nCols, w.nRows);
        w.delays = built.delays; w.total = built.total;
    }
    waveFrame();
    if (waveSweeping(w) || w.pending) { waveRaf = setTimeout(waveStep, FRAME_MS); return; }
    if (w.hold) return;   // a drag is still holding the sweep open
    // Only a sweep that ran to its natural end settles. A sweep that is
    // superseded by another paint is abandoned in paintGrid, which
    // drops the callback with it.
    const settled = w.onSettle;
    endWave();
    if (settled) settled();
};

const waveStep = () => waveTick(performance.now());
const kickWave = () => {
    // A live scrub owns `t`; there is nothing for a ticker to advance.
    if (waveRaf || (wave && wave.scrub)) return;
    waveLast = performance.now();
    waveRaf = setTimeout(waveStep, FRAME_MS);
};

const paintGrid = (grid, cols, anim) => {
    const now = performance.now();
    const nCols = cols.length, nRows = cols[0] ? cols[0].length : 0;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animated = !!anim && !reduce;

    // A refresh that lands while a directional wave is still settling waits
    // for it to finish, so the wave never gets clipped mid-sweep. Any newer
    // navigation supersedes the queued refresh below.
    if (animated && anim.type === 'refresh' && gridBusy()) {
        if (pendingRefresh) clearTimeout(pendingRefresh);
        const left = Math.max(0, wave.total - wave.t);
        pendingRefresh = setTimeout(() => { pendingRefresh = null; paintGrid(grid, cols, anim); }, left + 16);
        return;
    }

    // Any other paint supersedes: drop a queued refresh and abandon a
    // sweep in flight so rapid navigation can't leave half-finished cells.
    if (pendingRefresh) { clearTimeout(pendingRefresh); pendingRefresh = null; }
    gridTimers.forEach(clearTimeout); gridTimers.length = 0;
    if (wave) endWave();

    // No animation (or reduced motion): rebuild the grid instantly.
    if (!animated) {
        grid.innerHTML = cols.map(cells =>
            `<div class="day-column">${cells.map(buildCell).join('')}</div>`).join('');
        lastCols = cols;
        return;
    }

    // The blink runs in place, so the DOM must already match the layout. A
    // skeleton grid (first visit) already matches and is reused. A cold
    // start (empty grid on load / reload) or a layout change first lays down
    // a black grid to reveal into, so the whole page always blinks in with
    // the same black → colour language as every other transition.
    let kids = grid.children;
    const structureOk = kids.length === nCols
        && Array.prototype.every.call(kids, (col, i) => col.children.length === cols[i].length);
    if (!structureOk) {
        grid.innerHTML = cols.map(cells =>
            `<div class="day-column">${cells.map(() => '<div class="weather-block" style="background:#000"></div>').join('')}</div>`).join('');
        kids = grid.children;
        lastCols = null;
    }
    // Skeleton cells fill via !important; freeze their grey as an inline
    // colour and drop the class so the playhead's colours take.
    Array.prototype.forEach.call(kids, colNode =>
        Array.prototype.forEach.call(colNode.children, node => {
            if (!node.classList.contains('skeleton')) return;
            node.classList.remove('skeleton');
            node.style.animation = 'none';
            node.style.background = '#1c1c1c';
        }));

    // Nothing painted before (cold start): sweep out of black.
    const from = lastCols && lastCols.length === nCols && lastCols[0].length === nRows
        ? lastCols : blankCols(nCols, nRows);
    const { delays, total } = buildDelays(anim, from, cols, nCols, nRows);
    wave = {
        grid, from, to: cols, delays, total, t: 0, nCols, nRows, anim,
        dir: anim.dir || 1, pending: null, hold: false, onSettle: null,
        // `scrub`: the finger owns `t` and the ticker stands down.
        // `rewind`: run `t` down while KEEPING the destination.
        // `rate`: a rewind speed computed at release, 0 = the constant.
        scrub: false, rewind: false, rate: 0,
        shown: new Array(nCols * nRows).fill(null)
    };
    waveFrame();
    kickWave();
};

// Retarget a running sweep, or start one, without restarting the clock.
// This is the entry point the city gesture drives: `cols` is the grid it
// is now heading for and `dir` is the sweep direction, which under DR-32
// is the sign of the FINGER's travel rather than of the list step.
// A destination on the same side retargets in flight; one on the
// opposite side is queued, so the running sweep rewinds to the grid on
// screen first and only then sets off the other way with the stagger
// flipped. Mirroring the stagger under a running playhead would make
// already-flipped cells un-flip in place, which reads as a glitch.
//
// The axis is a parameter (DR-32 left it hardcoded to 'y', because the
// city gesture was the only caller). The city sweep staggers by row and
// DR-30's view scrub staggers by column, and nothing fails loudly if
// the wrong one is passed (the sweep simply runs the wrong way across
// the grid), so it is passed explicitly at both call sites rather than
// defaulted silently. The queued-reversal rebuild in `waveTick` spreads
// `w.anim`, so keeping `wave.anim` in step below is what carries the
// axis through a reversal.
const waveTo = (grid, cols, dir, opts = {}) => {
    const axis = opts.axis || 'y';
    if (!wave || wave.grid !== grid || wave.nCols !== cols.length
        || wave.nRows !== (cols[0] ? cols[0].length : 0)) {
        paintGrid(grid, cols, { type: 'wave', axis, dir });
        if (wave) wave.hold = !!opts.hold;
        return;
    }
    wave.hold = !!opts.hold;
    if (cols === wave.to && dir === wave.dir && wave.anim.axis === axis && !wave.pending) return;
    if (waveSweeping(wave) && dir !== wave.dir) {
        wave.pending = { cols, dir };
        if (wave.to !== wave.from) wave.to = wave.from;  // rewind to what is on screen
        kickWave();
        return;
    }
    wave.pending = null;
    if (cols === wave.to && wave.anim.axis === axis) { wave.dir = dir; return; }
    const retarget = waveSweeping(wave) && wave.anim.axis === axis;
    wave.to = cols;
    if (!retarget) {
        wave.dir = dir;
        wave.anim = { type: 'wave', axis, dir };
        const built = buildDelays(wave.anim, wave.from, cols, wave.nCols, wave.nRows);
        wave.delays = built.delays; wave.total = built.total;
    }
    kickWave();
};

// DR-30: hand the playhead to the finger. `p` is 0..1 along the wave's
// own timeline, taken straight from how far the drag has travelled, so
// the transition IS the gesture rather than an animation the gesture
// triggers. Nothing here advances `t` by time.
const scrubWave = (grid, cols, dir, p, destView) => {
    // The destination only ever changes at the origin, because the view
    // scrub re-locks direction inside RELOCK_PX, so the sweep is rebuilt
    // from zero rather than retargeted. `waveTo`'s queued-reversal path
    // is a PACED behaviour: it would rewind on its own clock underneath
    // a finger that is already back at the origin.
    if (wave && wave.scrub && (cols !== wave.to || dir !== wave.dir)) {
        wave.t = 0; wave.to = wave.from; wave.pending = null;
    }
    waveTo(grid, cols, dir, { axis: 'x', hold: true });
    if (!wave) return;
    wave.scrub = true;
    wave.rewind = false;   // a new drag owns the playhead outright
    wave.destView = destView;
    // paintGrid/kickWave may have started a ticker a moment before the
    // flag was set. Stop it here rather than leaving the two to race.
    if (waveRaf) { clearTimeout(waveRaf); waveRaf = 0; }
    wave.t = Math.max(0, Math.min(wave.total, p * wave.total));
    waveFrame();
};

// Let a held sweep finish and settle on its own clock.
const waveRelease = () => { if (wave) { wave.hold = false; kickWave(); } };

// The 7x16 grid as an array of columns of cell descriptors, a pure
// function of `state` + `view` + the reveal windows. Split out of
// updateDisplay for DR-32: a city sweep needs the OUTGOING and INCOMING
// grids at the same time, so the painter can hold one on the cells the
// playhead has not reached yet. `colsForPlace` below builds one for a
// city that is not the current one.
const buildCols = () => {
    const { start, end, days, off } = visibleWindow();
    const shownDays = state.data.slice(off, off + days);
    const dayMeta = state.days.slice(off, off + days);
    const currentHour = cityNow().hour;

// The rain view is the sky base (conditionRGB) plus the streak
// overlay; temp and wind views draw their own scales.
const rainView = view === 'rain';

// DR-17 frost contour needs each cell's four neighbours (hour above /
// below in the same day, same hour in the day either side), on ACTUAL
// air temp. Null when the neighbour is off the shown window or missing
// (an honest gap), which the outline treats as the region's edge.
const lastDay = shownDays.length - 1;
const actualTemp = (di, hh) => {
    const dd = shownDays[di];
    const c = dd && dd.find(x => x.hour === hh);
    return c ? c.temp : null;
};

return shownDays.map((dayData, dayIndex) => {
    const isToday = dayMeta[dayIndex].isToday;
    // A day behind today. Carried onto every cell so the painter can
    // recede the column. A dimmed past column is the affordance for
    // the axis running backward, so no control has to announce it.
    const isPast = !!dayMeta[dayIndex].past;
    const sun = state.sun[dayMeta[dayIndex].date] || {}; // per-day, for tooltip/aria
    const cells = [];
    for (let hour = start; hour <= end; hour++) {
        const h = dayData.find(x => x.hour === hour);
        if (!h) { cells.push({ empty: true }); continue; } // honest gap
        const isCurrent = isToday && hour === currentHour;
        // Temperature view (DR-17): comfort-band colour on feels-like
        // (raw temp only if apparent is missing). Wind view: wind
        // scale. Rain view: the WMO sky colour (tinted for rain,
        // cloud-spread, night after this hour's local sunset); rain
        // itself rides on top as the streak overlay, below.
        const rgb = view === 'temp' ? bandRGB(h.feels != null ? h.feels : h.temp)
            : view === 'wind'
                ? (h.wind != null ? windRGB(h.wind) : [40, 40, 40]) // no data: near-black, no arrow
                : conditionRGB(h, nightFactor(hour, sun));
        // Hazard icons (DR-10): every applicable hazard shows,
        // packed into the bottom-right corner in a fixed order so
        // two never swap places: the weather-coded hazard first
        // (storm, fog, freeze, mutually exclusive), then heat, then
        // UV (the two threshold hazards, from the ⚙-menu
        // thresholds). Rarely more than two at once (usually heat +
        // UV, or a storm on a hot day). h.glyph is an MR_ICON key.
        const hot = h.temp >= settings.heatWarn;
        const uvHigh = h.uv != null && h.uv >= settings.uvWarn;
        // DR-17 danger glyph: temperature view only, on feels-like
        // (raw only if apparent is missing). Outside the rain view's
        // hazard vocabulary, so it never counts against its glyph cap.
        const dv = h.feels != null ? h.feels : h.temp;
        const dangerCold = view === 'temp' && dv != null && dv <= TEMP_DANGER_COLD;
        const dangerHot = view === 'temp' && dv != null && dv >= TEMP_DANGER_HOT;
        // Wind view: the arrow is the data, centred, pointing where
        // the wind blows. One SVG (base points up) rotated by the
        // octant; hazards stay on the other two views, tucked into
        // the bottom-right corner (B1).
        const arrow = view === 'wind' && h.windDir != null && h.wind != null
            ? `<span class="wind-arrow" style="transform:rotate(${windOctant(h.windDir) * 45 + 180}deg)">${MR_ICON.wind}</span>` : '';
        const hazGlyph = view === 'wind' ? ''
            : mrIcon(h.glyph)
            + (rainView && h.mm != null && h.mm > LN.warn ? MR_ICON.rainwarn : '')
            + (hot ? MR_ICON.heat : '') + (uvHigh ? MR_ICON.uv : '')
            + (dangerCold || dangerHot ? MR_ICON.danger : '');
        // DR-17 frost contour (temperature view only), on ACTUAL air
        // temp, decoupled from the feels-like colour: ice, frost and
        // rain->snow are real-temperature events. The marker outlines
        // the whole region, not just a crossing: a cell inside the
        // region draws an edge on each side where the neighbour is on
        // the warm side of the threshold, so the border traces the
        // 0 ° (solid) and +3 ° possible-frost (dashed) contours around
        // the frozen / near-freezing blocks. The top of the shown
        // window banners, so an all-frozen column never loses it.
        // Solid on the frozen cells (< 0), dashed on the near-freezing
        // ones (0 up to +3); a cell is only ever one or the other.
        let frost = '';
        if (view === 'temp' && h.temp != null) {
            const t = h.temp, buf = FROST_POSSIBLE;
            const solid = t < 0, dashed = !solid && t < buf;
            if (solid || dashed) {
                const thr = solid ? 0 : buf; // edge sits where the neighbour is warmer than this
                const above = actualTemp(dayIndex, hour - 1);
                const below = actualTemp(dayIndex, hour + 1);
                const left = actualTemp(dayIndex - 1, hour);
                const right = actualTemp(dayIndex + 1, hour);
                const out = n => n == null || n >= thr; // warm side, off-window, or gap
                const sides = [];
                if (hour === start || (above != null && above >= thr)) sides.push('top');
                if (hour < end && out(below)) sides.push('bottom');
                if (dayIndex > 0 && out(left)) sides.push('left');
                if (dayIndex < lastDay && out(right)) sides.push('right');
                if (sides.length) {
                    let style;
                    if (solid) {
                        // Certain freezing: each active side is a band
                        // strongest at the block edge and fading toward
                        // the middle, so the 0 ° contour reads as a
                        // frosty haze rather than a hard line.
                        const D = 9; // how far the frost reaches inward
                        const C = 'rgba(146,224,255,0.9)';
                        const fade = { top: 'to bottom', bottom: 'to top', left: 'to right', right: 'to left' };
                        const place = {
                            top: `left top/100% ${D}px`, bottom: `left bottom/100% ${D}px`,
                            left: `left top/${D}px 100%`, right: `right top/${D}px 100%`
                        };
                        const bg = sides.map(s => `linear-gradient(${fade[s]}, ${C}, transparent) ${place[s]} no-repeat`).join(',');
                        style = `background:${bg}`;
                    } else {
                        // Possible-frost: a crisp 2px dashed line (no
                        // fade) so it stays sharply distinct from the
                        // soft certain-frost haze; drawn per side as a
                        // repeating gradient for exact dash and gap.
                        const C = 'rgba(152,221,255,0.92)', DASH = 6, GAP = 5, TH = 2;
                        const grad = dir => `repeating-linear-gradient(to ${dir}, ${C} 0 ${DASH}px, transparent ${DASH}px ${DASH + GAP}px)`;
                        const layer = {
                            top: `${grad('right')} left top/100% ${TH}px no-repeat`,
                            bottom: `${grad('right')} left bottom/100% ${TH}px no-repeat`,
                            left: `${grad('bottom')} left top/${TH}px 100% no-repeat`,
                            right: `${grad('bottom')} right top/${TH}px 100% no-repeat`
                        };
                        style = `background:${sides.map(s => layer[s]).join(',')}`;
                    }
                    frost = `<span class="frost" style="${style}"></span>`;
                }
            }
        }
        // Sky event (moon phase / lunar eclipse): a night fact, so
        // it rides the day's 21:00 block, bottom-left, in all views.
        const sky = h.hour === 21 ? skyEventFor(dayMeta[dayIndex].date) : null;
        // Chance of rain is a forecast statement, so it is dropped on a
        // past hour: the outcome is known, and Open-Meteo keeps
        // returning the probability that was forecast rather than
        // retiring it, which reads as a live prediction about something
        // that already happened. The measured amount stays, and is the
        // only rain figure a past hour reports.
        const popText = (!isPast && h.pop != null) ? ` · ${h.pop}% rain` : '';
        // Rain view: the exact amount lives in the tooltip, never
        // printed in the cell, so the grid stays glanceable.
        const mmText = rainView && h.mm != null && h.mm >= 0.1
            ? ` · ${h.mm} mm/h` : '';
        const snowText = rainView && h.snow != null && h.snow > 0
            ? ` · ${h.snow} cm/h snow` : '';
        const windText = h.wind != null
            ? ` · ${displayWind(h.wind)} ${windUnitLabel()}${h.windDir != null ? ' ' + COMPASS[windOctant(h.windDir)] : ''}`
            : '';
        const hazText = (hot ? ' · extreme heat' : '')
            + (uvHigh ? ` · very high UV (${Math.round(h.uv)})` : '')
            + (dangerCold ? ' · dangerous cold' : '') + (dangerHot ? ' · dangerous heat' : '');
        const sunText = (sun.rise?.h === hour ? ` · sunrise ${timeLabel(sun.rise.h, sun.rise.m)}` : '')
            + (sun.set?.h === hour ? ` · sunset ${timeLabel(sun.set.h, sun.set.m)}` : '');
        const skyText = sky ? ` · ${sky.label}` : '';
        // DR-6: a cell whose forecast meaningfully moved since the
        // previous model run. The pulse is view-gated (a temp move
        // pulses in temp view, not rain view) and armed only while
        // pulsePending, so it fires once per new model run; the
        // was/now detail stays in the tooltip either way.
        // DR-6: a cell whose forecast meaningfully moved since the
        // previous model run drives the one-shot blink on a refresh
        // (view-gated: a temp move only blinks in temp view). The
        // was/now detail rides the tooltip either way.
        let ch = state.changed?.[`${dayMeta[dayIndex].date}|${h.hour}`];
        // A past hour does not report its probability (see popText), so
        // a change to it must not pulse the cell or print a was/now line
        // for a number that is not on screen. Dropped from a copy, since
        // state.changed is shared with every other column.
        if (isPast && ch?.pop) { ch = { ...ch }; delete ch.pop; }
        const movedInView = ch && (view === 'temp' ? ch.temp : view === 'wind' ? ch.wind : ch.pop);
        const chText = changeLines(ch).map(l => ` · ${l}`).join('');
        // DR-17: name the comfort band in the temperature view so the
        // colour is spoken, not just seen.
        const feelsVal = h.feels != null ? h.feels : h.temp;
        const comfortText = view === 'temp' && feelsVal != null
            ? ` · ${TEMP_BANDS[bandIndex(feelsVal)].name.toLowerCase()}` : '';
        const info = `${dayMeta[dayIndex].date ? dateLabel(dayMeta[dayIndex].date) + ', ' : ''}${hourLabel(h.hour)} - ${h.description}, ${displayTemp(h.temp)}°${settings.unit}${comfortText}${popText}${mmText}${snowText}${windText}${hazText}${sunText}${skyText}${chText}`;
        // Marks: precipitation overlays first (under the glyphs;
        // rain lines + snow lattice + hail rings, any subset;
        // lines + lattice together IS sleet) + the frost contour
        // (temp view) + centred wind arrow (wind view) + bottom-right
        // hazard glyph + bottom-left sky glyph. Any may be empty.
        const marks = (rainView
                ? rainLinesSVG(h, rgb) + snowLatticeSVG(h) + hailRingsSVG(h, rgb)
                : '')
            + frost
            + arrow
            + (hazGlyph ? `<span class="block-mark">${hazGlyph}</span>` : '')
            + (sky ? `<span class="block-mark sky">${mrIcon(sky.glyph)}</span>` : '');
        // dataset.day is absolute (an index into state.days), not the
        // column position, so a tooltip opened while the drawer is
        // open still reads the right day back out.
        cells.push({ rgb, textColor: textOn(rgb), marks, info, current: isCurrent, past: isPast, dayIndex: off + dayIndex, hour: h.hour, moved: !!movedInView });
    }
    return cells;
});
};

// The grid for a city that is NOT the current one, built without
// disturbing the app's state: the DR-32 selector has to sweep toward a
// destination long before it has committed to going there, and may
// never commit at all. Only the cached forecast is used; no fetch is
// triggered by a drag passing over a rung.
//
// A favourite with no usable cache (never opened, or expired) has no
// colours to arrive at. It returns null, and the caller sweeps to black
// instead: black is the page background rather than a value in any
// palette, so it reads as ABSENT and never as a wrong number. The real
// data arrives on landing, through the ordinary changeCity fetch.
const colsForPlace = place => {
    if (!place) return null;
    if (placeKey(place) === placeKey(state.place)) return buildCols();
    const entry = loadForecast(place);
    if (!entry?.payload || forecastExpired(entry)) return null;
    const keep = {
        place: state.place, tz: state.tz, utcOffset: state.utcOffset,
        sun: state.sun, data: state.data, days: state.days,
        // processData writes todayIndex, and the preview city's payload
        // can put today at a different index (a city a day ahead across
        // the date line, or one whose cache holds fewer past days). It
        // has to be restored with data/days or the live grid would index
        // its own week through another city's anchor.
        todayIndex: state.todayIndex,
        changed: state.changed, pulsePending: state.pulsePending
    };
    try {
        state.place = place;
        // Change marks belong to the city that computed them; a preview
        // of a different city must never inherit its pulses.
        state.changed = null; state.pulsePending = false;
        processData(entry.payload);
        return buildCols();
    } catch {
        return null;
    } finally {
        Object.assign(state, keep);
    }
};

// The sweep needs both grids to be the same shape, and a city with a
// shorter cached payload can yield fewer than DAY_SPAN columns. Pad
// rather than reject: the missing columns sweep to black, which is the
// same honest "no data here" the cold-city case above uses.
const fitCols = (cols, nCols, nRows) => {
    const out = [];
    for (let c = 0; c < nCols; c++) {
        const col = cols && cols[c];
        out.push(col && col.length === nRows ? col : Array.from({ length: nRows }, () => blankDesc));
    }
    return out;
};

const updateDisplay = (anim = null) => {
    const { start, end, days, off } = visibleWindow();
    const rows = end - start + 1;
    // The 7-column frame, starting at the drawer's day offset (0 at rest,
    // so this is today-first and byte-identical to the pre-drawer render).
    const shownDays = state.data.slice(off, off + days);
    const dayMeta = state.days.slice(off, off + days);

    // The past class goes on all three rows (day label, temps, blocks),
    // not just the grid, so a receded column reads as one whole column
    // sitting behind today.
    $('days').innerHTML = dayMeta.map(day =>
        `<div class="day-label ${day.isToday ? 'today' : ''}${day.past ? ' past' : ''}">${day.text}</div>`
    ).join('');

    // Min/max over the displayed hour window as a one-line "18/9"
    // pair, in the chosen unit (° implied; see .temp-item CSS).
    $('temps').className = `temp-row${settings.unit === 'F' ? ' unit-f' : ''}`;
    $('temps').innerHTML = shownDays.map((dayData, i) => {
        const t = dayData.filter(h => h.hour >= start && h.hour <= end).map(h => h.temp);
        const fmt = v => t.length ? String(displayTemp(v)) : '–';
        return `<div class="temp-item${dayMeta[i]?.past ? ' past' : ''}"><span class="temp-max">${fmt(Math.max(...t))}</span><span class="temp-sep">/</span><span class="temp-min">${fmt(Math.min(...t))}</span></div>`;
    }).join('');

    renderTimes();

    const currentHour = cityNow().hour;

    // Sun hairlines: one straight line across the whole grid at
    // today's sunrise/sunset minute (⚙ Sun → hide turns them off).
    // Neighbouring days drift only minutes; each day's exact times
    // are in its blocks' tooltips.
    const todayMeta = dayMeta.find(d => d.isToday) || dayMeta[0];
    const sunToday = (todayMeta && state.sun[todayMeta.date]) || {};
    // Hybrid chrome: once the current local hour is past sunset, the
    // background eases to night (blocks already colour per their own
    // hour). Purely ambient: a single --bg swap, accent stays gold.
    document.body.classList.toggle('night', nightFactor(currentHour, sunToday) >= 0.5);
    $('sunLines').innerHTML = !settings.sunLines ? '' : ['rise', 'set'].map(k => {
        const t = sunToday[k];
        if (!t) return '';
        const f = t.h + t.m / 60;
        if (f < start || f > end + 1) return ''; // outside the hour window
        return `<div class="sun-line" style="top:${((f - start) / rows * 100).toFixed(2)}%"></div>`;
    }).join('');

    const cols = buildCols();
    paintGrid($('grid'), cols, anim);
    // Keep an open block tooltip in sync with the repaint (city swap,
    // view switch, background refresh) even when the mouse hasn't moved.
    refreshActiveTooltip();

    // DR-6: the first render after a rotation consumes the pulse, so
    // settings and view re-renders rebuild without .changed and the
    // animation can never re-fire on identical DOM.
    state.pulsePending = false;

    renderNowTemp();
    updateStatus();

    // First real data paint: now it's safe to arm the install banner
    // (any beforeinstallprompt that fired earlier, or the iOS hint).
    // Gate on real data so an empty render (e.g. a stale payload whose
    // days have all elapsed) can never arm it off a blank grid.
    if (!firstPaintDone && state.data.length) {
        firstPaintDone = true;
        maybeScheduleInstallBanner();
    }
};

// --- Legend: spectrum strip or heat strip -------------------------
// One line, fixed order: sun → cloud → rain → storm → snow, group
// labels beneath, so it reads as a scale ("darker = more"). Exact
// condition names on tap via the shared tooltip, derived from the
// WMO table so legend and grid stay in sync.
const namesFor = key => {
    const names = Object.values(WMO).filter(([k]) => k === key).map(([, d]) => d);
    if (key === 'cloudy') names.unshift('Cloudy');     // WMO 3, thinner cover
    if (key === 'overcast') names.unshift('Overcast'); // WMO 3, >90% cover
    return [...new Set(names)];
};
// Every view reduces to a list of steps of one shape,
// { bg, label, glyph?, cond? }: the temp and wind scales are plain
// swatch + label; the condition strip adds a glyph and an index into
// CONDITIONS (cond) that makes its swatch interactive. One renderer
// walks the list, so the three views share a single codebase.
const legendSteps = () => {
    if (view === 'wind') {
        const anchors = [0, 10, 20, 30, 40, 50, 60, 75]; // km/h
        return anchors.map((v, i) => ({
            bg: `rgb(${windRGB(v)})`,
            label: `${displayWind(v)}${i === anchors.length - 1 ? ' ' + windUnitLabel() : ''}`
        }));
    }
    if (view === 'temp') {
        // DR-17: the strip is the eight comfort bands, not a °C ramp;
        // each swatch is its band colour, the block tooltip carries the
        // prep cue on tap.
        return TEMP_BANDS.map(b => ({ bg: `rgb(${b.rgb})`, label: b.name }));
    }
    // Rain view: the strip is the sky ramp (lighter = sunnier, darker
    // = cloudier, storm darkest) plus a blue-hatched "rain" swatch
    // (DR-13, teaching "blue = rain") and a white-dot "snow" swatch.
    // Block tooltips still name every condition on tap.
    const hatch = `repeating-linear-gradient(118deg, rgba(${LN_BLUE_HI[0]},${LN_BLUE_HI[1]},${LN_BLUE_HI[2]},0.85) 0 1.6px, transparent 1.6px 8px), rgb(${SKY_DAY.cloudy})`;
    const dots = `radial-gradient(rgba(255,255,255,0.92) 1px, rgba(0,0,0,0) 1.4px) 0 0 / 7px 7px, rgb(${SKY_DAY.overcast})`;
    return [
        { bg: `rgb(${SKY_DAY.clear})`, label: 'sun' },
        { bg: `rgb(${SKY_DAY.partly})`, label: '' },
        { bg: `rgb(${SKY_DAY.cloudy})`, label: 'cloud' },
        { bg: `rgb(${SKY_DAY.overcast})`, label: '' },
        { bg: hatch, label: 'rain' },
        { bg: dots, label: 'snow' },
        { bg: `rgb(${SKY_DAY.storm})`, label: 'storm' }
    ];
};
const renderLegend = () => {
    const legend = $('legend');
    // Advanced users can hide the key entirely (⚙ Key → hide);
    // block tooltips still name every condition on tap.
    show(legend, settings.legend);
    if (!settings.legend) { legend.innerHTML = ''; return; }
    legend.innerHTML = legendSteps().map(s => {
        // Condition swatches are interactive (tap = exact names) and
        // carry a luminance-picked glyph color; scale swatches are
        // just a background.
        const c = s.cond != null ? CONDITIONS[s.cond] : null;
        const cls = c ? 'swatch legend-swatch' : 'swatch';
        const color = c ? `;color:${textOn(hexRGB(s.bg))}` : '';
        const attrs = c
            ? ` tabindex="0" role="button" data-cond="${s.cond}" aria-label="${esc(c.label)}: ${esc(namesFor(c.key).join(', '))}"`
            : '';
        return `<div class="legend-step">
            <div class="${cls}" style="background:${s.bg}${color}"${attrs}>${c ? mrIcon(s.glyph) : ''}</div>
            <span>${s.label}</span>
        </div>`;
    }).join('');
};

// Toggle shows only the views enabled in ⚙; hidden entirely when
// just one view is left, since there is nothing to switch to.
// DR-30: the underline as a measured element rather than a border, so a
// scrub can slide it. `p` is the scrub's progress and `dest` the view it
// is heading for; with neither, it simply parks on the active button and
// the toolbar looks exactly as it did before.
//
// It interpolates straight onto the destination BUTTON, and deliberately
// not by the prototype's one-slot-in-list-order rule. That rule sends the
// bar off the end of the row whenever the step wraps, which with three
// views is a third of all gestures, and a bar that has left the row names
// nothing, which is the one job the DR gives it.
const viewBtn = v => $('viewSeg').querySelector(`button[data-view="${v}"]`);
const renderViewBar = (p = 0, dest = null) => {
    const seg = $('viewSeg'), bar = $('viewBar');
    const a = viewBtn(view);
    // No layout to measure (hidden toolbar, or a host that never lays
    // out): fall back to the button's own border-bottom, which is still
    // the underline until `has-bar` says otherwise.
    if (!a || !a.offsetWidth) { seg.classList.remove('has-bar'); bar.hidden = true; return; }
    const b = dest && dest !== view ? viewBtn(dest) : null;
    const k = b && b.offsetWidth ? Math.max(0, Math.min(1, p)) : 0;
    const to = k ? b : a;
    seg.classList.add('has-bar');
    bar.hidden = false;
    bar.style.left = `${a.offsetLeft + (to.offsetLeft - a.offsetLeft) * k}px`;
    bar.style.width = `${a.offsetWidth + (to.offsetWidth - a.offsetWidth) * k}px`;
};

const renderViewToggle = () => {
    document.querySelectorAll('#viewToggle .seg button').forEach(b => {
        b.style.display = settings.views[b.dataset.view] ? '' : 'none';
        b.classList.toggle('active', b.dataset.view === view);
    });
    $('viewToggle').style.display = enabledViews().length > 1 ? '' : 'none';
    renderViewBar();
};
const setView = (v, anim) => {
    const prev = view;
    view = v;
    // A view change owns the whole grid, so both reveals go home with it
    // rather than carrying a peeked or drawered window into the new view
    // (DR-29: a view or city change is one of the drawer's ways home).
    resetReveal();
    saveJSON(LS_VIEW, v);
    renderViewToggle();
    renderLegend();
    if (!state.data.length) return; // initial paint: no grid to animate yet
    // A swipe/arrow passes the wave direction; a toolbar click derives it
    // from the view's position relative to the previous one. paintGrid
    // falls back to an instant repaint under reduced motion.
    let a = anim;
    // DR-30: a scrub has already played the whole wave under the finger,
    // so the commit repaints instantly onto exactly the grid the sweep
    // just landed on and the commit itself is invisible. Distinct from
    // `undefined`, which still means "derive a direction" for a tap.
    if (a === 'instant') a = null;
    else if (!a) {
        const en = enabledViews();
        const oi = en.indexOf(prev), ni = en.indexOf(v);
        a = (oi >= 0 && ni >= 0 && oi !== ni)
            ? { type: 'wave', axis: 'x', dir: ni > oi ? -1 : 1 }
            : { type: 'reveal' };
    }
    updateDisplay(a);
};

// Re-render everything that depends on a preference.
const applyPrefs = () => {
    // The 6-21 / 24h choice redefines what the hour window even is, so a
    // peek in progress has nothing left to mean.
    hourOff = 0;
    applyBand();
    renderLegend();
    if (state.data.length) updateDisplay(); else renderSkeleton();
};

// --- Day rollover -------------------------------------------------
// The week is sliced against cityNow().date in processData, but that
// only runs on a fetch or a cached paint. With no trigger at local
// midnight the grid keeps the previous day's slice (a now-past day
// still flagged "today") until the next poll happens to land. This
// schedules a tick at the city's next local midnight that re-slices
// from the cached payload, which carries a spare trailing day past the
// furthest the drawer reaches, so the dropped day is replaced in the
// same frame even with the drawer open, then revalidates from
// the network. Self-arming, so it also picks up a timezone that moved
// with a city switch.
//
// The re-slice is also what re-anchors state.todayIndex: processData
// recomputes it against the new local date, so yesterday becomes two
// days back and the day before it falls off the front under the
// PAST_DAYS trim. dayOff is measured from today, so a drawer left open
// across midnight keeps pointing at the same distance from today rather
// than at the same calendar day, which is what the ⌂ chip promises.
let dayRolloverTimer = null;
const msUntilCityMidnight = () => {
    // Shift "now" into city-local time, then read how far it is past
    // local midnight via the UTC getters on the shifted instant.
    const local = new Date(Date.now() + (state.utcOffset || 0) * 1000);
    const since = ((local.getUTCHours() * 60 + local.getUTCMinutes()) * 60
        + local.getUTCSeconds()) * 1000 + local.getUTCMilliseconds();
    return 86400000 - since;
};
const scheduleDayRollover = () => {
    clearTimeout(dayRolloverTimer);
    // +2s cushion so cityNow() is safely into the new day when we
    // re-slice (avoids a boundary race that could re-drop the new day).
    dayRolloverTimer = setTimeout(() => {
        // Re-slice the on-screen week against the new local date. Keep
        // the true fetch time (processData doesn't touch it), so the
        // freshness line isn't reset by a pure re-slice; the forced
        // fetch below then brings genuinely newer data and the next
        // day's 8th column.
        const entry = loadForecast(state.place);
        if (entry?.payload && !forecastExpired(entry)) {
            processData(entry.payload);
            updateDisplay();
        }
        if (!document.hidden && !state.loading) fetchWeather(true);
        scheduleDayRollover(); // arm the next midnight (fresh offset)
    }, msUntilCityMidnight() + 2000);
};

// --- Current-hour marker keep-alive --------------------------------
// `currentHour` is computed fresh every time `updateDisplay` runs,
// but that only ever happens on a fetch, a city/view switch, or the
// midnight tick above, so the "now" time label, the grid's current-
// hour ring, and the night background can all sit stuck on a past
// hour indefinitely: `fetchWeather` no-ops past a status update when
// the cached data is still within FRESH_TIME (10 min), which paints
// nothing, so a tab left open (or backgrounded and returned to)
// inside that window shows a stale hour until the next real poll
// happens to land.
//
// The fix is *not* a bare `updateDisplay()` (tried first, reverted):
// that rebuilds the grid's `innerHTML` wholesale, replacing every
// block element, which silently detaches `tappedBlock` from the live
// DOM the moment a pinned tooltip's block is recreated (its "tap the
// same block again to close it" check would then compare against an
// element no longer on screen). None of that is actually needed
// here: only three things depend on the *hour itself* rather than
// the date or the fetched data, so `refreshNowMarkers` below updates
// exactly those three in place, without touching a single grid
// block's identity: `renderTimes()` (its own small subtree, already
// safe to call standalone; `renderSkeleton` already does), the
// `.current` class toggled onto whichever block should now carry it
// (found via the day-label already marked `.today`, not re-derived
// maths, so it can't drift from what `updateDisplay` itself would
// compute), and the night/day background class. Not process
// intensive either way: one timer firing once an hour (not a per-
// second/minute poll), and this version does less work than the
// rejected one, not more: a couple of class toggles and one small
// `innerHTML` rebuild, cheaper than the grid repaint the app already
// performs on every ordinary city/view switch without a second
// thought.
const refreshNowMarkers = () => {
    if (!state.data.length) return;
    renderTimes();
    const grid = $('grid');
    const dayCols = [...grid.children];
    const todayIdx = [...$('days').children].findIndex(l => l.classList.contains('today'));
    const currentHour = cityNow().hour;
    const nowEl = todayIdx >= 0
        ? dayCols[todayIdx]?.querySelector(`.weather-block[data-hour="${currentHour}"]`)
        : null;
    const prevEl = grid.querySelector('.weather-block.current');
    if (prevEl !== nowEl) {
        prevEl?.classList.remove('current');
        nowEl?.classList.add('current');
    }
    const todayMeta = state.days.find(d => d.isToday);
    const sunToday = (todayMeta && state.sun[todayMeta.date]) || {};
    document.body.classList.toggle('night', nightFactor(currentHour, sunToday) >= 0.5);
};
let hourTickTimer = null;
const msUntilNextHour = () => {
    const local = new Date(Date.now() + (state.utcOffset || 0) * 1000);
    const since = (local.getUTCMinutes() * 60 + local.getUTCSeconds()) * 1000 + local.getUTCMilliseconds();
    return 3600000 - since;
};
const scheduleHourTick = () => {
    clearTimeout(hourTickTimer);
    // +1s cushion, same idea as day rollover's +2s: land safely past
    // the boundary rather than racing it.
    hourTickTimer = setTimeout(() => {
        refreshNowMarkers();
        scheduleHourTick(); // re-arm for the following hour (fresh offset)
    }, msUntilNextHour() + 1000);
};
// UI contract (see shared/README.md): the shared fetch layer calls this
// after a payload lands, to re-arm whatever city-local clocks this variant
// runs against the new timezone. Primary runs both.
const armClocks = () => { scheduleDayRollover(); scheduleHourTick(); };

// --- Tooltip: shared by grid blocks and legend cells --------------
const TIP_SEL = '.weather-block[data-info], .legend-swatch';
const showTooltip = el => {
    const tooltip = $('tooltip');
    // A tooltip opening means the screen is being read: pause any
    // reveal-idle countdown already running (the day drawer / hour
    // peek's own way home) rather than let it fire mid-investigation.
    // `pendingRevealFn` is left alone, so `hideTooltip` below knows
    // what to re-arm once this tooltip closes, and `armRevealIdle`
    // itself skips arming a fresh one while a tooltip is still open.
    clearTimeout(revealTimer);
    // Prose explanation wraps and is interactive (so its link is
    // clickable); the fact tooltips stay single-line.
    tooltip.classList.toggle('explain', el.id === 'statusInfo');
    // Block tooltip gets the capped-width, hero-line layout; legend and
    // freshness tooltips keep the plain single-line style.
    tooltip.classList.toggle('block', el.id !== 'statusInfo' && el.dataset.cond == null);
    // DR-28: always interactive, not click-through. #tooltip lives
    // outside .chart in the DOM (a sibling, absolutely positioned),
    // so this can never be mistaken for a touch on the grid itself
    // or feed the chart's own swipe detection; it only ever reaches
    // the document click handler below, whose "not a TIP_SEL
    // target" branch closes it. That's the whole feature: tapping
    // the open tooltip closes it, same as tapping anywhere else
    // that isn't a block/legend swatch.
    tooltip.style.pointerEvents = 'auto';
    // Cleared here; the grid-block branch re-arms it so a repaint (city
    // swap, view switch, background refresh) can re-render the open
    // tooltip against the new data at the same grid position.
    activeBlock = null;
    if (el.id === 'statusInfo') { // freshness line: what it means
        const title = '<div class="tip-title"><strong>Forecast freshness</strong></div>';
        const docs = '<div class="tip-link"><a href="https://open-meteo.com/en/docs/model-updates" target="_blank" rel="noopener">How Open-Meteo schedules updates</a></div><div style="border-bottom: 1px solid var(--line); margin: 6px 0;"></div><div class="tip-link"><a href="https://open-meteo.com" target="_blank" rel="noopener">Data provided by Open-Meteo</a></div>';
        const body = state.modelRun
            ? (state.localRun
                ? [`<strong>Local:</strong> the ${esc(state.localRun.label)} regional model. Drives the near-term hours and refreshes often.`,
                   '<strong>Global:</strong> ICON, updated about every 6h. Covers the full 7-day forecast.',
                   'Each shows when it last ran.']
                : ['<strong>Global model (ICON):</strong> sets the run and next-update times, refreshing about every 6h.',
                   'No local short-range model covers this location.'])
            : ['Shows when the app last fetched the forecast.',
               'The model run time is unavailable right now.'];
        tooltip.innerHTML =
            title + body.map(l => `<div class="tip-body">${l}</div>`).join('') + docs;
    } else if (el.dataset.cond != null) { // legend cell: exact condition names
        const c = CONDITIONS[+el.dataset.cond];
        tooltip.innerHTML =
            `<div><strong>${esc(c.label)}</strong></div><div>${namesFor(c.key).map(esc).join(' · ')}</div>`;
    } else { // grid block: view-ordered main lines, one detail line, hazard chips
        const di = +el.dataset.day;
        const day = state.days[di];
        const h = state.data[di]?.find(x => x.hour === +el.dataset.hour);
        if (!day || !h) return;
        // Remember this cell by grid position (column + hour), which is
        // stable across a city swap, so refreshActiveTooltip can re-render.
        activeBlock = { day: di, hour: h.hour };
        const sun = state.sun[day.date] || {};

        // Header: day + date left, the hour range right (kept whole so
        // it never wraps onto a second line). The hairline under it
        // (--divider, .tip-when's border-bottom) separates it from the
        // stats block below.
        const range = `${hourLabel(h.hour)}–${hourLabel((h.hour + 1) % 24)}`;
        // "Yesterday" is named outright, the way "Today" already is. It
        // is the past day the drawer is opened for most of the time, and
        // reading a weekday letter back as a date is the step the header
        // exists to save. Two days back keeps its weekday, since
        // "the day before yesterday" is longer than the date it replaces.
        const yesterday = dateDaysBefore(cityNow().date, 1);
        const dayName = day.isToday ? 'Today'
            : day.date === yesterday ? 'Yesterday' : day.text;
        const when = `<div class="tip-when"><span class="d">${dayName} ${dateLabel(day.date)}</span><span class="t">${range}</span></div>`;

        // Three main lines, fixed order (temp, rain, wind) in every
        // view: only the line matching the active view gets the
        // big/bright .tip-hero treatment; the other two share one
        // quieter "dim" size/weight/color so nothing disappears.
        const dimClass = v => v === view ? '' : ' dim';

        // Temp line: feels-like folded into the same hero styling as
        // the actual temp (no separate lighter span anymore).
        const feelsVal = h.feels != null ? h.feels : h.temp;
        const feelsPart = h.feels != null ? ` feels ${displayTemp(h.feels)}°` : '';
        const temp = `<div class="tip-temp"><span class="tip-hero${dimClass('temp')}">${displayTemp(h.temp)}°${feelsPart}</span></div>`;

        // Rain line: chance then rainfall amount (always shown, even
        // 0 mm/h, so a "% rain" never appears without an amount). A
        // snow amount (sleet) wraps to its own line below, inheriting
        // whatever weight the rain line gets for the active view.
        // On a past day the chance is dropped and the line is the amount
        // alone: the hour has happened, so what fell is the answer and a
        // probability beside it is a prediction about a known outcome.
        const rainBits = [];
        let snowBit = '';
        if (!day.past && h.pop != null) rainBits.push(`${h.pop}%`);
        if (h.snow != null && h.snow > 0) {
            if (h.liquid != null && h.liquid >= 0.1) rainBits.push(`${h.liquid} mm/h`);
            snowBit = `${h.snow} cm/h snow`;
        } else if (h.mm != null) {
            rainBits.push(`${h.mm} mm/h`);
        }
        const rainDim = dimClass('rain');
        const rain = (rainBits.length || snowBit)
            ? `<div class="tip-rain">`
                + (rainBits.length ? `<span class="tip-hero${rainDim}">${rainBits.join(' · ')}</span>` : '')
                + (snowBit ? `<span class="tip-hero tip-snow${rainDim}">${snowBit}</span>` : '')
                + `</div>`
            : '';

        // Wind line, new: wasn't its own line before. Omitted only
        // when the hour has no wind reading at all, same "never
        // blank" fallback the rain line already uses for missing data.
        const wind = h.wind != null
            ? `<div class="tip-wind"><span class="tip-hero${dimClass('wind')}">${displayWind(h.wind)} ${windUnitLabel()}`
                + (h.windDir != null ? ` ${COMPASS[windOctant(h.windDir)]}` : '') + `</span></div>`
            : '';

        const divider = '<div class="tip-divider"></div>';

        // Detail line: active-view fact leads (brighter source data,
        // same muted color as the rest of the line), shared facts
        // trail after it so nothing that used to show is lost; wraps
        // to a second line on its own if it doesn't fit on one.
        let activeDetail = '';
        let claimedCondition = false, claimedHumidity = false;
        if (view === 'rain') {
            activeDetail = esc(h.description);
            claimedCondition = true;
        } else if (view === 'temp' && feelsVal != null) {
            const band = TEMP_BANDS[bandIndex(feelsVal)];
            activeDetail = `${esc(band.name)} - ${esc(band.cue)}`;
        } else if (view === 'wind') {
            const bits = [];
            if (h.gust != null && h.wind != null && h.gust - h.wind >= GUST_MIN) bits.push(`gusts ${displayWind(h.gust)}`);
            if (h.windDir != null) bits.push(COMPASS[windOctant(h.windDir)]);
            activeDetail = bits.join(' · ');
        }
        const shared = [];
        if (!claimedCondition) shared.push(esc(h.description));
        if (h.humidity != null && !claimedHumidity) shared.push(`humidity ${h.humidity}%`);
        if (sun.rise && sun.set) shared.push(h.hour < sun.rise.h + sun.rise.m / 60
            ? `sunrise ${timeLabel(sun.rise.h, sun.rise.m)}`
            : `sunset ${timeLabel(sun.set.h, sun.set.m)}`);
        if (h.hour === 21) { const sky = skyEventFor(day.date); if (sky) shared.push(esc(sky.label)); }
        const detailText = [activeDetail, ...shared].filter(Boolean).join(' · ');
        const detailLine = detailText ? `<div class="tip-ctx tip-detail">${detailText}</div>` : '';

        // DR-6: was/now detail, as small muted lines under the detail line.
        const chg = changeLines(state.changed?.[`${day.date}|${h.hour}`])
            .map(l => `<div class="tip-ctx">${l}</div>`).join('');

        // Hazard chips: one per corner glyph currently shown on the
        // block (none in wind view, where the arrow replaces them),
        // reusing the amber status pill.
        const chips = [];
        if (view !== 'wind') {
            if (h.glyph === 'storm') chips.push(h.code === 96 || h.code === 99 ? 'thunderstorm, hail' : 'thunderstorm');
            else if (h.glyph === 'fog') chips.push('fog');
            else if (h.glyph === 'freeze') chips.push('freezing rain');
            if (view === 'rain' && h.mm != null && h.mm > LN.warn) chips.push('heavy rain');
            if (h.temp >= settings.heatWarn) chips.push('extreme heat');
            if (h.uv != null && h.uv >= settings.uvWarn) chips.push(`very high UV (${Math.round(h.uv)})`);
            // DR-17 danger glyph, temperature view only, on feels-like.
            if (view === 'temp') {
                const dv = h.feels != null ? h.feels : h.temp;
                if (dv != null && dv <= TEMP_DANGER_COLD) chips.push('dangerous cold');
                else if (dv != null && dv >= TEMP_DANGER_HOT) chips.push('dangerous heat');
            }
        }
        const chipHtml = chips.length
            ? `<div class="tip-chips">${chips.map(c => `<span class="tip-chip">${esc(c)}</span>`).join('')}</div>` : '';

        tooltip.innerHTML = when + temp + rain + wind + divider + detailLine + chg + chipHtml;
    }
    tooltip.style.opacity = '1';
    // Measure the real size, center on the block, clamp to the
    // viewport; flip below the block near the top edge.
    const rect = el.getBoundingClientRect();
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, rect.left + rect.width / 2 - tw / 2))}px`;
    tooltip.style.top = `${rect.top < th + 16 ? rect.bottom + 8 : rect.top - th - 8}px`;
};
let tappedBlock = null; // element whose tooltip was opened by a tap/click (DR-24: shared by mouse and touch again)
let activeBlock = null; // {day,hour} of the open block tooltip, for re-render on repaint
const hideTooltip = () => {
    const t = $('tooltip');
    t.style.opacity = '0';
    t.style.pointerEvents = 'none'; // hidden tooltip must never intercept clicks
    tappedBlock = null;
    activeBlock = null;
    // The tooltip that was pausing the reveal-idle countdown (see
    // `showTooltip`) just closed: resume it. `dayHome`/`springHours`
    // are no-ops once their offset is already back at rest, so
    // re-arming here even when there is nothing left to do is
    // harmless rather than something this needs to check first.
    if (pendingRevealFn) {
        clearTimeout(revealTimer);
        revealTimer = setTimeout(pendingRevealFn, REVEAL_IDLE_MS);
    }
};
// Re-render an open block tooltip after the grid repaints. The mouse
// hasn't moved (no mouseover fires), so swapping city with the keyboard
// would otherwise leave the old city's tooltip on screen. Re-target the
// block at the same grid position and re-show it from fresh state.
const refreshActiveTooltip = () => {
    if (!activeBlock || $('tooltip').style.opacity !== '1') return;
    const el = $('grid').querySelector(
        `.weather-block[data-day="${activeBlock.day}"][data-hour="${activeBlock.hour}"]`);
    if (!el) return hideTooltip();
    // A grid repaint (city/view switch, the day/hour keep-alive ticks
    // below) replaces the block DOM nodes wholesale, so a pinned
    // tooltip's `tappedBlock` reference would otherwise go stale:
    // still pointing at a detached element, so the click handler's
    // "tap the same block again to close it" comparison would never
    // match the live one again. Re-point it at the fresh element for
    // the same grid position, same as `showTooltip` already keeps
    // `activeBlock` current; a hover-only (unpinned) tooltip has
    // `tappedBlock === null` and stays that way.
    const wasPinned = tappedBlock != null;
    showTooltip(el);
    if (wasPinned) tappedBlock = el;
};

// Index of the arrow-key-highlighted search row (-1 = none). Reset
// whenever the results list is rebuilt or the panel closes.
let searchHighlight = -1;
const closeSearch = () => {
    $('searchContainer').classList.remove('active');
    document.querySelector('.container').classList.remove('search-active');
    $('searchInput').value = '';
    $('searchResults').innerHTML = '';
    searchHighlight = -1;
    // Drop focus off the (now hidden) input so the global keydown
    // guard stops treating keystrokes as typing, so arrows work at once.
    $('searchInput').blur();
};

// Native share sheet only on touch devices. On desktop, Web Share is
// redundant and some Chromium builds *kill the tab*
// (RESULT_CODE_KILLED_BAD_MESSAGE) when navigator.share is invoked (a
// renderer crash no try/catch can catch), so desktop copies the link.
const nativeShareOK = () =>
    !!navigator.share && matchMedia('(pointer: coarse)').matches;

// Share (touch) or copy (desktop) a link. Its preview when pasted into
// a messenger comes from the Open Graph tags in <head> + og.png.
const shareLink = async (url, title, what) => {
    if (nativeShareOK()) {
        try { await navigator.share({ title, url }); return; }
        catch (e) { if (e?.name === 'AbortError') return; /* else fall through to copy */ }
    }
    try {
        await navigator.clipboard.writeText(url);
        // Confirmation: overlays the resting line, then clears itself.
        setStatus(`${what} link copied`, 'fresh', { transient: true });
    } catch { setStatus('Copy failed. Copy from the address bar', 'stale', { transient: true }); }
};
// Two targets: this exact place (deep-link), or the plain site URL.
const sharePlace = () => shareLink(shareURL(state.place), `Maybe Rain? · ${state.place.name}`, 'Place');
const shareSite = () => shareLink(location.origin + location.pathname, 'Maybe Rain?', 'Website');

// DR-6: paint state.place's cached forecast, if any. One code path
// for startup and city switches alike. Returns true on a paint; a
// corrupt entry resets state so the skeleton path takes over.
const paintCachedForecast = (anim = null) => {
    const entry = loadForecast(state.place);
    // A fully-expired entry (every hour already in the past) is no
    // better than a miss: the past-day filter would drop all its days
    // and paint an empty grid. Skip it so the skeleton/fetch path takes
    // over cleanly; the startup sweep drops it from storage shortly after.
    if (!entry?.payload || forecastExpired(entry)) return false;
    try {
        state.fetchedAt = entry.timestamp;
        processData(entry.payload);
        updateDisplay(anim);
        return true;
    } catch {
        state.data = []; state.days = []; state.fetchedAt = 0;
        return false;
    }
};

// remember=false keeps savedCities order stable, so ↑/↓ cycling
// steps through the whole list instead of toggling the top two.
const changeCity = (place, remember = true, anim = null) => {
    state.place = place;
    // A new city arrives on the default week and the default hours, the
    // same way the app opens (DR-29 "Entry and exit"): a drawer left open
    // over the old city's day 9 has no meaning against the new one's data,
    // which may not even reach that far.
    resetReveal();
    saveJSON(LS_PLACE, place);
    if (remember) rememberCity(place);
    state.data = []; state.days = []; state.fetchedAt = 0;
    // DR-6: change marks belong to the previous city; a cached paint
    // or startup paint alone never pulses (no new model run to
    // announce). The next differing fetch rebuilds them.
    state.changed = null; state.pulsePending = false;
    renderLocation();
    syncURL(place);
    closeSearch();
    // DR-6: paint this place's cached forecast in the same frame (the
    // status line labels its age honestly), then revalidate in the
    // background; "Updating…" replaces the skeleton path. A place
    // with no cache keeps the skeleton-then-fetch path unchanged.
    // Cached data paints instantly (no animation); the fetch then blinks
    // only the cells whose values changed. With no cache, the skeleton
    // shows now and the first real data reveals with the swipe's
    // directional wave (or a plain left→right sweep when there's no
    // direction, e.g. a search pick).
    const cached = paintCachedForecast(anim);
    nextRevealAnim = cached ? null : (anim || { type: 'reveal' });
    fetchWeather(true);
    scheduleDayRollover(); // new city may sit in a different timezone
    scheduleHourTick();
};

// Ordering: ★ favorites first (always, filtered by the query), then
// (only in the resting list) recents, then live geocoding hits.
// Typing collapses recents but keeps matching favorites above the
// geocoding results, so a starred city is always one keystroke away.
let suggestToken = 0;
const renderSuggestions = async query => {
    const token = ++suggestToken;
    const q = query.trim().toLowerCase();
    const match = c => c.name.toLowerCase().includes(q);
    const favs = q ? favorites.filter(match) : favorites;
    const recents = q ? [] : savedCities.filter(c => !isFav(c));
    const shown = new Set([...favs, ...recents].map(placeKey));
    let hits = [];
    if (q.length >= 2) {
        hits = (await searchCity(query)).map(h => ({
            name: h.name, country: h.country_code || h.country || '',
            admin1: h.admin1 || '', latitude: h.latitude, longitude: h.longitude
        })).filter(p => !shown.has(placeKey(p)));
    }
    if (token !== suggestToken) return; // superseded by a newer query
    state.suggestions = [
        ...favs.map(p => ({ ...p, saved: true, fav: true })),
        ...recents.map(p => ({ ...p, saved: true, fav: false })),
        ...hits.map(p => ({ ...p, saved: isRecent(p), fav: false }))
    ];
    searchHighlight = -1; // list rebuilt: drop any arrow-key highlight
    $('searchResults').innerHTML =
        state.suggestions.map((p, i) =>
            `<div class="search-result" data-i="${i}">
                <span class="result-label"><span class="rl-city">${esc(p.name)}</span>${
                    (p.admin1 || p.country)
                        ? `<span class="rl-region">${p.admin1 ? `, ${esc(p.admin1)}` : ''}${p.country ? `, ${esc(p.country)}` : ''}</span>`
                        : ''
                }</span>
                <span class="result-actions">
                    <button class="fav${p.fav ? ' on' : ''}" data-i="${i}"
                            aria-label="${p.fav ? 'Unfavorite' : 'Favorite'} ${esc(p.name)}"
                            aria-pressed="${p.fav}">${p.fav ? MR_ICON_STAR_SAVED : MR_ICON.star}</button>
                    ${p.saved ? `<button class="forget" data-i="${i}" aria-label="Remove ${esc(p.name)}">${MR_ICON.close}</button>` : `<span class="forget-slot" aria-hidden="true"></span>`}
                </span>
            </div>`
        ).join('');
    // Preselect the first result so pressing Enter has an obvious,
    // visible target. Hover or arrow keys move it from here.
    const firstRow = $('searchResults').querySelector('.search-result');
    searchHighlight = firstRow ? 0 : -1;
    if (firstRow) firstRow.classList.add('highlighted');
};

// --- Events -------------------------------------------------------
// The freshness label doubles as the refresh/retry button: hover or
// keyboard focus shows the explanation, click / Enter / Space refetches.
{
    const s = $('status'), info = $('statusInfo'), tip = $('tooltip');
    // Delay the hide so the pointer can travel from the ⓘ up into the
    // tooltip (to click its link) without it vanishing.
    let hideTimer = null;
    const hold = () => { clearTimeout(hideTimer); hideTimer = null; };
    const drop = () => { hideTimer = setTimeout(hideTooltip, 250); };
    const explain = () => { hold(); showTooltip(info); };
    // The label is one button with several jobs: while the brief "New
    // version" note is up, a tap opens the changelog ("What's new"); once
    // it settles to the resting "↻ Update app" CTA, a tap reloads;
    // otherwise a tap refetches the forecast. The explanation lives on
    // the separate ⓘ so refreshing never triggers the tooltip.
    const refresh = () => {
        hideTooltip();
        if (state.updateNote) { openChangelog(); return; }
        if (state.swUpdate) { location.reload(); return; }
        fetchWeather(true);
    };
    s.addEventListener('click', refresh);
    s.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refresh(); }
    });
    // ⓘ owns the explanation: hover/focus opens it on desktop; a tap
    // toggles it on mobile (where the label's tap is spoken for by
    // refresh). Stop the tap from bubbling to the document handler
    // that would immediately close it again.
    const shown = () => tip.classList.contains('explain') && tip.style.opacity === '1';
    info.addEventListener('mouseenter', explain);
    info.addEventListener('mouseleave', drop);
    info.addEventListener('focus', explain);
    info.addEventListener('blur', hideTooltip);
    info.addEventListener('click', e => {
        e.stopPropagation();
        if (shown()) hideTooltip(); else explain();
    });
    info.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (shown()) hideTooltip(); else explain();
        }
    });
    // Keep it open while the pointer is over the (interactive) tooltip.
    tip.addEventListener('mouseenter', () => { if (tip.classList.contains('explain')) hold(); });
    tip.addEventListener('mouseleave', () => { if (tip.classList.contains('explain')) hideTooltip(); });
}

document.addEventListener('mouseover', e => {
    const el = e.target.closest(TIP_SEL);
    if (el) showTooltip(el);
});
document.addEventListener('mouseout', e => {
    if (e.target.closest(TIP_SEL)) hideTooltip();
});
// Keyboard: blocks and legend cells are tabbable; focus shows the
// same tooltip.
document.addEventListener('focusin', e => {
    const el = e.target.closest(TIP_SEL);
    if (el) showTooltip(el);
});
document.addEventListener('focusout', e => {
    if (e.target.closest(TIP_SEL)) hideTooltip();
});
// Tap/click toggles the tooltip; the same block or anywhere else
// dismisses. Shared by mouse and touch (DR-24: touch no longer
// swallows its trailing synthetic click, reverting DR-18/19's
// hold gesture, so this single handler is back to covering both).
document.addEventListener('click', e => {
    const el = e.target.closest(TIP_SEL);
    if (el) {
        if (tappedBlock === el) return hideTooltip();
        showTooltip(el);
        tappedBlock = el;
    } else {
        // DR-28: also reached by tapping/clicking the open tooltip
        // itself, since it no longer click-through's (see the
        // pointerEvents assignment in showTooltip). e.target is
        // the tooltip or one of its children, which never matches
        // TIP_SEL, so it falls here and closes, same as any other
        // outside tap.
        hideTooltip();
    }
});

const openSearch = () => {
    toggleSettings(false);
    if ($('searchContainer').classList.contains('active')) { $('searchInput').focus(); return; }
    $('searchContainer').classList.add('active');
    document.querySelector('.container').classList.add('search-active');
    renderSuggestions(''); // saved cities + geolocate, before any typing
    $('searchInput').focus();
};
// The whole top strip is the search target, not just the city name.
// A tap anywhere in the header row opens search (the target is wide
// and forgiving), except on the gear, the open settings panel, or the
// active field/results themselves. No visible affordance: the header
// reads as tappable on its own, and the ↓ arrow already hints "change".
document.querySelector('.location-wrapper').addEventListener('click', e => {
    // Selecting a result clears the list, detaching the clicked row
    // before this bubbles up; a detached target has no ancestors, so
    // the .search-container guard below would miss and wrongly re-open
    // search. Bail on detached targets (matches the outside-click guard).
    if (!e.target.isConnected) return;
    if (e.target.closest('#gear') || e.target.closest('.settings')) return;
    if (e.target.closest('.search-container')) return; // don't re-fire on the open field
    openSearch();
});
// Keyboard-operable location control
$('location').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSearch(); }
});

// --- Settings menu: the app's only menu ---------------------------
const renderSettings = () => {
    const seg = (key, options) => `<div class="seg">${options.map(([val, label]) =>
        `<button data-key="${key}" data-val="${val}"
                 class="${String(settings[key]) === val ? 'active' : ''}">${label}</button>`
    ).join('')}</div>`;
    $('settings').innerHTML =
        `<div class="setting-row"><span>Units</span>${seg('unit', [['C', '°C'], ['F', '°F']])}</div>` +
        `<div class="setting-row"><span>Clock</span>${seg('clock', [['12', '12h'], ['24', '24h']])}</div>` +
        `<div class="setting-row"><span>Hours</span>${seg('allHours', [['false', '6–21'], ['true', '24h']])}</div>` +
        `<div class="setting-row"><span>Wind</span>${seg('windUnit', [['kmh', 'km/h'], ['mph', 'mph'], ['kn', 'kn']])}</div>` +
        `<div class="setting-row"><span>Views</span><div class="seg">${VIEWS.map(v =>
            `<button data-viewkey="${v}" class="${settings.views[v] ? 'active' : ''}">${v}</button>`).join('')}</div></div>` +
        `<div class="setting-row"><span>Key</span>${seg('legend', [['true', 'show'], ['false', 'hide']])}</div>` +
        `<div class="setting-row"><span>Sun</span>${seg('sunLines', [['true', 'show'], ['false', 'hide']])}</div>` +
        `<div class="setting-row"><span>${MR_ICON.heat} heat ≥</span>${seg('heatWarn',
            [30, 35, 40].map(t => [String(t), `${displayTemp(t)}°`]))}</div>` +
        `<div class="setting-row"><span>${MR_ICON.uv} UV ≥</span>${seg('uvWarn',
            [['8', '8'], ['10', '10'], ['11', '11']])}</div>` +
        installSettingsRow() +
        `<div class="setting-row"><span>Share</span>` +
        `<div style="display:flex;gap:6px;">` +
        `<button class="btn" id="shareBtn" style="padding:5px 10px;font-size:12px;" title="${nativeShareOK() ? 'Share' : 'Copy'} a link to this place">${nativeShareOK() ? 'Place' : 'Copy place'}</button>` +
        `<button class="btn" id="shareSiteBtn" style="padding:5px 10px;font-size:12px;" title="${nativeShareOK() ? 'Share' : 'Copy'} the website link">${nativeShareOK() ? 'Link' : 'Copy link'}</button>` +
        `</div></div>` +
        `<div class="setting-row"><span>What's new</span>` +
        `<button class="btn" id="whatsNewBtn" style="padding:5px 10px;font-size:12px;" title="See what changed in recent versions">view</button></div>` +
        `<div class="setting-row"><span>Hourly data</span>` +
        `<button class="btn" id="hourlyBtn" style="padding:5px 10px;font-size:12px;" title="How hourly data is made">view</button></div>` +
        (matchMedia('(pointer: fine)').matches
            ? `<div class="shortcuts-hint">
                 <div class="sc"><span>Search</span><span>${MOD}K</span></div>
                 <div class="sc"><span>Switch city</span><span>↑ ↓</span></div>
                 <div class="sc"><span>Switch view</span><span>← →</span></div>
               </div>`
            : '');
};
const toggleSettings = open => {
    const willOpen = open ?? $('settings').classList.contains('hidden');
    $('settings').classList.toggle('hidden', !willOpen);
    $('gear').setAttribute('aria-expanded', willOpen);
    document.querySelector('.container').classList.toggle('settings-open', willOpen);
    if (willOpen) renderSettings();
};
$('gear').onclick = () => { closeSearch(); toggleSettings(); };
$('settings').addEventListener('click', e => {
    const seg = e.target.closest('button[data-key]');
    if (seg) {
        const { key, val } = seg.dataset;
        settings[key] = (key === 'allHours' || key === 'legend' || key === 'sunLines') ? val === 'true'
            : (key === 'heatWarn' || key === 'uvWarn') ? +val : val;
        saveJSON(LS_SETTINGS, settings);
        applyPrefs();
        renderSettings();
        return;
    }
    const vk = e.target.closest('button[data-viewkey]');
    if (vk) { // multi-toggle: each view on/off independently
        const v = vk.dataset.viewkey;
        if (settings.views[v] && enabledViews().length === 1) return; // keep at least one
        settings.views[v] = !settings.views[v];
        saveJSON(LS_SETTINGS, settings);
        if (!settings.views[view]) setView(enabledViews()[0]);
        else renderViewToggle();
        renderSettings();
        return;
    }
    if (e.target.id === 'installBtn') { promptInstall(); return; }
    if (e.target.id === 'shareBtn') { sharePlace(); return; }
    if (e.target.id === 'shareSiteBtn') { shareSite(); return; }
    if (e.target.id === 'whatsNewBtn') { openChangelog(); return; }
    if (e.target.id === 'hourlyBtn') { openHourly(); return; }
});

// --- Modal shell (shared by the changelog and the hourly-data
// explainer, and any future settings-menu modal) ------------------
// Both are the same interaction: opened from the settings menu, a
// scrim + panel + close button, tap-outside or Escape to dismiss,
// focus parked on close and restored to whatever opened it. Only
// what each one shows differs, so that's all that stays modal-
// specific below (loading CHANGELOG.md vs. lazily mounting an
// iframe). registerModal wires the shared plumbing once per id;
// modalClosers (keyed by scrim id) is what the generic scrim-click
// and Escape handlers use to find the right close function.
const modalReturnFocus = {};
const modalClosers = {};
const openModal = id => {
    toggleSettings(false);
    modalReturnFocus[id] = document.activeElement;
    show($(id), true);
    $(id).querySelector('.modal-close').focus();
};
const closeModal = id => {
    show($(id), false);
    const rf = modalReturnFocus[id];
    if (rf && rf.focus) rf.focus();
};
const registerModal = (id, closeFn) => {
    modalClosers[id] = closeFn;
    $(id).querySelector('.modal-close').onclick = closeFn;
    // Tap the scrim (outside the panel) to dismiss.
    $(id).addEventListener('click', e => { if (e.target.id === id) closeFn(); });
};

// --- Changelog ("What's new") -----------------------------------
// Shows CHANGELOG.md as-is in a <pre>: the file is already laid out for a
// monospace read, so there's no markdown library: a small line-by-line
// parser below turns its handful of constructs (# title, ## version,
// ### section, - bullet, `code`) into real elements, styled by the
// .changelog-body rules above. build.mjs ships CHANGELOG.md as-is, so
// it stays the single source of truth and this stays a pure-CSS
// upgrade: no extra request, no parser shipped to do more than this
// file ever needs. Fetched fresh when online (a just-deployed
// version's notes show before the reload), with the SW's cached copy
// as the offline fallback.
let changelogHTML = null;

const renderChangelog = md => {
    let html = '', inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const raw of md.split('\n')) {
        const line = esc(raw).replace(/`([^`]+)`/g, '<code>$1</code>');
        if (/^#\s/.test(line)) continue; // drop the file's own "# changelog" title
        if (/^##\s/.test(line)) {
            closeList();
            // "v43 (2026-07-28)" → version leads, date trails muted.
            const text = line.replace(/^##\s+/, '');
            const m = text.match(/^(\S+)\s*(\(.*\))?$/);
            html += m ? `<h2>${m[1]}${m[2] ? ` <span class="cl-date">${m[2]}</span>` : ''}</h2>` : `<h2>${text}</h2>`;
        } else if (/^###\s/.test(line)) {
            closeList();
            html += `<h3>${line.replace(/^###\s+/, '')}</h3>`;
        } else if (/^-\s+/.test(line)) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += `<li>${line.replace(/^-\s+/, '')}</li>`;
        } else if (line.trim() === '') {
            closeList();
        } else {
            closeList();
            html += `<p>${line}</p>`;
        }
    }
    closeList();
    return html;
};

const openChangelog = async () => {
    openModal('changelog');
    const body = $('changelogBody');
    if (changelogHTML != null) { body.innerHTML = changelogHTML; body.scrollTop = 0; return; }
    body.textContent = 'Loading…';
    const load = async bust => {
        // Cache-bust so the SW's cache-first rule can't hand back a stale
        // copy; that's what surfaces a just-deployed version's notes
        // before the app reloads onto it.
        const url = bust ? `CHANGELOG.md?_=${Date.now()}` : 'CHANGELOG.md';
        const res = await fetch(url, bust ? { cache: 'no-store' } : {});
        if (!res.ok) throw new Error(res.status);
        return res.text();
    };
    try {
        changelogHTML = renderChangelog(await load(true).catch(() => load(false)));
        body.innerHTML = changelogHTML;
        body.scrollTop = 0;
    } catch {
        body.textContent = 'Couldn’t load the changelog. Check your connection and try again.';
    }
};
const closeChangelog = () => closeModal('changelog');
registerModal('changelog', closeChangelog);

// --- Hourly-data explainer (iframe modal) -------------------------
// Keeps how-hourly-data-is-made.html out of this bundle and out of
// the initial load entirely: the iframe has no src until the user
// opens the modal, so the ~70KB page and its own script only ever
// load on demand. Closing tears the iframe back down (empties its
// src) rather than just hiding the modal, so it isn't left running
// in the background and always starts fresh next time.
//
// This page is edited independently of app releases and changes
// often, so it deliberately opts out of every caching layer rather
// than joining CHANGELOG.md's cache-bust-with-fallback dance: sw.js
// passes it straight to the network (no SW cache entry to go stale),
// and the timestamp query param here defeats the browser's own HTTP
// cache too. A stale copy simply never happens; there's nothing to
// bust.
const openHourly = () => {
    const body = $('hourlyBody');
    if (!body.querySelector('iframe')) {
        const f = document.createElement('iframe');
        f.title = 'How hourly weather data is made';
        f.src = `how-hourly-data-is-made.html?_=${Date.now()}`;
        body.appendChild(f);
    }
    openModal('hourly');
};
const closeHourly = () => {
    $('hourlyBody').innerHTML = ''; // drop the iframe: no lingering background page
    closeModal('hourly');
};
registerModal('hourly', closeHourly);

// --- Grid gestures: one-finger swipe + arrow keys ----------------
const chart = document.querySelector('.chart');
// Vertical stepping used to live here as `stepCity`, a plain jump with
// no rail, no counter and no animation of its own beyond the grid's
// wave. It is gone: DR-32 left the keyboard out of the detented
// selector entirely, and `keyStepCity` below (defined next to the rail
// machinery it now drives) replaces it, closing that gap. See
// SPEC.md's DR-32, "The keyboard was left alone", for the decision
// this supersedes.
const stepView = dir => {
    const enabled = enabledViews();
    if (enabled.length < 2) return;
    const i = enabled.indexOf(view);
    // Horizontal wave: the new view enters from the side it sits on, so
    // next (→ in the toolbar) fills right→left and previous fills left→right.
    setView(enabled[(i + dir + enabled.length) % enabled.length], { type: 'wave', axis: 'x', dir: -Math.sign(dir) });
};

// One-finger gestures on the grid. HORIZONTAL cycles views (swipe
// left = next, carousel-style), guarded as before: >60px, one axis
// clearly dominant, single finger, decided on release. The toggle
// buttons remain the visible state indicator. VERTICAL is no longer a
// one-shot step. See the DR-32 selector below.
//
// A touch that stays under the swipe threshold is a plain tap and
// is left alone here: it falls through to the browser's own
// trailing synthetic click, which the shared click handler above
// already treats as tap-to-pin (same code path as a mouse click).
// DR-24 (reverts DR-18 through DR-23): those decisions replaced
// this plain tap with a press-and-hold gesture (dwell-gated
// against this same swipe, live drag-to-scrub, a further hold
// threshold to lock the tooltip open, haptic ticks on open/scrub/
// lock). In daily use, hold-to-open turned out worse than the tap
// it replaced: fiddly to trigger deliberately, and the thing it
// was meant to fix (closing needed an exact re-tap on a small
// block) is no longer a problem once tap-elsewhere-to-close (see
// the click handler above) does that job instead of same-block
// re-tap alone. See SPEC.md DR-24 for the full writeup.
//
// DR-25/26/27 (long-press-to-pin, its haptics, and drag-to-scrub
// once pinned) were tried on top of this and then dropped, per
// DR-28: an open (non-pinned) tooltip already survives a city/view
// swipe on its own (activeBlock/refreshActiveTooltip below
// re-targets the same grid position on every repaint, and a swipe
// never fires the trailing click that would close it), which
// turned out to be all the "compare across a swipe" behavior
// actually needed; the separate pinned tier and its gestures were
// extra complexity without a use it uniquely served. See SPEC.md
// DR-28. What's left is exactly the DR-24 shape: swipe detection
// only, no timers, no pin state, no haptics.
// DR-32 (2026-07-28) replaces the vertical half of the above with a
// detented multi-step selector. DR-30 (2026-07-28) replaces the
// horizontal half with a scrub: the same 60px still decides it, but the
// wave now plays under the finger and the outcome is read off where the
// playhead was left rather than off a distance measured at release.
//
// Vertical travel maps to a CONTINUOUS position in the ★ list, which is
// CLAMPED at both ends rather than wrapping: the first and last
// favourite are hard stops, not neighbours. Each city owns a band whose
// first half (DWELL) is PARKED, the target does not change and the
// indicator visibly stops while the finger keeps moving, and whose
// second half crosses to the next. That is what "somewhere to aim"
// means mechanically: the list has detents, like a rotary switch,
// rather than knife-edges to balance on. It is safe to add despite
// DR-18/19/24 because it is a DISTANCE threshold, the class this
// project already trusts (the 60px commit, the 10px slop), not the
// time-or-velocity class that burned those decisions.
const STEP_PX = 90;                     // travel the FIRST city costs
const DWELL = 0.5;                      // share of each step spent parked
const RAMP_R = 0.86, RAMP_FLOOR = 0.55; // each city costs 86% of the last
const CITY_SLOP = 10;                   // a touch is a tap until it moves this far
const FLICK_VEL = 900, FLICK_MIN = 40;  // read ONCE, at release
const VIBE_DETENT = [2];                // one 2ms tick, barely-there; Android only
const RUNG_GAP = 17, RAIL_SPAN = 4;

// --- DR-30: the horizontal view scrub -----------------------------
// Brought in line with the ★ list's own standard (owner call,
// 2026-07-29): a bit more travel than the original 120, and a linger
// before the transition starts rather than the screen moving from the
// first pixel of the drag. 150 is the raw distance the drag now
// spans; `scrubProgress` below is what actually turns that into the
// dwell-then-ramp shape, borrowing the city selector's own DWELL
// fraction so the two swipes stall the same way before they commit.
const SCRUB_PX = 150;
// The scrub's own linger: the first DWELL share of SCRUB_PX is a dead
// zone where the screen does not move at all (the "pause on the
// actual screen" the city selector already has), and only the
// remainder ramps the wave toward the destination. Unlike the city
// selector's growing list there is only ever one destination to ramp
// toward here, so there is nothing beyond that first band to
// floor/ceil; this is DWELL applied to a single step, not a list.
const scrubProgress = travel => {
    const dw = DWELL * SCRUB_PX, cr = SCRUB_PX - dw;
    return travel <= dw ? 0 : Math.min(1, (travel - dw) / cr);
};
// Half of SCRUB_PX in PROGRESS terms, i.e. where `scrubProgress`
// reaches 0.5, which the dwell above pushes out past SCRUB_PX/2 in
// raw pixels. Kept as one derived constant so the live scrub (which
// decides off `scrubProgress` directly) and the reduced-motion/
// one-view fallback below (which has no progress to read, only a raw
// distance) commit at the same pull either way.
const SCRUB_COMMIT_PX = SCRUB_PX * (0.5 + 0.5 * DWELL);
// A rewind is faster than a completion, but not instant: a scrub
// abandoned at 15px would otherwise snap back inside a single frame.
const REWIND_MIN_MS = 120;
let viewScrub = null;  // { dir, dest, travel, cache } while a scrub is live

// Reduced motion is the one thing that turns the scrub off outright
// (owner call, 2026-07-28, closing DR-30's open question the opposite
// way from its prototypes, which left the scrub following the finger on
// the reasoning that direct manipulation is not really an animation).
// With it on, the horizontal axis is byte-for-byte the pre-DR-30
// gesture: nothing moves during the drag and the view swaps at
// SCRUB_COMMIT_PX on release, which `paintGrid` already renders
// instantly.
const viewScrubLive = () => enabledViews().length >= 2
    && !matchMedia('(prefers-reduced-motion: reduce)').matches;

// The destination grid for a view, built once per drag and reused. Same
// city, same window, so it is the same shape by construction; `fitCols`
// is belt and braces against a repaint landing mid-drag.
const viewColsFor = v => {
    if (viewScrub.cache.has(v)) return viewScrub.cache.get(v);
    const ref = (wave ? wave.to : lastCols) || buildCols();
    const nCols = ref.length, nRows = ref[0] ? ref[0].length : 0;
    const keep = view;
    let built;
    try { view = v; built = fitCols(buildCols(), nCols, nRows); }
    finally { view = keep; }
    viewScrub.cache.set(v, built);
    return built;
};

const scrubView = dx => {
    const en = enabledViews();
    const want = dx < 0 ? 1 : -1;   // drag left = next, carousel-style
    // Direction is the SIGN OF `dx`, re-read every move, so it re-locks
    // the instant the drag returns through the origin. One unbroken
    // touch can therefore go out toward temp, back past zero and on
    // toward wind without lifting, the same requirement that got
    // polarity rejected as a separator on the other axis: the return
    // trip must have a gesture too.
    //
    // The prototype re-locks only within 4px of the origin. That is
    // deliberately not ported: it is a threshold on the SAMPLING RATE
    // rather than on the gesture, so a finger that crosses the origin
    // faster than the events arrive skips the window and steers the
    // wrong way, the class of failure DR-18/19 were reverted for.
    // The sign of `dx` cannot be skipped, needs no constant, and says
    // the same thing: the finger is on the other side of where it
    // started. It also makes the mapping a pure function of position,
    // which is what DR-32 insisted on for the other axis.
    if (want !== viewScrub.dir) {
        viewScrub.dir = want;
        viewScrub.dest = en[(en.indexOf(view) + want + en.length) % en.length];
    }
    const travel = Math.abs(dx);
    viewScrub.travel = travel;
    // The sweep enters from the side the destination sits on, the same
    // coupling `stepView` uses for a tap or an arrow key. The underline
    // is not driven from here: it is driven off the playhead in
    // `waveFrame`, so the scrub, the completion and the rewind all move
    // it by one rule instead of three.
    scrubWave($('grid'), viewColsFor(viewScrub.dest), -viewScrub.dir,
        scrubProgress(travel), viewScrub.dest);
};

// The one decision on this axis, made once, on release. A fast flick and
// a slow drag both arrive here and differ only in where they left the
// playhead, which is exactly the difference that should matter, so
// there is no velocity term on this path at all. A flick was never a
// different intention from a drag, only the same one performed quickly,
// and it always travels far past the commit pull before the finger
// lifts, so it already satisfies the only rule left. Removing the
// detection does not remove the gesture; it stops treating it as a
// special case.
const endViewScrub = () => {
    const vs = viewScrub;
    viewScrub = null;
    if (!vs) return;
    const commit = vs.travel > SCRUB_COMMIT_PX;
    if (!wave || !wave.scrub) {
        // A repaint landed mid-drag and took the sweep with it. Nothing
        // to complete or rewind; just honour the decision.
        renderViewBar();
        if (commit) setView(vs.dest, { type: 'wave', axis: 'x', dir: -vs.dir });
        return;
    }
    wave.scrub = false;
    if (commit) {
        // Completion CONTINUES from wherever the finger left it, at 1x,
        // so the grid never jumps backwards before going forwards and
        // the remaining duration is already the distance left.
        wave.rate = 0;
        wave.onSettle = () => setView(vs.dest, 'instant');
    } else {
        // Rewind to the view that is still committed, playing the
        // transition backwards rather than cutting to its start. The
        // rate is computed from where the playhead was left rather than
        // taken as the bare REWIND_RATE constant, so a barely-started
        // scrub runs visibly back instead of vanishing between frames.
        wave.rewind = true;
        wave.rate = wave.t / Math.max(REWIND_MIN_MS, wave.t / REWIND_RATE);
    }
    waveRelease();
};

// The k-th city costs less than the one before it, BY DISTANCE rather
// than by speed. A rate-scaled mapping would have to be integrated (the
// multiplier depends on how fast the finger was moving at each moment,
// not on where it now is), so going out fast and returning slowly to the
// identical pixel would not return to the starting city. That breaks
// both reversibility and aiming; a distance ramp keeps the benefit and
// loses neither.
const bandSize = k => Math.max(STEP_PX * RAMP_FLOOR, STEP_PX * Math.pow(RAMP_R, k));
const mapTravel = signedPx => {
    const sgn = Math.sign(signedPx) || 1, a = Math.abs(signedPx);
    let acc = 0, k = 0;
    while (k < 80) {
        const s = bandSize(k);
        if (a < acc + s) {
            const rem = a - acc, dw = DWELL * s, cr = s - dw;
            const p = rem <= dw ? 0 : (cr > 0 ? (rem - dw) / cr : 1);
            return { sgn, latch: sgn * k, p, pos: sgn * (k + p) };
        }
        acc += s; k++;
    }
    return { sgn, latch: sgn * k, p: 0, pos: sgn * k };
};
// Clamped, not wrapped: the first and last ★ favourite are hard stops.
// Swiping past either end simply runs out of list rather than looping
// back around to the other side.
const cityClamp = i => Math.max(0, Math.min(favorites.length - 1, i));
// Honesty guard: stepCity cycles ★ favourites only and returns early on
// fewer than two, so the gesture and every cue it draws are suppressed
// outright rather than arming and then doing nothing.
const citySwapLive = () => favorites.length >= 2;

let touchNav = null;   // { x, y, axis, claimed, v, lastY, lastT }
let citySel = null;    // { base, pos, latch, parked, armed, lastDetent, target, cache }

const renderCitySel = () => {
    const box = $('citySel');
    if (!citySel || !citySel.armed) { box.hidden = true; box.innerHTML = ''; return; }
    const n = favorites.length;
    const H = (2 * RAIL_SPAN + 1) * RUNG_GAP, mid = H / 2;
    const lo = Math.floor(citySel.pos) - RAIL_SPAN, hi = Math.ceil(citySel.pos) + RAIL_SPAN;
    let out = `<div class="city-rail" style="height:${H}px">`;
    for (let i = lo; i <= hi; i++) {
        const y = mid + (i - citySel.pos) * RUNG_GAP;
        if (y < -8 || y > H + 8) continue;
        out += `<i class="${i === 0 ? 'home' : ''}" style="top:${(y - 2.5).toFixed(1)}px"></i>`;
    }
    out += `<div class="city-pin${citySel.parked ? ' parked' : ''}" style="top:${(mid - 5.5).toFixed(1)}px"></div></div>`;
    box.innerHTML = out;
    box.hidden = false;
    // The name already in gold is the destination readout; the counter
    // says where that sits in the list, which is the standing "know
    // where you are in the swap order" gap.
    $('locationName').textContent = favorites[citySel.target].name;
    $('cityCount').textContent = `${citySel.target + 1}/${n}`;
};
const clearCitySel = () => {
    citySel = null;
    $('citySel').hidden = true; $('citySel').innerHTML = '';
    $('cityCount').textContent = '';
};

// The destination grid for a rung, built once per drag and reused: a
// 90px step can be crossed many times in one sweep, and rebuilding the
// whole grid on every touchmove would drop frames for no gain.
const cityColsFor = idx => {
    if (citySel.cache.has(idx)) return citySel.cache.get(idx);
    // The frame's shape comes from the grid as it currently stands, NOT
    // from a wave: at the start of a drag there is nothing in flight to
    // ask, and a zero-row shape here would have paintGrid rebuild the
    // grid as seven empty columns.
    const ref = (wave ? wave.to : lastCols) || buildCols();
    const nCols = ref.length, nRows = ref[0] ? ref[0].length : 0;
    const built = fitCols(colsForPlace(favorites[idx]), nCols, nRows);
    citySel.cache.set(idx, built);
    return built;
};

chart.addEventListener('touchstart', e => {
    // Origin gate (DR-29): a drag that starts on a rail belongs to that
    // rail's reveal. The rails sit INSIDE .chart, so their touches also
    // bubble here. Without this the hour peek would peek hours and
    // switch city off the same finger.
    if (e.target.closest?.('.rail')) { touchNav = null; return; }
    if (e.touches.length !== 1) { touchNav = null; return; }
    const t = e.touches[0];
    touchNav = { x: t.clientX, y: t.clientY, axis: null, claimed: false, v: 0, lastY: t.clientY, lastT: performance.now() };
}, { passive: true });

chart.addEventListener('touchmove', e => {
    if (!touchNav || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touchNav.x, dy = t.clientY - touchNav.y;

    // A touch is a TAP until it has moved CITY_SLOP. Below that nothing
    // renders and nothing is preventDefault-ed, so the touch falls
    // through to the browser's trailing synthetic click and the existing
    // tap-to-open-tooltip path runs untouched. The two paths are
    // mutually exclusive by construction, not by a race.
    //
    // DR-30 calls this ordering the sharpest implementation constraint
    // in its whole design, and it is already solved here: this is the
    // handler the horizontal scrub extends, not one it has to write.
    // Get it wrong in either direction and you either leave a stray
    // tooltip after every swipe or stop tapping from working at all.
    if (!touchNav.axis) {
        if (Math.hypot(dx, dy) < CITY_SLOP) return;
        touchNav.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        // Deliberately NOT closing an open tooltip and NOT clearing
        // tappedBlock, on either axis. DR-28: a tap-opened tooltip
        // survives a city or view change and re-targets the same grid
        // position, which is the whole "compare across a swipe"
        // behaviour. The scrub calls preventDefault from here on, so no
        // trailing synthetic click ever arrives and this touch cannot
        // retroactively become a tap, by construction, without
        // disturbing the tooltip that is already open.
        if (touchNav.axis === 'x') {
            // DR-30: the horizontal axis is a scrub now. With fewer than
            // two views, or under reduced motion, it claims nothing and
            // renders nothing and falls through to the one-shot swipe
            // decided at release below, exactly the pre-DR-30 gesture.
            if (!viewScrubLive()) return;
            touchNav.claimed = true;
            viewScrub = { dir: 0, dest: null, travel: 0, cache: new Map() };
        } else {
            if (!citySwapLive()) { touchNav = null; return; }
            touchNav.claimed = true;
            citySel = {
                base: Math.max(0, favorites.findIndex(c => placeKey(c) === placeKey(state.place))),
                pos: 0, latch: 0, parked: true, armed: false, lastDetent: 0,
                target: 0, listDir: 1, cache: new Map()
            };
            citySel.target = citySel.base;
        }
    }
    if (!touchNav.claimed) return;
    e.preventDefault();   // scrub, don't pan the page

    // DR-30: the horizontal half. No velocity is measured on this path,
    // let alone acted on.
    if (touchNav.axis === 'x') { scrubView(dx); return; }

    // Velocity is measured throughout but ACTED ON only once, at release,
    // and only by the flick rule.
    const now = performance.now(), dt = Math.max(8, now - touchNav.lastT);
    touchNav.v = touchNav.v * 0.7 + ((t.clientY - touchNav.lastY) / dt * 1000) * 0.3;
    touchNav.lastY = t.clientY; touchNav.lastT = now;

    const signed = -dy;   // up is positive: LATER in the list (DR-32 §2)
    const m = mapTravel(signed);
    const prevPos = citySel.pos;
    // Clamped to the list's own ends (favorite 0 .. favorites.length-1),
    // relative to where this drag started. Past either end the position
    // simply stops advancing (the same hard stop a release would land
    // on) rather than the continuous position running on unbounded and
    // wrapping the target back around.
    const minPos = -citySel.base, maxPos = (favorites.length - 1) - citySel.base;
    const pos = Math.max(minPos, Math.min(maxPos, m.pos));
    const latch = Math.max(minPos, Math.min(maxPos, m.latch));
    const atEnd = pos === minPos || pos === maxPos;
    citySel.pos = pos; citySel.latch = latch;
    citySel.parked = atEnd || m.p <= 0.0001;
    citySel.travel = signed;
    citySel.armed = Math.abs(signed) > DWELL * STEP_PX;

    // One 2ms tick the moment the finger settles into a dwell band it
    // was not already in. Keyed on WHICH detent rather than on the
    // parked/crossing edge: a single fast touchmove can span a whole
    // crossing band, and an edge test would silently drop the tick for
    // every step the finger jumped over. Nothing on crossings,
    // retargets, release or landing.
    if (citySel.parked && latch !== citySel.lastDetent) {
        citySel.lastDetent = latch;
        navigator.vibrate?.(VIBE_DETENT);
    }

    // The aim is whichever rung a release would land on, so what is on
    // screen is always what you would get. The playhead is NOT driven by
    // the finger: the finger only chooses a destination and the wave
    // runs at the shipped tempo however fast it got there. A fast
    // traversal therefore shows one continuous sweep that happens to end
    // on the fourth city; a deliberate one that parks in each dwell band
    // completes each wave and shows every city on the way.
    const stepNow = Math.round(pos), stepWas = Math.round(prevPos);
    const target = cityClamp(citySel.base + stepNow);
    // Which way the LIST is moving, read from the change in rounded
    // position rather than from raw finger jitter, and falling back to
    // which side of the origin the finger is on when the position did
    // not change. The sweep is the negation of it, so an upward pull
    // (later entries, +1) sweeps with dir −1 and rises from the bottom
    // row: everything visible moves WITH the finger.
    //
    // Reading it from the list rather than from the sign of `dy`
    // matters in exactly one case, and it is the case this DR cares
    // about: coming back down from three cities up, the finger is still
    // above where it started but the list is now moving the other way,
    // so the sweep must reverse: rewind to what is on screen, then set
    // off the other way with the stagger flipped. Keying on `dy` would
    // leave the direction unchanged and silently retarget instead.
    const listDir = stepNow === stepWas
        ? (Math.sign(pos) || citySel.listDir || 1)
        : Math.sign(stepNow - stepWas);
    citySel.listDir = listDir;
    if (target !== citySel.target || stepNow !== stepWas) {
        citySel.target = target;
        waveTo($('grid'), cityColsFor(target), -listDir, { axis: 'y', hold: true });
    }
    renderCitySel();
}, { passive: false });

const endTouchNav = e => {
    const nav = touchNav;
    touchNav = null;
    if (!nav) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - nav.x, dy = t.clientY - nav.y;

    // DR-30: the scrub decides itself, off the travel that was actually
    // mapped onto the playhead, so what you get is what was on screen.
    if (nav.axis === 'x' && viewScrub) { endViewScrub(); return; }

    if (!nav.claimed) {
        // The pre-DR-30 horizontal swipe, still the path under reduced
        // motion and with a single view enabled: one axis clearly
        // dominant, decided at release, past SCRUB_COMMIT_PX, the same
        // pull the live scrub commits at, so the distance needed to
        // switch a view is identical either way and the scrub only
        // makes visible a threshold that was always there. There is no
        // velocity term here to remove: the horizontal flick DR-30
        // abolishes was never a separate code path in this app, only a
        // fast drag past the same threshold.
        if (Math.abs(dx) > SCRUB_COMMIT_PX && Math.abs(dx) > 2 * Math.abs(dy)) stepView(dx < 0 ? 1 : -1);
        // else a plain tap: the trailing synthetic click opens the tooltip.
        return;
    }

    // A flick's outcome is DEFINED as ±1, not computed from distance, so
    // it cannot overshoot: a fast 200px throw is one step, not two. This
    // is the one code path in the app whose behaviour depends on how fast
    // you moved. Three things contain it: it is read once, here, never
    // during the drag; its outcome is defined rather than derived; and a
    // misread gives one city instead of the aimed one, recoverable in a
    // second gesture rather than an unrecoverable wrong state.
    const travel = Math.abs(dy);
    const fast = Math.abs(nav.v) > FLICK_VEL && travel > FLICK_MIN;
    const steps = fast ? (-Math.sign(nav.v) || 1) : Math.round(citySel.pos);
    const target = cityClamp(citySel.base + steps);
    // Same rule as during the drag: the sweep is the negation of the way
    // the list is moving, so a flick that resolves to one step up sweeps
    // upward even if the finger had wandered.
    const dir = -(Math.sign(steps) || citySel.listDir || 1);
    const place = favorites[target];
    const cols = place ? cityColsFor(target) : null;

    clearCitySel();
    renderLocation();

    if (!place || placeKey(place) === placeKey(state.place)) {
        // Back where it started: let whatever is in flight rewind and
        // settle on the city already on screen. Nothing commits.
        waveRelease();
        return;
    }
    // Sweep to the destination on the wave's own clock, then commit once
    // it settles. changeCity then repaints instantly onto exactly the
    // grid the sweep just landed on, so the commit itself is invisible.
    waveTo($('grid'), cols, dir, { axis: 'y' });
    waveRelease();
    if (wave) wave.onSettle = () => changeCity(place, true, null);
    else changeCity(place, true, null);
};
chart.addEventListener('touchend', endTouchNav);
chart.addEventListener('touchcancel', () => {
    // A cancelled scrub is an abandoned one: rewind, commit nothing.
    if (viewScrub) { viewScrub.travel = 0; endViewScrub(); }
    else if (touchNav?.claimed) { clearCitySel(); waveRelease(); renderLocation(); }
    touchNav = null;
});

// --- The two reveals: more hours, more days (DR-29) ---------------
// Both swipe axes were already taken: horizontal switches the view,
// vertical switches the city. So "pull for more hours" lands exactly on
// the city gesture and "pull for more days" lands on the view gesture,
// and there is no free axis to move either onto.
//
// Both are separated by ORIGIN instead: a reveal is armed only by a drag
// that STARTS on its own rail (#hourRail, the time-label gutter;
// #dayRail, the day-label row), and a drag that starts anywhere on the
// grid field is a view or city swipe exactly as before. That makes the
// two collision-free by construction, with no velocity threshold
// anywhere and no second gesture recognizer competing with the one in
// the handler above. DR-29 designed the hour peek as a velocity-gated
// drag on the grid body instead; the rail was chosen over it (owner
// call, 2026-07-28), which also removes the last tuned threshold the
// design had left, the class of thing DR-18/19 were reverted for.
//
// Each rail reuses the same movement math as the swipe above: a drag is
// nothing at all until it has travelled REVEAL_SLOP, and only then does
// it claim the gesture. Below the slop nothing renders and nothing is
// preventDefault-ed, so a stray touch on a rail still behaves like an
// ordinary touch on the page.
const REVEAL_SLOP = 10;   // px before a rail drag is a reveal at all
const REVEAL_IDLE_MS = 4000; // latched drawer's own way home
const REVEAL_HOME_MS = 220;  // the going-home tween's own duration
// A straight 1:1 track (one row/column per `per` px) read as too fast to
// aim: the reveal was past the notch you meant to land on before the
// finger felt like it had gone anywhere. REVEAL_SENS asks for more
// travel per notch, and mapRailNotches below borrows the ★ list's own
// DWELL fraction so each notch has the same built-in linger a vertical
// city swipe has: a dead first half where nothing moves yet, then a
// ramp across the second half to the next notch. Unlike the city
// selector's bands this one does not shrink; every notch on a rail
// costs the same, so there is nothing to ramp beyond that.
const REVEAL_SENS = 1.6;
// Returns the pieces separately (not just the combined position) so
// the EXPERIMENTAL crossfade below can tell which notch is being
// departed (`k`) from how far across it is (`p`), rather than only
// the rounded whole the shipped instant path needs.
const mapRailNotches = (raw, unit) => {
    const sgn = Math.sign(raw) || 1, a = Math.abs(raw);
    const k = Math.floor(a / unit);
    const rem = a - k * unit, dw = DWELL * unit, cr = unit - dw;
    const p = rem <= dw ? 0 : (cr > 0 ? (rem - dw) / cr : 1);
    return { sgn, k, p };
};

// ==================================================================
// EXPERIMENTAL (2026-07-29): continuous crossfade for the day/hour
// rails, reusing the same wave engine the view switch already uses
// (`waveTo`/`scrubWave`) instead of the instant per-notch repaint.
// Diagnosis: the rails' swipe INPUT was already smooth and tuned
// (dwell, sensitivity); the OUTPUT was a hard cut every notch, which
// is what read as jittery next to the view switch's gradual colour
// swap. Everything this pass touches is tagged EXPERIMENTAL. Grep
// for it to find every spot: this block, the two `colsFor`/
// `stateSetter` lines in each `railDrag(...)` call below, the
// `railScrubLive` branch inside `railDrag`, `mapRailNotches`'
// return shape (an object now, read by that branch), and the
// `setDayOffState`/`setHourOffState` split above (`setDayOff`/
// `setHourOff` still do exactly what they always did, just built
// from that split). Reverting means undoing all of those, not only
// this block.
// Known limitation: the day-label row and hour-rail times do not
// themselves animate mid-drag (only the coloured grid does), so
// they can lag a frame or two behind the blend until it settles.
// Off entirely under reduced motion, where there is nothing to
// blend and the shipped instant behaviour already degrades cleanly.
const railScrubLive = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

// Builds the grid for a given day/hour offset without touching the
// live dayOff/hourOff, the same trick viewColsFor/cityColsFor use:
// swap the state just long enough to call buildCols(), then restore
// it. Cached per drag, since a single drag can cross many notches.
const dayColsFor = (offset, cache) => {
    const key = Math.max(minDayOff(), Math.min(maxDayOff(), offset));
    if (cache.has(key)) return cache.get(key);
    const ref = (wave ? wave.to : lastCols) || buildCols();
    const nCols = ref.length, nRows = ref[0] ? ref[0].length : 0;
    const keep = dayOff;
    let built;
    try { dayOff = key; built = fitCols(buildCols(), nCols, nRows); }
    finally { dayOff = keep; }
    cache.set(key, built);
    return built;
};
const hourColsFor = (offset, cache) => {
    const { min, max } = hourPeekRange();
    const key = Math.max(min, Math.min(max, offset));
    if (cache.has(key)) return cache.get(key);
    const ref = (wave ? wave.to : lastCols) || buildCols();
    const nCols = ref.length, nRows = ref[0] ? ref[0].length : 0;
    const keep = hourOff;
    let built;
    try { hourOff = key; built = fitCols(buildCols(), nCols, nRows); }
    finally { hourOff = keep; }
    cache.set(key, built);
    return built;
};

// A scrubWave that also takes the axis; scrubWave itself is
// hardcoded to 'x' for the view switch's own use and is left alone
// rather than risk it. `p` is 0..1 within the CURRENT notch (0
// through mapRailNotches' own dwell, ramping to 1 across the rest),
// so the blend pair only retargets when a full notch is crossed,
// not on every frame.
const scrubReveal = (cols, dir, p, axis) => {
    const grid = $('grid');
    if (wave && wave.scrub && (cols !== wave.to || dir !== wave.dir)) {
        wave.t = 0; wave.to = wave.from; wave.pending = null;
    }
    waveTo(grid, cols, dir, { axis, hold: true });
    if (!wave) return;
    wave.scrub = true;
    wave.rewind = false;
    if (waveRaf) { clearTimeout(waveRaf); waveRaf = 0; }
    wave.t = Math.max(0, Math.min(wave.total, p * wave.total));
    waveFrame();
};

// Mirrors `endViewScrub`: the last notch's blend either completes
// (≥50% of the way across, the same point the committed offset
// already flips at) or rewinds to the notch it started from. Either
// way `afterEnd` (the SAME `opts.end` the shipped path already
// calls) runs once the wave settles, so springHours/armRevealIdle
// fire against a grid that has actually finished moving.
const endRailScrub = (p, afterEnd) => {
    if (!wave || !wave.scrub) { afterEnd(); return; }
    wave.scrub = false;
    if (p >= 0.5) {
        wave.rate = 0;
        wave.onSettle = afterEnd;
    } else {
        wave.rewind = true;
        wave.rate = wave.t / Math.max(REWIND_MIN_MS, wave.t / REWIND_RATE);
        wave.onSettle = afterEnd;
    }
    waveRelease();
};
// ==================================================================

// An open tooltip means the screen is actively being read, so the
// countdown must not run out from under it. `pendingRevealFn` is
// recorded either way; `showTooltip`/`hideTooltip` below pause and
// resume the timer itself around whatever tooltip comes and goes,
// without needing to know which reveal (or whether one) is waiting.
const tooltipOpen = () => $('tooltip').style.opacity === '1';
const armRevealIdle = fn => {
    clearTimeout(revealTimer);
    pendingRevealFn = fn;
    if (tooltipOpen()) return;
    revealTimer = setTimeout(fn, REVEAL_IDLE_MS);
};
const repaint = anim => {
    if (state.data.length) updateDisplay(anim); else renderSkeleton();
};

// --- Hours: a spring-loaded peek ----------------------------------
// Extra hours cost nothing and are not less certain (every hour is
// already in the payload, and 03:00 tomorrow is *more* certain than
// 14:00 on day 7, since confidence tracks lead time, not time of day).
// So the peek is a glance: it tracks the finger, snaps to whole hours,
// and has no latched state at all, which makes principle 2 unbreakable
// by construction rather than by remembering to reset something.
// Just the state half, no repaint: EXPERIMENTAL's rail crossfade
// above needs hourOff (and the go-home bookkeeping) kept current on
// every pointermove without the instant grid rebuild fighting the
// wave it is driving instead. `setHourOff` below is this plus the
// paint, unchanged, for every caller that isn't that crossfade.
const setHourOffState = n => {
    hourHomeGen++;                              // a live drag/step owns it now
    const { min, max } = hourPeekRange();
    const v = Math.max(min, Math.min(max, n));  // past the clamp the pull
    if (v === hourOff) return false;            // simply stops: the window
    hourOff = v;                                // may never leave the day
    return true;
};
const setHourOff = n => {
    if (!setHourOffState(n)) return;
    repaint();  // instant: the hours follow the finger, they don't chase it
};
// Home again. Rather than the grid's full black-to-colour wave (the
// language for the grid becoming a DIFFERENT grid: a new view, a new
// city), this just keeps playing the same direct-manipulation slide the
// peek already tracks under the finger, only now driven by an eased
// clock instead of the touch: the same animation that opened it, in
// reverse. `repaint()` with no `anim` is the instant, no-wave paint a
// drag step already uses, so every tick of the tween looks exactly like
// the finger easing back to rest.
const springHours = () => {
    clearTimeout(revealTimer);
    pendingRevealFn = null;
    if (!hourOff) return;
    const from = hourOff, gen = ++hourHomeGen;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { hourOff = 0; repaint(); return; }
    const t0 = performance.now();
    const tick = now => {
        if (gen !== hourHomeGen) return; // superseded by a new drag/press/reset
        const p = Math.min(1, (now - t0) / REVEAL_HOME_MS);
        hourOff = from - Math.round(from * (1 - Math.pow(1 - p, 3))); // ease-out
        repaint();
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};

// --- Days: a latched drawer ---------------------------------------
// Extra days cost payload and are steeply less certain: they are new
// information you have to read, not a glance, so they latch and stay
// tappable. The frame stays 7 columns wide and slides; it never grows.
//
// A step repaints instantly, with no wave, exactly as the hour peek
// does. The two reveals move the same way for the same reason: a step is
// the window sliding one notch, so each block simply takes the next day's
// value and the movement reads as the frame rolling sideways. The
// black-to-colour wave is the app's language for the grid becoming a
// *different* grid (a new view, a new city), and firing it on every notch
// of a slide said "everything changed" seven columns at a time when only
// one column of content had entered. It also outran the gesture: a wave
// is ~380ms and a drag can cross three days inside that, so the sweep
// spent the whole drag chasing the hand instead of following it.
//
// One rule, both axes: stepping is instant, going home is the same slide
// played back on its own clock instead of the grid's shared wave. See
// `springHours` above for why the wave was dropped for the reveals'
// own return trip.
// Just the state half, no repaint. See `setHourOffState` above for
// why EXPERIMENTAL's rail crossfade needs this split.
const setDayOffState = n => {
    dayHomeGen++;                          // a live drag/step owns it now
    const v = Math.max(minDayOff(), Math.min(maxDayOff(), n));
    if (v === dayOff) return false;
    dayOff = v;
    renderDayHome();
    return true;
};
const setDayOff = n => {
    const changed = setDayOffState(n);
    if (changed) repaint();  // instant: a step follows the finger, it doesn't chase it
    return changed;
};
// Home again, the same eased tween `springHours` plays: no `anim`, so
// every tick is the instant, no-wave repaint a drag step already uses,
// and the drawer just slides itself the rest of the way shut.
//
// The tween is signed and needed no change for negative offsets: `from`
// is negative coming back from last night, and `from - round(from *
// ease)` walks -2 up to 0 the same way it walks 7 down to 0. `!dayOff`
// is still the right "already home" test, since 0 is the only offset
// that is falsy.
const dayHome = () => {
    clearTimeout(revealTimer);
    pendingRevealFn = null;
    if (!dayOff) return;
    const from = dayOff, gen = ++dayHomeGen;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { dayOff = 0; repaint(); renderDayHome(); return; }
    const t0 = performance.now();
    const tick = now => {
        if (gen !== dayHomeGen) return; // superseded by a new drag/step/reset
        const p = Math.min(1, (now - t0) / REVEAL_HOME_MS);
        dayOff = from - Math.round(from * (1 - Math.pow(1 - p, 3))); // ease-out
        repaint();
        renderDayHome();
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};

// --- Rail drag, shared by both axes -------------------------------
// Pointer events rather than touch events, so one path covers finger,
// mouse and stylus; setPointerCapture then routes every move and the
// release back to the rail no matter what the repaint did to the DOM
// underneath, which is the same detached-target trap the rails exist to
// avoid, closed a second way.
const railDrag = (el, opts) => {
    let drag = null;
    el.addEventListener('pointerdown', e => {
        if (!e.isPrimary || !opts.enabled()) return;
        // `cache`/`lastK`/`lastP` are only read by the EXPERIMENTAL
        // branch below; a rail with no `colsFor` (none today) simply
        // never touches them.
        drag = {
            at: opts.axis === 'y' ? e.clientY : e.clientX, base: opts.base(), moved: false,
            cache: new Map(), lastK: 0, lastP: 0
        };
        el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
        if (!drag) return;
        // One unit of travel is one row or one column, so both reveals
        // move with the finger at the scale of the thing they move.
        // Measured per move, since the grid is responsive. An
        // unmeasurable grid (zero height or width) has no scale to drag
        // against, so the move is ignored rather than divided by zero.
        const per = opts.scale() * REVEAL_SENS;
        if (!(per > 0)) return;
        const d = (opts.axis === 'y' ? e.clientY : e.clientX) - drag.at;
        if (!drag.moved) {
            if (Math.abs(d) < REVEAL_SLOP) return;
            drag.moved = true;
        }
        e.preventDefault();
        // The slop is subtracted rather than ignored, so the content does
        // not jump by the threshold at the moment the drag is claimed.
        // mapRailNotches then spends the first half of each notch's travel
        // parked (the linger) before ramping to the next, rather than
        // crossing it at a flat, immediate 1:1 rate.
        const traveled = d - Math.sign(d) * REVEAL_SLOP;
        const { sgn, k, p } = mapRailNotches(traveled, per);
        // EXPERIMENTAL (2026-07-29): continuous crossfade. See the
        // block above `setHourOffState`/`setDayOffState` for what
        // this replaces and how to remove it. The committed offset
        // still flips at the exact point the shipped Math.round
        // always did, so labels/chip/hourPeekRange are unaffected;
        // only how the GRID paints changes below.
        if (railScrubLive() && opts.colsFor) {
            drag.lastP = p;
            opts.stateSetter(drag.base - Math.round(sgn * (k + p)));
            // A fresh notch crossed: promote what the wave was
            // blending TOWARD into its new starting point before
            // aiming at the notch beyond. The natural timed wave
            // would do this itself on completion, but that clock is
            // switched off for a scrub's whole lifetime (see
            // `waveTick`'s early return on `w.scrub`), so nothing
            // else here ever promotes it.
            if (wave && wave.scrub && k !== drag.lastK) { wave.from = wave.to; wave.t = 0; }
            drag.lastK = k;
            const nextCols = opts.colsFor(drag.base - sgn * (k + 1), drag.cache);
            scrubReveal(nextCols, sgn, p, opts.axis);
            return;
        }
        opts.step(drag.base, Math.round(sgn * (k + p)));
    });
    const end = e => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        if (!d.moved) return;
        // EXPERIMENTAL: let the last notch's blend finish or rewind
        // (`endRailScrub`) before `opts.end()`, the shipped
        // springHours/armRevealIdle(dayHome), runs, rather than
        // calling it against a grid still mid-blend.
        if (railScrubLive() && opts.colsFor && wave && wave.scrub) endRailScrub(d.lastP, opts.end);
        else opts.end();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
};

// A wheel over a rail does what a drag on it does. Same origin gate, same
// clamps, same ways home: only the input differs, so a mouse or trackpad
// reaches both reveals without a drag, and hovering the axis you want to
// move is the whole gesture.
//
// Direction is deliberately NOT the drag's. A drag is direct
// manipulation, so the content follows the hand: pull down and earlier
// hours arrive from above. A wheel is scrolling, so the viewport follows
// the wheel: scroll down and you move further down the hour axis, which
// is later. Matching the drag's sign here would make the wheel feel
// backwards, since nothing is being held.
const WHEEL_STEP = 50;   // accumulated px before the wheel is one step
const WHEEL_GAP_MS = 400; // longer than this and it is a new gesture
const railWheel = (el, opts) => {
    let acc = 0, last = 0;
    el.addEventListener('wheel', e => {
        if (!opts.enabled()) return;
        e.preventDefault(); // the rail scrolls the forecast, not the page
        const now = performance.now();
        if (now - last > WHEEL_GAP_MS) acc = 0;
        last = now;
        // A horizontal rail takes a horizontal wheel where the hardware
        // has one, and falls back to the vertical axis, which is all an
        // ordinary mouse has.
        const raw = opts.axis === 'y' ? e.deltaY
            : (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
        acc += raw * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
        if (Math.abs(acc) < WHEEL_STEP) return;
        // At most one step per event, and the remainder is dropped rather
        // than carried: a single mouse notch is one whole hour or one
        // whole day, never a jump through several, and a trackpad's fine
        // stream still accumulates to the same step.
        const dir = Math.sign(acc);
        acc = 0;
        opts.step(dir);
    }, { passive: false });
};

const hourPeekLive = () => { const r = hourPeekRange(); return r.min !== r.max; };
// Live if there is anywhere to go on either end. An entry that predates
// past_days has forward reach and no backward reach, and a payload
// short enough to have no forward reach left can still be dragged back
// into last night, so neither end decides this alone.
const drawerLive = () => maxDayOff() > 0 || minDayOff() < 0;

railDrag($('hourRail'), {
    axis: 'y',
    enabled: hourPeekLive,
    base: () => hourOff,
    scale: () => { const w = visibleWindow(); return chart.clientHeight / (w.end - w.start + 1); },
    // Pull down and earlier hours arrive from above: the window follows
    // the hand rather than opposing it.
    step: (base, rows) => setHourOff(base - rows),
    end: springHours,
    // EXPERIMENTAL (2026-07-29): remove these two lines to fall back
    // to the shipped instant-repaint behaviour above.
    colsFor: hourColsFor,
    stateSetter: setHourOffState
});
// The day axis, named rather than inlined into the railDrag call. It is
// origin-independent: nothing in it knows the drag started on the rail,
// and the clamps inside setDayOff/dayColsFor already carry the reach in
// both directions. If the H body swipe in Maybe Rain Touch Interaction
// Rebase §1 is ever built, it binds this same object to the grid and
// gets the past-day reach for free. What it still has to solve is the
// origin conflict that object cannot express: an H swipe on the grid
// meaning "previous day" while an H swipe on the city bar ~10px below
// means "previous city". That wants the M3 rig, not a config change.
const dayAxis = {
    axis: 'x',
    enabled: drawerLive,
    base: () => dayOff,
    scale: () => $('grid').clientWidth / DAY_SPAN,
    // Drag left and later days arrive from the right, matching the
    // direction the view swipe already reads. Drag right for the past.
    step: (base, cols) => setDayOff(base - cols),
    end: () => armRevealIdle(dayHome),
    // EXPERIMENTAL (2026-07-29): remove these two lines to fall back
    // to the shipped instant-repaint behaviour above.
    colsFor: dayColsFor,
    stateSetter: setDayOffState
};
railDrag($('dayRail'), dayAxis);

railWheel($('hourRail'), {
    axis: 'y',
    enabled: hourPeekLive,
    // A wheel has no release to spring back from, so the peek goes home
    // on the same idle timer the keyboard route uses. It still cannot
    // latch: there is no input that leaves it open.
    step: dir => { setHourOff(hourOff + dir); armRevealIdle(springHours); }
});
railWheel($('dayRail'), {
    axis: 'x',
    enabled: drawerLive,
    step: dir => { setDayOff(dayOff + dir); armRevealIdle(dayHome); }
});

$('dayHome').addEventListener('click', dayHome);

// A tap anywhere off the grid and off the day row sends the drawer home,
// per DR-29. The grid itself is deliberately excluded: revealed days stay
// tappable, and a tap that closed the thing you were reading would make
// the reveal useless for the question it exists to answer.
document.addEventListener('pointerdown', e => {
    if (!dayOff) return;
    if (e.target?.closest?.('.day-row, .chart')) return;
    dayHome();
}, true);

// Leaving the app (tab hidden, screen locked) shouldn't leave a
// stray unpinned tooltip on screen for whenever the user returns;
// a genuine pin (tap or click) is meant to persist through exactly
// that "step away and come back" case, so it's left alone.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    const t = $('tooltip');
    if (t.style.opacity === '1' && tappedBlock == null) hideTooltip();
});

// --- Keyboard route into the same selector (owner call, 2026-07-28,
// closing SPEC.md's DR-32 "The keyboard was left alone") --------------
// A key press has no drag underneath it, so there is nothing to read a
// distance off, but the rail, the pin's detent state and the position
// counter are still the answer to "where am I in the list", and a
// keyboard user is owed them exactly as much as a thumb is. Each press
// is a complete step in itself (unlike a drag, which withholds the
// selector until it clears the first dwell band): it commits
// immediately, same as the plain jump this replaces, and plays the
// rail rolling into place on top rather than gating the commit on the
// animation finishing.
//
// Direction is inverted from the old call site, closing the divergence
// DR-32 left open rather than leaving it split. A drag is direct
// manipulation: the rungs travel WITH the finger, so swipe up reaches
// the NEXT favourite. But a key press has no finger for the rail to
// follow. Rather than fall back to the listbox convention (↑ =
// previous, what `stepCity` shipped with), the rail is made to roll in
// the direction the arrow itself points: increasing `pos` moves every
// rung toward the TOP (`renderCitySel` places rung `i` at
// `mid + (i - pos) * RUNG_GAP`), which is the same motion a one-step
// swipe-up plays. So ↑ is NEXT and ↓ is PREVIOUS: the keyboard now
// matches the gesture instead of opposing it, and "down" from either
// input lands on the same city, closing the second-order wrinkle
// DR-32's writeup flagged alongside the direction itself.
const KEY_TWEEN_MS = 180;      // the rail's own roll into the new rung
const KEY_SEL_LINGER_MS = 900; // how long the counter stays up unread
let keySelTimer = 0;
const keyStepCity = dir => {
    const cur = favorites.length
        ? favorites.findIndex(c => placeKey(c) === placeKey(state.place)) : -1;
    const base = cur < 0 ? (dir > 0 ? -1 : 0) : cur;
    const target = cityClamp(base + dir);
    const place = favorites[target];
    // Honesty guard: with fewer than two favourites, or already at
    // the list's first/last favourite, the target clamps straight back
    // to the city already on screen, so nothing commits and nothing is
    // drawn, the same inertness `stepCity` had.
    if (!place || placeKey(place) === placeKey(state.place)) return;
    clearTimeout(keySelTimer);
    const sel = citySel = {
        base, pos: 0, latch: 0, parked: false, armed: true,
        lastDetent: 0, target, listDir: dir, cache: new Map()
    };
    // Sweep direction opposes the list step, the same rule the drag
    // uses (SPEC.md DR-32, "Direction, and two things the build must
    // not get wrong"): the rung arriving at the pin comes from the
    // side the list is moving toward.
    changeCity(place, false, { type: 'wave', axis: 'y', dir: -dir });
    renderCitySel();
    const t0 = performance.now();
    const tick = now => {
        if (citySel !== sel) return; // superseded by a newer press
        const p = Math.min(1, (now - t0) / KEY_TWEEN_MS);
        sel.pos = dir * (1 - Math.pow(1 - p, 3)); // ease-out: settles rather than snaps
        sel.parked = p >= 1;
        renderCitySel();
        if (p < 1) { requestAnimationFrame(tick); return; }
        navigator.vibrate?.(VIBE_DETENT); // one tick landing in the new detent, same as a drag
        keySelTimer = setTimeout(() => {
            if (citySel === sel) { clearCitySel(); renderLocation(); }
        }, KEY_SEL_LINGER_MS);
    };
    requestAnimationFrame(tick);
};

document.addEventListener('keydown', e => {
    // ⌘/Ctrl+K opens city search from anywhere.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openSearch();
        return;
    }
    // Escape closes search/settings/tooltip, handled before the INPUT
    // guard below so it still fires while the search field has focus.
    if (e.key === 'Escape') {
        // Any open modal is the topmost layer: dismiss it and leave
        // everything else alone. modalClosers covers every modal
        // registered via registerModal, so a future one needs no
        // change here.
        const openModalEl = document.querySelector('.modal-scrim:not(.hidden)');
        if (openModalEl) { modalClosers[openModalEl.id](); return; }
        closeSearch();
        toggleSettings(false);
        hideTooltip();
        if (dayOff) dayHome();
        if (hourOff) springHours();
        return;
    }
    if ((e.target.tagName || '') === 'INPUT') return; // don't hijack typing
    // Shift+arrows are the keyboard route into the two reveals, so a
    // keyboard user reaches the same data the rails reveal (the rails are
    // drags, and a drag has no keyboard equivalent). Shift+←/→ steps the
    // day drawer, Shift+↑/↓ peeks hours. Both are transient here too: the
    // drawer keeps its 4s idle timer and the peek springs home on the same
    // timer, since a key press has no release to spring back from.
    if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const horiz = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        // Same both-ends test the rails use: Shift+← now reaches last
        // night as well as Shift+→ reaching next week.
        if (horiz && !drawerLive()) return;
        const r = hourPeekRange();
        if (!horiz && r.min === r.max) return;
        e.preventDefault();
        if (horiz) { setDayOff(dayOff + (e.key === 'ArrowRight' ? 1 : -1)); armRevealIdle(dayHome); }
        else {
            setHourOff(hourOff + (e.key === 'ArrowDown' ? 1 : -1));
            armRevealIdle(springHours);
        }
        return;
    }
    // ↑/↓ step the location through ★ favorites, through the same
    // rolling selector a vertical swipe draws (see keyStepCity above);
    // ←/→ cycle views (same as a horizontal swipe). ↑ is NEXT and ↓ is
    // PREVIOUS, inverted from plain listbox convention so the rail
    // rolls the way the arrow points, matching swipe-up = next.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!favorites.length) return;
        e.preventDefault();
        keyStepCity(e.key === 'ArrowUp' ? 1 : -1);
        return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (enabledViews().length < 2) return;
        e.preventDefault();
        stepView(e.key === 'ArrowRight' ? 1 : -1);
        return;
    }
});

// --- View toggle: rain ↔ temperature grid -------------------------
$('viewToggle').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
});

let searchTimeout;
$('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => renderSuggestions(e.target.value), 250);
});

// Warm the geocoding TLS handshake before its first use. Injected
// dynamically rather than as a static <head> preconnect because the
// forecast host is hit on every load but geocoding is only used on a
// first-visit guess or when someone searches, so returning visitors,
// the common case, never pay for a connection they won't use. The
// guard adds at most one link per page load, whichever trigger fires
// first; crossOrigin anonymous matches the CORS fetch so the warmed
// connection is actually reused.
let geocodingWarmed = false;
const preconnectGeocoding = () => {
    if (geocodingWarmed) return;
    geocodingWarmed = true;
    const l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = 'https://geocoding-api.open-meteo.com';
    l.crossOrigin = '';
    document.head.appendChild(l);
};
// Search intent: warm on focus, before the first keystroke fires a lookup.
$('searchInput').addEventListener('focus', preconnectGeocoding, { once: true });

// Arrow keys walk the results list; Enter picks the highlighted row,
// or the first city if none is highlighted.
$('searchInput').addEventListener('keydown', e => {
    const rows = [...$('searchResults').querySelectorAll('.search-result')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!rows.length) return;
        e.preventDefault();
        const n = rows.length;
        searchHighlight = e.key === 'ArrowDown'
            ? (searchHighlight < 0 ? 0 : (searchHighlight + 1) % n)
            : (searchHighlight <= 0 ? n - 1 : searchHighlight - 1);
        rows.forEach((r, i) => r.classList.toggle('highlighted', i === searchHighlight));
        rows[searchHighlight].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
        if (!rows.length) return;
        e.preventDefault();
        const target = searchHighlight >= 0
            ? rows[searchHighlight]
            : rows[0];
        target?.click();
    }
});

// Inline GPS button: resolve current position, then close the panel.
$('geoBtn').addEventListener('click', () => { closeSearch(); useMyLocation(); });

$('searchResults').addEventListener('click', e => {
    const star = e.target.closest('.fav');
    if (star) { // ★ toggles favorite; panel stays open, list re-sorts
        const { saved, fav, ...place } = state.suggestions[+star.dataset.i];
        if (toggleFavorite(place)) renderSuggestions($('searchInput').value);
        else flashFavHint(); // cap reached: hint instead of a silent no-op
        return;
    }
    const forget = e.target.closest('.forget');
    if (forget) { // ✕ dismisses from both recents and favorites
        const gone = state.suggestions[+forget.dataset.i];
        savedCities = savedCities.filter(c => placeKey(c) !== placeKey(gone));
        favorites = favorites.filter(c => placeKey(c) !== placeKey(gone));
        saveJSON(LS_CITIES, savedCities);
        saveJSON(LS_FAVORITES, favorites);
        sweepForecasts(); // DR-6: a dismissed place's cache goes with it
        renderSuggestions($('searchInput').value);
        return;
    }
    const row = e.target.closest('.search-result');
    if (row) {
        const { saved, fav, ...place } = state.suggestions[+row.dataset.i];
        // A pick we already have fresh cache for swipes up into view (the
        // same wave as the ↑ arrow); an uncached place keeps skeleton → reveal.
        const entry = loadForecast(place);
        const cached = entry?.payload && !forecastExpired(entry);
        changeCity(place, true, cached ? { type: 'wave', axis: 'y', dir: -1 } : null);
    }
});

// Pointer moves the same highlight the keyboard uses, so hover, the
// arrow-key selection, and the Enter target are always one row.
$('searchResults').addEventListener('mouseover', e => {
    const row = e.target.closest('.search-result');
    if (!row) return;
    const rows = [...$('searchResults').querySelectorAll('.search-result')];
    const i = rows.indexOf(row);
    if (i < 0 || i === searchHighlight) return;
    searchHighlight = i;
    rows.forEach((r, idx) => r.classList.toggle('highlighted', idx === i));
});

document.addEventListener('click', e => {
    // A settings click re-renders the panel, detaching the clicked
    // button before this handler runs; a detached target has no
    // ancestors, which would falsely read as an outside click.
    if (!e.target.isConnected) return;
    if (!e.target.closest('.location-wrapper')) {
        // Tap anywhere outside the header (including the dimmed grid,
        // which passes its taps through) fully closes and resets
        // search. This is the escape: no visible close button needed.
        closeSearch();
        toggleSettings(false);
    }
});

// Auto-refresh every 30 minutes
setInterval(() => {
    if (!document.hidden && !state.loading) fetchWeather();
}, 30 * 60 * 1000);

// The 30-min timer skips while hidden, so a backgrounded tab/PWA can
// sit on a stale run time for hours. Re-check when it becomes visible
// again: fetchWeather no-ops if data is < 10 min old, and fetchModelMeta
// self-guards on the model cadence, so this is cheap and only does real
// work when a new run is actually due.
//
// That freshness no-op is exactly why the current-hour marker needs
// its own direct refresh here too, not just scheduleHourTick above:
// a backgrounded tab can have its timers frozen entirely by the OS,
// so there's no guarantee that timer fired on schedule while
// hidden, and even when it did, "hidden" means nothing painted
// anyway. `refreshNowMarkers` re-derives from already-cached
// `state.data` against the current wall clock, no fetch involved,
// so returning to the page always shows the right hour immediately
// rather than waiting on the next real poll to happen to land.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshNowMarkers();
    if (!state.loading) fetchWeather();
});

// DR-7: connection state flows through the one status line. Going
// offline names the honest resting state and keeps the last forecast on
// screen (never a blank grid). Coming back shows a brief "Back online"
// acknowledgement, then a background refresh (its own "Updating…").
const setOnline = online => {
    if (state.online === online) return;
    state.online = online;
    if (online) {
        setStatus('Back online', 'fresh', { transient: true });
        // Refresh after the acknowledgement is visible, before its timer
        // would clear, so the line reads Back online → Updating… → resting.
        setTimeout(() => { if (!state.loading) fetchWeather(true); }, 1000);
    } else {
        updateStatus(); // resting layer shows the offline notice
    }
};
window.addEventListener('online', () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));

// --- Init: render last known data instantly, then refresh ---------
// Installed PWA (mobile): .standalone locks the viewport to exactly
// one screen, no scroll (see the standalone CSS block).
if (isStandalone()) document.documentElement.classList.add('standalone');

// Android standalone reload quirk: after location.reload() (the update
// CTA), the system bars and the safe-area insets that keep content
// clear of the gesture nav bar settle a beat AFTER first paint. The
// locked-height layout gets measured against the pre-settle insets
// (effectively 0), so the bottom of the grid tucks under the nav bar
// until the app is reopened. Re-assert the .standalone rules whenever
// the viewport changes (and on a couple of frames right after boot) so
// the padding re-reads env(safe-area-inset-*) once the bars have
// settled. No-op off standalone, so desktop/browser are untouched.
const resyncStandalone = () => {
    const html = document.documentElement;
    if (!isStandalone() || !html.classList.contains('standalone')) return;
    html.classList.remove('standalone');
    void html.offsetHeight;            // force reflow before re-adding
    html.classList.add('standalone');  // padding now re-reads env() insets
};
addEventListener('resize', resyncStandalone);
addEventListener('orientationchange', resyncStandalone);
addEventListener('pageshow', resyncStandalone);
// The view underline is measured from real button geometry (DR-30), so
// it has to be re-measured whenever that geometry can change: a rotation,
// a resize, or the webfont landing after first paint.
addEventListener('resize', () => renderViewBar());
addEventListener('orientationchange', () => renderViewBar());
document.fonts?.ready?.then(() => renderViewBar());
if (window.visualViewport) visualViewport.addEventListener('resize', resyncStandalone);
// Backstops: on some devices the bars settle without firing a resize.
requestAnimationFrame(resyncStandalone);
setTimeout(resyncStandalone, 300);

// The install banner is no longer shown here: it's armed on the first
// real data paint (see updateDisplay) so it never precedes the grid.
applyBand();   // --band from the current hours setting
setView(view); // paints the view toggle + matching legend
// Chrome icons from the one MR_ICON map (single source of truth), set
// once at boot: the header gear and geolocation button, the location
// caret, and the two close controls. The favourite star, the search-row
// remove control, the now marker, and the status refresh glyph draw in
// their own render paths.
$('gear').innerHTML = MR_ICON.gear;
$('geoBtn').innerHTML = MR_ICON.locate;
$('locationCaret').innerHTML = MR_ICON.caret;
$('installDismiss').innerHTML = MR_ICON.close;
// Every modal's close button (changelog, hourly-data, and any future
// one registered via registerModal) shares this same glyph.
document.querySelectorAll('.modal-close').forEach(btn => { btn.innerHTML = MR_ICON.close; });
if (matchMedia('(pointer: fine)').matches) $('location').title = `Search (${MOD}K)`;

// Precedence: a shared ?lat/lon link wins, else the last saved place,
// else, for a genuine first visit, a local timezone guess, else the
// built-in default. A shared place is also remembered, so it joins the
// visitor's saved-city shortcuts.
const urlPlace = placeFromURL();
const savedPlace = loadJSON(LS_PLACE);
const hasSaved = savedPlace?.name && savedPlace.latitude != null;
const firstVisit = !urlPlace && !hasSaved;
if (urlPlace) { state.place = urlPlace; saveJSON(LS_PLACE, urlPlace); rememberCity(urlPlace); }
else if (hasSaved) state.place = savedPlace;

const savedMeta = loadJSON(LS_META);
if (savedMeta?.last_run_initialisation_time) setModelRun(savedMeta);
// Prime the local run from cache for the resolved place, so the two-model
// line can paint immediately; fetchLocalMeta revalidates on first fetch.
const savedLocal = loadJSON(LS_META_LOCAL);
const startModel = savedLocal && localModelFor(state.place.latitude, state.place.longitude);
if (startModel && savedLocal[startModel.slug]?.last_run_initialisation_time)
    setLocalRun(savedLocal[startModel.slug], startModel);

// Post-update note. When the running build differs from the one last seen
// on this device, an update has landed, so we owe a one-time pointer at
// what changed. Armed here, before any paint/fetch, so the first clean
// freshness repaint (cache paint or the settled revalidation, whichever
// comes) shows it; updateStatus keeps it up for its window so the fetch
// can't clobber it. Skipped on a first-ever install (seenVersion null).
// In unbuilt dev APP_VERSION is the literal __APP_VERSION__ token, which
// is saved as "seen" and so equals itself on the next load: no note, no
// explicit guard needed (a guard comparing to that token can't be used:
// build.mjs replaceAll's every copy of it, including the guard's own).
const seenVersion = loadJSON(LS_VERSION);
saveJSON(LS_VERSION, APP_VERSION);
if (seenVersion && seenVersion !== APP_VERSION) {
    state.whatsNewPending = true;
}

if (firstVisit) {
    // No shared link and no saved place. Rather than paint the hardcoded
    // default and visibly correct to the guessed city a moment later,
    // hold a "Locating…" header + skeleton grid until the timezone guess
    // resolves, then show that city's weather. The default is only
    // committed to screen if the guess can't resolve.
    preconnectGeocoding();      // warm the geocoding handshake
    renderLocating();           // header: "Locating…", no city name yet
    state.loading = true;
    renderSkeleton();           // dim placeholder grid
    setStatus('Locating…', 'updating');
    guessPlaceFromTimezone().then(guess => {
        // changeCity paints the city, saves it (so next visit skips the
        // guess) and fetches; remember=false keeps a place the user
        // didn't choose out of recents.
        if (guess) { changeCity(guess, false); return; }
        // Guess failed: commit to the default now and fetch it.
        syncURL(state.place);
        renderLocation();
        fetchWeather();
    });
} else {
    syncURL(state.place);
    renderLocation();
    // DR-6: startup is just "paint the cache for state.place, then
    // revalidate", the same path as a city switch. The cached grid blinks
    // in with the reveal so a reload has the same entrance as a first visit
    // (a background refresh then defers behind it and blinks only changes).
    paintCachedForecast({ type: 'reveal' });
    fetchWeather(); // refresh in background (skips network if data < 10 min old)
}
// Arm the local-midnight re-slice and the current-hour keep-alive.
// The cached paint above already set state.utcOffset for a
// returning user; first-visit arms again inside changeCity once the
// guessed city resolves, and every fetch re-arms with the payload's
// timezone.
scheduleDayRollover();
scheduleHourTick();
// DR-6: cache lifecycle sweep, once per startup, off the critical
// path so it never delays the first paint.
setTimeout(sweepForecasts, 4000);

// Service worker. DR-7: when a genuinely newer version is waiting, surface
// the resting "↻ Update app" CTA in the status line (updateStatus reads
// state.swUpdate) instead of a banner or a disruptive auto-reload. Tapping
// it reloads into the new build, which then shows the "New version · see
// ⚙" note (armed by the post-update block above).
//
// "Genuinely newer" is the subtle part. index.html is network-first, so an
// online open always runs the newest HTML; the service worker then finds
// the matching new sw.js and fires updatefound while installing the fresh
// cache. That update is the cache catching up to the build we already run,
// not a reason to reload, so showing the CTA there is wrong (it competed
// with the post-update note and appeared spuriously). The tell is timing:
// a load-time updatefound fires within a few seconds of registration; a
// deploy that lands while we sit open fires minutes later. So we only
// honour updates seen after a short settle window, and re-check sw.js on
// refocus so a resident PWA can actually notice a mid-session deploy.
