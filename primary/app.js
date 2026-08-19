// ---------------------------------------------------------------
// Maybe Rain? A single-file weather app.
// Data: Open-Meteo (keyless, true hourly, 7 days, city-local time).
// ---------------------------------------------------------------

// --- The two reveals ----------------------------------------------
// The grid frame never changes size. The hour peek slides a fixed
// window over more hours; the day axis is elastic and makes room inside
// the same frame. Neither grows the grid: the viewport is already full
// at 7x16, so more rows could only come out of block size, and shrinking
// the resting glance to pay for a temporary look is the trade this
// design refused. An hour block still holds exactly one hour, never a
// blend of two. A day pulled in from past the model's native hourly
// horizon is the one departure, and it is honest about it: those blocks
// are wider in TIME and say so.
// DAY_SPAN, FUTURE_REACH, DAY_TOTAL and FORECAST_DAYS live in config.js:
// the shared core reads the horizon, so it has to be declared before
// shared/ loads.
const HOUR_SPAN = HOUR_END - HOUR_START + 1; // 16 slots

// --- Reduced motion, asked once ----------------------------------
// One query object rather than a fresh `matchMedia(...)` at every gesture.
// The preference is read through `reduceMotion()` so the answer is always
// current, and the `change` event lets a mid-session toggle reach the CSS
// too: `html.reduce-motion` is what the stylesheet keys the rules it cannot
// express in a media query alone (an entrance animation that must not run,
// a transition that has to be zero for one frame while an element moves).
const REDUCE_Q = matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = () => REDUCE_Q.matches;
// The pointer, asked the same way. A coarse pointer gets the docked reading
// card; a fine one keeps the floating tooltip and its hover behaviour. Read
// through `coarse()` so a device that changes primary pointer mid-session
// (a tablet gaining a trackpad) answers with what is true now.
const COARSE_Q = matchMedia('(pointer: coarse)');
const coarse = () => COARSE_Q.matches;
const syncReduceMotion = () =>
    document.documentElement.classList.toggle('reduce-motion', REDUCE_Q.matches);
REDUCE_Q.addEventListener?.('change', syncReduceMotion);
syncReduceMotion();

// --- The current hour's arrival ------------------------------------
// The block plays its own weather once, when the grid it belongs to has
// settled. Arming and firing are separate because the two are rarely the
// same moment: the trigger (new data, a view switch, a motion coming
// home) knows an arrival is due, but only the paint knows when there is
// a finished block to put it on.
let arrivePending = false, lastArrive = 0;
// Opening the app and the first payload landing moments later are two
// triggers and one arrival; so are a view switch and an in-flight
// refresh completing. This is the window in which they count as one.
const ARRIVE_GAP_MS = 800;

const armArrival = () => { arrivePending = true; };

const flushArrival = () => {
    if (!arrivePending) return;
    arrivePending = false;
    if (reduceMotion()) return;
    const now = Date.now();
    if (now - lastArrive < ARRIVE_GAP_MS) return;
    lastArrive = now;
    const el = $('grid').querySelector('.weather-block.current');
    if (!el) return;
    // Removing the class, forcing the reflow and adding it back is the
    // only reliable way to replay a CSS animation.
    el.classList.remove('arrive');
    void el.offsetWidth;
    el.classList.add('arrive');
};
// The hour peek is transient view state, never persisted: the app always
// opens on the default hours (principle 2). The day axis is the elastic
// below; its own state lives with the gesture that owns it.
let hourOff = 0;  // whole hours the hour window has slid; springs back
// Bumped whenever hourOff changes for a reason OTHER than the home
// tween's own tick (a fresh drag, a step, a reset), so a tween already in
// flight notices it has been superseded and stops touching the offset
// instead of fighting whatever set it next.
let hourHomeGen = 0;

// --- How far the elastic may stretch, either way ------------------
// The frame holds DAY_TOTAL columns. Column 0 is PAST_DAYS before today,
// so today sits at PAST_DAYS and the home week is the seven columns from
// there. `dayBase` is column 0's absolute index into state.data /
// state.days, and it goes negative when the payload holds fewer past
// days than the frame has room for; those columns render absent.
const dayBase = () => state.todayIndex - PAST_DAYS;
// Both reaches are capped by the data in hand as well as by the
// configured limits, so a short or stale cached payload can never be
// pulled into columns that do not exist (principle 4). An entry that
// predates past_days has todayIndex 0 and no reach behind it, so the
// past end simply does not move until the first revalidation lands;
// staleHorizon forces that on the next load.
const maxFuture = () =>
    Math.max(0, Math.min(FUTURE_REACH, state.data.length - state.todayIndex - DAY_SPAN));
const maxPast = () => Math.min(PAST_DAYS, state.todayIndex);
// Signed, so one call answers "how far can this pull go" for whichever
// side the pull is on.
const reachOn = side => side > 0 ? maxFuture() : maxPast();
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

// The window rendered: every column the elastic can hold, across the
// current hour window. `off` is column 0's ABSOLUTE index into
// state.data / state.days, which is how every caller already reads it,
// and `days` is the whole frame rather than the seven the screen rests
// on. Columns whose index falls outside the parsed data are absent: they
// hold no blocks, take no width, and the reach caps above already stop
// the pull from asking for them.
const visibleWindow = () => {
    const { start, end } = hourRange();
    return { start, end, days: DAY_TOTAL, off: dayBase() };
};

// The idle timer the day drawer used to go home on is gone with the
// drawer (a peek is held, and a lock is a place you leave on
// purpose). The hour peek still springs back on release and still has to
// wait for an open tooltip, so the timer itself stays, for that one axis.
let revealTimer = null;
// The go-home fn the last `armRevealIdle` call armed, kept even while
// `revealTimer` itself is paused for an open tooltip. See
// `armRevealIdle` and `showTooltip`/`hideTooltip` below.
let pendingRevealFn = null;
// For callers that are about to repaint anyway (a view or city change,
// which own the whole grid). The hour peek always goes home: it is a
// peek, held only while something is holding it, and there is nothing
// holding it across a repaint.
//
// The day elastic is different, and only in its locked state. A lock is
// a deliberate act with a way out on screen, so it is a setting about
// how much of the forecast is being looked at rather than a position in
// this view of this city — and comparing two cities nine days out, or
// the same nine days in rain and then in wind, is the thing it is for.
// It used to be dropped here, which meant the comparison had to be set
// up again after every switch. A stretch that was merely being held by a
// finger, or sprung mid-flight, still goes home: nothing was decided.
//
// Neither is persisted to storage, so the app still always OPENS on the
// home week and the default hours (principle 2).
const resetReveal = () => {
    clearTimeout(revealTimer);
    pendingRevealFn = null;
    hourHomeGen++;
    hourOff = 0;
    carryElastic();
};
const applyBand = () => {
    const w = visibleWindow();
    document.documentElement.style.setProperty('--band', `${100 / (w.end - w.start + 1)}%`);
};

// --- UI state ---------------------------------------------------
// The freshness line under the grid (#status) is the app's one place
// for all app-level state. It has two layers. The *resting* layer
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
// The status line is the app's only state channel, and until now it was
// a purely visual one: a screen reader was told nothing about loading,
// going offline, stale data or a waiting update.
//
// It announces the states, not the resting line. The resting line carries a
// countdown that reticks every minute, and a live region repeating "next
// ~3:40, next ~3:39" is worse than silence. The rule matches the one the
// layout already follows: a warning keeps the line to itself, and those are
// exactly the messages worth speaking.
let lastSpoken = '';
const announce = msg => {
    if (!msg || msg === lastSpoken) return;
    lastSpoken = msg;
    $('statusLive').textContent = msg;
};
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
    // Anything with a class is a state (loading, stale, offline, update
    // ready); anything transient is a reply to something just done. Both
    // get spoken. The plain resting line does not.
    if (cls || opts.transient) announce(label);
    else lastSpoken = '';
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
    // The whole frame is laid down, as the real grid is, and
    // `applyDayWidths` then shows the home week and hides the rest: a
    // skeleton of a different shape would have to be rebuilt the moment
    // real data arrived, and the reveal blink runs in place.
    $('days').innerHTML = Array(days).fill(
        '<div class="day-label"><span class="day-date">–</span>'
        + '<span class="day-wd">–</span></div>').join('');
    renderTimes();
    // Same reason, for the same instant: a city switch with nothing cached
    // must not leave the previous city's readings sitting in the buttons.
    // With no data in hand these fall to dashes, which is the honest state.
    renderViewValues();
    $('sunLines').innerHTML = ''; // no data, no lines
    $('grid').innerHTML = Array(days).fill().map((_, d) =>
        `<div class="day-column">${
            `<div class="weather-block skeleton" style="animation-delay:${(d * 0.12).toFixed(2)}s"></div>`.repeat(rows)
        }</div>`
    ).join('');
    applyDayWidths();
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

// The resting layer: updateStatus computes the line's home state and is
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
// clock: the forecast is "overdue" once the next expected model
// release has come and gone (by more than the grace), i.e. a newer
// forecast should exist, whether or not we can reach it.
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
            // The forecast clause rides in front of the freshness, and only
            // here: every other branch of this function is a warning, and a
            // warning does not share its line with the weather.
            const said = conditionClause();
            setStatus(`${said ? said + ' · ' : ''}Run ${runClockLabel(m.init)} · ${tail}`, '');
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

// --- The view buttons as the readout ------------------------------
// Each of the three view buttons shows the current hour's value for the
// view it switches to: chance of rain, temperature, wind speed. The row
// already existed and the buttons were already 44px wide for the tap
// target, so this costs no layout; what it buys is three readings where
// the app has only ever shown one, and a control that previews what
// tapping it does.
//
// Read off state.data rather than the visible grid window, so the buttons
// still answer "what is it right now?" at night, when the current hour
// sits outside the 06:00–21:00 columns. This is the only place the app
// prints the current temperature now that the header is gone.
//
// Every value is dropped rather than faked when the payload lacks it —
// `pop` in particular is left null by the forecast layer rather than
// guessed, so an unknown chance must not render as 0%.
const viewReading = (h, v) =>
    v === 'temp' ? (h.temp != null ? `${displayTemp(h.temp)}°` : null)
  : v === 'wind' ? (h.wind != null ? `${displayWind(h.wind)}` : null)
  : /* rain */     (h.pop  != null ? `${h.pop}%` : null);

// The hour datum for right now, in whatever city `state` is currently
// describing. Named because the sheet rows ask the same question of a
// DIFFERENT city, through withPlaceState, and both have to mean the same
// thing by "now": the city's own local hour, not the reader's.
const nowHour = () => {
    const ti = state.days.findIndex(d => d.isToday);
    return ti >= 0 ? state.data[ti]?.find(x => x.hour === cityNow().hour) : null;
};

const renderViewValues = () => {
    const h = nowHour();
    document.querySelectorAll('#viewSeg button[data-view]').forEach(b => {
        const el = b.querySelector('.seg-val');
        if (!el) return;
        const t = h ? viewReading(h, b.dataset.view) : null;
        el.textContent = t ?? '—';
        el.classList.toggle('none', t == null);
        // With no reading, the dash is decoration: hide it from the
        // accessibility tree so the button's name falls back to the word
        // it has always had, instead of announcing "em dash rain".
        if (t == null) el.setAttribute('aria-hidden', 'true');
        else el.removeAttribute('aria-hidden');
    });
    // The active value renders larger and a wind speed can reach three
    // digits, so a button's width can change with its content. The
    // underline is measured, not inherited, so it has to be re-measured
    // after the text lands or it keeps the previous value's width.
    renderViewBar();
};
// First-visit holding state, shown while the timezone guess resolves so
// the hardcoded default never flashes before the real nearby city. The
// .locating class hides the caret; the title stays generic (no city).
const renderLocating = () => {
    document.title = 'Maybe Rain?';
    $('location').classList.add('locating');
    $('locationName').textContent = 'Locating…';
};

// --- The conditions summary --------------------------------------
// The header used to say the city and the current temperature. The city
// has moved into the thumb's reach, so what is left here is the reading:
// the current temperature at lead size (unchanged, .location-now), then
// the three things a glance asks next, on one secondary line so they are
// read after the number and not instead of it.
//
// Every part is dropped rather than faked when its data is missing, and
// the "until" clause is derived from the hours actually in hand: it is
// the first hour today whose condition group differs from the current
// one, so it can never claim a change the payload does not contain.
// The forecast in words, as one clause. It used to be its own line in the
// header; the header is gone and this is now the first half of the status
// line, which was already reserved and already ellipsizes. The order is
// load-bearing: forecast first, freshness second, so on a narrow phone it is
// the freshness that falls off the end and never the forecast.
//
// `feels 14°` is not here any more. It duplicated the tooltip, the temp
// button now prints the reading it was qualifying, and it was what made the
// line overflow in the first place.
//
// Returns '' rather than faking anything: no data, no clause, and the status
// line is exactly what it was before.
const conditionClause = () => {
    const ti = state.days.findIndex(d => d.isToday);
    const today = ti >= 0 ? state.data[ti] : null;
    if (!today || !today.length) return '';
    const h = cityNow().hour;
    const now = today.find(x => x.hour === h);
    if (!now) return '';
    const rest = today.filter(x => x.hour > h);
    const turn = rest.find(x => x.condition !== now.condition);
    const until = turn ? ` until ${hourLabel(turn.hour)}` : '';
    return `${now.description.toLowerCase()}${until}`;
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
// The schedule used to be fire-and-forget, one setTimeout per cell
// handing the rest to a CSS background-color transition. That cannot
// express the two things the detented city selector needs, because
// once the timeouts are queued the timeline belongs to CSS and there
// is nothing left to read: a sweep must be RETARGETABLE mid-flight
// (the finger crosses another detent, so cells already flipped repaint
// to the newer city while cells the sweep has not reached carry on
// toward the old one) and it must RUN BACKWARDS (the finger reverses,
// so the sweep rewinds to the city on screen before setting off the
// other way with the stagger flipped).
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
const REWIND_RATE = 1.7;  // a rewind is quicker than a completion
const rankStep = n => Math.min(23, 160 / Math.max(1, n - 1));

const cellDelay = (anim, c, r, nCols, nRows, desc) => {
    if (anim.type === 'refresh') return desc.moved ? Math.random() * 220 : -1;
    if (anim.type === 'reveal') { const s = rankStep(nCols); return c * s + Math.random() * s; }
    if (anim.type === 'wave') {
        const idx = anim.axis === 'y' ? r : c;
        // `nRows` is this COLUMN's own block count, not the grid's: the
        // columns are ragged now (a far day holds three blocks where
        // today holds sixteen), and a vertical sweep has to rank each
        // column across the blocks it actually has or a short column
        // would finish its sweep a third of the way down the screen.
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

// role="button" because that is what a block is: tabbable, and activating
// it opens the hour's detail. Without it a screen reader reads a labelled
// group and gives no sign there is anything to press. An empty cell is
// spacing and is hidden outright rather than announced as a blank.
// A block is as tall as the hours it stands for. One hour is the CSS
// default and writes no inline height at all, so the common case stays
// exactly what it was; a coarse block spans its slots' bands and the gap
// between them. The daily bar is the one that is also outlined, and
// says so with a class rather than more inline style.
//
// Does this cell cover the hour an open tooltip is reading? Coverage, not
// equality: activeBlock.hour is an hour of the day, and which block covers
// it shifts with the cadence and with the phase of the hour window.
// blockSpans slices the VISIBLE window, so one notch of hour peek re-phases
// every span on a coarse day and an equality test would miss.
// blankDesc carries day 0 / hour 0, hence the blank/empty guards.
const coversActive = desc => !!activeBlock && !desc.blank && !desc.empty
    && desc.dayIndex === activeBlock.day
    && activeBlock.hour >= desc.hour
    && activeBlock.hour < desc.hour + (desc.slots || 1);
// applyCellContent rewrites className wholesale on every flip, so a
// selection class set from outside would not survive a repaint. Written
// here, the one place both the rebuild and the flip go through.
const cellClass = desc => 'weather-block'
    + (desc.current ? ' current' : '') + (desc.past ? ' past' : '')
    + (desc.slots > 1 ? ' span' : '') + (desc.daily ? ' daily' : '')
    + (coversActive(desc) ? ' sel' : '');
const cellHeight = desc => !(desc.slots > 1) ? ''
    : `height:calc(var(--band) * ${desc.slots} - var(--block-gap));`;
const buildCell = desc => desc.empty
    ? `<div class="weather-block empty" aria-hidden="true" style="${cellHeight(desc)}"></div>`
    : `<div class="${cellClass(desc)}" style="${cellHeight(desc)}background:rgb(${desc.rgb});color:${desc.textColor}" role="button" tabindex="0" aria-label="${esc(desc.info)}" data-day="${desc.dayIndex}" data-hour="${desc.hour}" data-span="${desc.slots}" data-info="${esc(desc.info)}">${desc.marks}</div>`;

// A cell the sweep has not reached yet, or a destination with no data to
// paint. Black is the page background rather than a value in any
// palette, so it reads as ABSENT and never as a wrong number, which is
// what lets an uncached favourite be swept to honestly (every
// rung is reachable, but only the ones with a cached forecast have
// colours to arrive at; the rest land black and fill in on fetch).
const blankDesc = { blank: true, rgb: [0, 0, 0], textColor: '#fff', marks: '', info: '', current: false, past: false, dayIndex: 0, hour: 0, slots: 1 };
// Blanks now have to take the SHAPE of the grid they stand in for: the
// columns are ragged, so a blank grid is built against a reference one
// column by column rather than from two numbers.
const blankLike = ref => ref.map(col => col.map(d => d.slots > 1
    ? { ...blankDesc, slots: d.slots, daily: !!d.daily } : blankDesc));
// Two grids the painter can flip between cell for cell.
const sameShape = (a, b) => !!a && !!b && a.length === b.length
    && a.every((col, i) => col.length === b[i].length);

// Swap a cell's CONTENT (marks, labels, dataset). Called once per cell
// per sweep, at the moment the playhead flips it from `from` to `to`,
// or again if the sweep is retargeted onto a different destination while
// that cell is already flipped. Never per frame: only the colour moves
// every frame, and it is set directly rather than by a CSS transition,
// because the playhead now owns the timeline.
// The transition suppression this used to do inline (`node.style.transition
// = 'none'`, on every cell, every flip) is now one class on the grid, set
// for the life of a sweep and cleared when it ends. It was never cleared
// before: after any animated paint all 112 blocks carried an inline
// `transition:none` for good, which silently defeated the block's own hover
// fade until the next unanimated rebuild happened to restore it. The hover
// therefore behaved differently depending on how the grid had last been
// painted, which is not a thing a hover should depend on.
const CELL_A11Y = ['role', 'tabindex', 'aria-label', 'data-day', 'data-hour', 'data-span', 'data-info'];
const applyCellContent = (node, desc) => {
    // The height is written on every flip, not only on a rebuild: the
    // painter reuses nodes whenever the block COUNTS match, and a column
    // that was absent when the DOM was laid down would otherwise keep an
    // hour's height for a block that stands for six.
    node.style.height = desc.slots > 1
        ? `calc(var(--band) * ${desc.slots} - var(--block-gap))` : '';
    if (desc.empty) {
        node.className = 'weather-block empty';
        CELL_A11Y.forEach(a => node.removeAttribute(a));
        node.setAttribute('aria-hidden', 'true');
        node.innerHTML = '';
        return;
    }
    node.className = cellClass(desc);
    node.removeAttribute('aria-hidden');
    node.innerHTML = desc.marks;
    node.style.color = desc.textColor;
    if (desc.blank) {
        CELL_A11Y.forEach(a => node.removeAttribute(a));
        return;
    }
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', desc.info);
    node.dataset.day = desc.dayIndex;
    node.dataset.hour = desc.hour;
    node.dataset.span = desc.slots;
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
// from wherever it is, which is "retargets rather than restarts"
// falling out of the model rather than being special-cased.
const FRAME_MS = 16;

// --- One clock ------------------------------------------------------
// Everything that animates in this app schedules through here: the sweep,
// and the two return-home tweens. They used to run on two different
// clocks, a 16ms timer and a rAF chain, both writing the same DOM, which
// is a beat pattern waiting to happen on any display that is not exactly
// 60Hz.
//
// rAF where there is one, because a timer sampling a 350ms wipe every
// 16ms is not aligned to anything the screen does, and on a 120Hz panel
// that shows as a stutter no amount of frame-rate-independent maths can
// remove. `t` is still advanced from real elapsed time, so the interval
// remains only how often the wipe is sampled.
//
// The timer is kept as the fallback, and not only for a host with no rAF:
// rAF stops in a hidden tab, and a sweep frozen half-black until the tab
// comes back is worse than one that finishes unwatched. The original
// reason for the timer was jsdom starving under a self-rescheduling rAF
// chain; the boot test runs with `pretendToBeVisual`, whose rAF is itself
// paced at 16ms, so that hazard is not what it was.
const scheduleFrame = fn =>
    (typeof requestAnimationFrame === 'function' && !document.hidden)
        ? { raf: requestAnimationFrame(fn) }
        : { timer: setTimeout(() => fn(performance.now()), FRAME_MS) };
const cancelFrame = h => {
    if (!h) return;
    if (h.raf) cancelAnimationFrame(h.raf);
    if (h.timer) clearTimeout(h.timer);
};
// The common case is not a sweep that STARTS hidden, it is one that is
// halfway through when the tab goes away, and an already-queued rAF simply
// stops. Hand the sweep over to the timer at that moment so it finishes on
// its own and the tab comes back to a settled grid rather than to a
// half-black one.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !waveRaf || !waveRaf.raf) return;
    cancelFrame(waveRaf);
    waveRaf = { timer: setTimeout(() => waveTick(performance.now()), FRAME_MS) };
});

let wave = null;      // { grid, from, to, delays, shown, dir, anim, t, total, pending }
let waveRaf = null, waveLast = 0;
let lastCols = null;  // the grid as last painted, the `from` of the next sweep

const gridBusy = () => !!wave && wave.anim.type !== 'refresh';
const waveSweeping = w => w.to !== w.from || w.t > 0.001;

// The delay table is indexed `c * stride + r`, where the stride is the
// tallest column rather than every column's height: the columns are
// ragged and a per-column offset table would buy a few hundred
// bytes at the cost of every reader having to know about it.
const strideOf = cols => cols.reduce((m, col) => Math.max(m, col.length), 0);
const buildDelays = (anim, from, to, nCols, stride) => {
    const delays = new Float64Array(nCols * stride);
    let total = 0;
    for (let c = 0; c < nCols; c++) {
        const col = to[c], n = col.length;
        for (let r = 0; r < n; r++) {
            // A refresh only blinks cells whose value actually moved, so
            // it asks the DESTINATION desc whether this cell changed.
            const d = cellDelay(anim, c, r, nCols, n, col[r]);
            delays[c * stride + r] = col[r].empty ? -1 : d;
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
        const n = w.to[c].length;
        for (let r = 0; r < n; r++) {
            const node = colNode.children[r];
            if (!node) continue;
            const i = c * w.stride + r;
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
    // An open tooltip survives a city change and reads out the
    // new city's value for the same grid position. Only worth doing on
    // a frame where a cell actually changed hands, not on every frame
    // of the colour ramp.
    //
    // There is one case where it must NOT happen: a scrub is reversible,
    // so a cell the playhead has flipped is not an answer yet. A city
    // sweep swaps one city's number for another city's number for the
    // same reading, so either is true and the re-read is right; the hour
    // scrub can still be taken back, and a tooltip that had already
    // moved to the peeked hour would be reporting a window nobody
    // committed to.
    if (flipped && !w.scrub) refreshActiveTooltip();
};

// What is on screen RIGHT NOW, cell by cell, which mid-sweep is a mix
// of `from` and `to`, since the whole point of the stagger is that the
// two are visible at once. A sweep can be abandoned at any moment by a
// newer paint, and the next sweep has to start from what the eye can
// actually see: reporting `from` would claim the grid still shows the
// old city when half of it does not, and reporting `to` would claim a
// sweep finished that never did. Either way the next sweep starts from
// a grid that was never on screen, and cells jump.
// `superseded` is the one case that must NOT fire the arrival: paintGrid
// ends the old wave BEFORE it writes the new blocks, so an arrival put on
// now would be wiped by the paint that follows and would spend the
// coalescing window doing it. The pending flag is left armed for the wave
// that supersedes this one to settle and claim.
const endWave = (superseded = false) => {
    const w = wave;
    lastCols = [];
    for (let c = 0; c < w.nCols; c++) {
        const col = [];
        const n = w.to[c].length;
        for (let r = 0; r < n; r++) col.push(w.shown[c * w.stride + r] || w.from[c][r]);
        lastCols.push(col);
    }
    wave = null;
    if (waveRaf) { cancelFrame(waveRaf); waveRaf = null; }
    setSweeping(false);
    // Every animated paint terminates here, so this is the one place that
    // knows the grid has stopped moving and the blocks are final.
    if (!superseded) flushArrival();
};

// The sweep owns the timeline while it runs, so the block's own CSS
// transition has to stay out of the way; the rest of the time it is what
// draws the hover. One class on the container rather than an inline style
// on every cell, so there is exactly one thing to clear and `endWave` is
// the only place that has to remember to.
const setSweeping = on => $('grid').classList.toggle('sweeping', on);

const waveTick = now => {
    waveRaf = null;
    const w = wave;
    if (!w) return;
    // The two modes must never both advance `t`. While a scrubbed drag
    // is live the finger owns the clock outright, so the paced ticker
    // stops dead here rather than running on underneath the hand.
    // `hold` is NOT this: it freezes a PACED sweep where it is and
    // leaves the ticker running.
    if (w.scrub) return;
    const dt = Math.min(64, Math.max(0, now - waveLast));
    waveLast = now;
    // The rewind: the destination is KEPT and the clock runs down,
    // so cells un-flip in reverse stagger order and the transition
    // plays backwards. Distinct from the reversal below, which
    // points `to` at `from` and therefore snaps the content back and
    // only unwinds the darkness, right there, because that sweep is
    // about to set off the other way with the stagger flipped, and
    // wrong here, where the gesture is being taken back rather than
    // redirected. `to` is collapsed onto `from` at the bottom of the
    // run-back so the wave settles the ordinary way.
    if (w.rewind) {
        w.t = Math.max(0, w.t - dt * (w.rate || REWIND_RATE));
        if (w.t <= 0) { w.to = w.from; w.rewind = false; }
    }
    // The paced half: the wave runs at the shipped tempo no
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
        if (w.t >= w.total) { w.from = w.to; w.t = 0; }
    } else if (w.t > 0) {
        // A rewind is quicker than a completion, and `w.rate` is where
        // a release computes one from where the playhead was left
        // rather than taking the bare constant: an abandoned scrub is
        // floored to a visible run-back instead of snapping (see
        // `endRailScrub`). Nothing sets it on the paced path.
        w.t = Math.max(0, w.t - dt * (w.rate || REWIND_RATE));
    }
    // The playhead is at rest, so the stagger can be flipped without a
    // jump and the queued reversal can set off.
    if (w.pending && w.t <= 0.0001) {
        const p = w.pending; w.pending = null;
        w.dir = p.dir; w.to = p.cols;
        const built = buildDelays({ ...w.anim, dir: p.dir }, w.from, w.to, w.nCols, w.stride);
        w.delays = built.delays; w.total = built.total;
    }
    waveFrame();
    if (waveSweeping(w) || w.pending) { waveRaf = scheduleFrame(waveTick); return; }
    if (w.hold) return;   // a drag is still holding the sweep open
    // Only a sweep that ran to its natural end settles. A sweep that is
    // superseded by another paint is abandoned in paintGrid, which
    // drops the callback with it.
    const settled = w.onSettle;
    endWave();
    if (settled) settled();
};

const kickWave = () => {
    // A live scrub owns `t`; there is nothing for a ticker to advance.
    if (waveRaf || (wave && wave.scrub)) return;
    waveLast = performance.now();
    waveRaf = scheduleFrame(waveTick);
};

const paintGrid = (grid, cols, anim) => {
    const now = performance.now();
    const nCols = cols.length, stride = strideOf(cols);
    const animated = !!anim && !reduceMotion();

    // A refresh that lands while a directional wave is still settling waits
    // for it to finish, so the wave never gets clipped mid-sweep. Any newer
    // navigation supersedes the queued refresh below.
    if (animated && anim.type === 'refresh' && gridBusy()) {
        if (pendingRefresh) clearTimeout(pendingRefresh);
        const left = Math.max(0, wave.total - wave.t);
        pendingRefresh = setTimeout(() => { pendingRefresh = null; paintGrid(grid, cols, anim); }, left + 16);
        return;
    }

    if (pendingRefresh) { clearTimeout(pendingRefresh); pendingRefresh = null; }
    gridTimers.forEach(clearTimeout); gridTimers.length = 0;

    // A sweep IN FLIGHT owns the grid, so this paint hands it a
    // destination rather than tearing it down and starting again. That is
    // the whole point of the playhead: a retarget keeps `t` and the
    // delays, so cells the stagger has already reached take the newer
    // grid and the ones it has not carry on toward the older one.
    //
    // It used to supersede instead, and a run of quick city swaps was
    // where that showed. Every switch restarted the wave from whatever
    // half-and-half grid was on screen, so cells that had just lit up
    // blinked back to black, and the commit's own repaint — fired on
    // settle or on a 600ms backstop, whichever came first — could land
    // mid-stagger and hard-cut the sweep after it. Three sweeps deep that
    // is not an animation, it is a flicker.
    //
    // Only while it is SWEEPING: a settled wave is a grid at rest that
    // happens to still be held open, and handing it a destination would
    // replay the whole stagger over cells that are already there.
    if (wave && wave.grid === grid && !wave.scrub && waveSweeping(wave)
        && sameShape(wave.to, cols)) {
        const a = animated && anim.type === 'wave' ? anim : wave.anim;
        waveTo(grid, cols, a.dir || wave.dir, { axis: a.axis || wave.anim.axis, hold: wave.hold });
        return;
    }

    // Anything else supersedes: abandon a sweep that cannot be retargeted
    // so rapid navigation can't leave half-finished cells.
    if (wave) endWave(true);

    // No animation (or reduced motion): rebuild the grid instantly.
    if (!animated) {
        setSweeping(false);
        grid.innerHTML = cols.map(cells =>
            `<div class="day-column">${cells.map(buildCell).join('')}</div>`).join('');
        lastCols = cols;
        invalidateSlide();
        applyDayWidths();
        flushArrival();
        return;
    }
    setSweeping(true);

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
            `<div class="day-column">${cells.map(d =>
                `<div class="${cellClass(d)}" style="${cellHeight(d)}background:#000"></div>`).join('')}</div>`).join('');
        kids = grid.children;
        lastCols = null;
        invalidateSlide();
    }
    // The columns may have just been rebuilt, so whatever widths the
    // elastic had written are gone with them. Put them back before the
    // first frame, or a paint landing mid-pull would flash the home week.
    applyDayWidths();
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
    const from = sameShape(lastCols, cols) ? lastCols : blankLike(cols);
    const { delays, total } = buildDelays(anim, from, cols, nCols, stride);
    wave = {
        grid, from, to: cols, delays, total, t: 0, nCols, stride, anim,
        dir: anim.dir || 1, pending: null, hold: false, onSettle: null,
        // `scrub`: the finger owns `t` and the ticker stands down.
        // `rewind`: run `t` down while KEEPING the destination.
        // `rate`: a rewind speed computed at release, 0 = the constant.
        scrub: false, rewind: false, rate: 0,
        shown: new Array(nCols * stride).fill(null)
    };
    waveFrame();
    kickWave();
};

// Retarget a running sweep, or start one, without restarting the clock.
// This is the entry point the city gesture drives: `cols` is the grid it
// is now heading for and `dir` is the sweep direction, which
// is the sign of the FINGER's travel rather than of the list step.
// A destination on the same side retargets in flight; one on the
// opposite side is queued, so the running sweep rewinds to the grid on
// screen first and only then sets off the other way with the stagger
// flipped. Mirroring the stagger under a running playhead would make
// already-flipped cells un-flip in place, which reads as a glitch.
//
// The axis is a parameter (it used to be hardcoded to 'y', because the
// city gesture was the only caller). The city sweep staggers by row and
// the view switch staggers by column, and nothing fails loudly if
// the wrong one is passed (the sweep simply runs the wrong way across
// the grid), so it is passed explicitly at every call site rather than
// defaulted silently. The queued-reversal rebuild in `waveTick` spreads
// `w.anim`, so keeping `wave.anim` in step below is what carries the
// axis through a reversal.
const waveTo = (grid, cols, dir, opts = {}) => {
    const axis = opts.axis || 'y';
    if (!wave || wave.grid !== grid || !sameShape(wave.to, cols)) {
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
        const built = buildDelays(wave.anim, wave.from, cols, wave.nCols, wave.stride);
        wave.delays = built.delays; wave.total = built.total;
    }
    kickWave();
};

// Let a held sweep finish and settle on its own clock.
const waveRelease = () => { if (wave) { wave.hold = false; kickWave(); } };

// --- Far days at the data's own cadence ---------------------------
// The elastic makes days 7 to 13 reachable, and a day that far out is
// not hourly data: past a model's native cadence the hourly series is
// interpolated between coarser steps, so drawing sixteen separate
// blocks there states a resolution the forecast does not have.
// Revealed far days therefore draw at the granularity the data actually
// carries: fewer, taller blocks as lead time grows, down to a
// single outlined daily bar.
//
// Phase A (this): one fixed table, applied from lead 7 so the home week
// is untouched. Phase B is a response-detected cadence, and every
// boundary lives in this one function so that is a one-function change.
const cadenceForLead = lead =>
    lead <= 6 ? 1 : lead <= 8 ? 3 : lead <= 10 ? 6 : 24;

// The hour window cut into blocks of that many hours. A stub tail (under
// half a block) folds into the block before it rather than drawing a
// sliver; a longer tail is honestly its own, shorter block.
const blockSpans = (cadence, rows) => {
    if (cadence >= rows) return [rows];
    const out = [];
    for (let s = 0; s < rows;) {
        let len = Math.min(cadence, rows - s);
        if (rows - s - len > 0 && rows - s - len < cadence / 2) len = rows - s;
        out.push(len);
        s += len;
    }
    return out;
};

// One block's worth of hours, reduced to a single hour-shaped record so
// the cell body below reads it exactly as it reads a real hour.
//
// Rates stay rates: `mm` is the mean mm/h across the span, so a six-hour
// block of drizzle looks like drizzle rather than like a downpour, and
// the block's colour and streaks stay comparable with an hourly one. The
// TOTAL is carried separately as `mmSpan`, because "how much rain across
// this block" is the question a coarse block is actually asked, and the
// tooltip answers it there.
const meanOf = (list, key) => {
    const vals = list.map(h => h[key]).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const maxOf = (list, key) => {
    const vals = list.map(h => h[key]).filter(v => v != null);
    return vals.length ? Math.max(...vals) : null;
};
// The only field whose worst value is its lowest, which is why it needs its
// own reducer rather than riding on maxOf with the rest.
const minOf = (list, key) => {
    const vals = list.map(h => h[key]).filter(v => v != null);
    return vals.length ? Math.min(...vals) : null;
};
const sumOf = (list, key) => {
    const vals = list.map(h => h[key]).filter(v => v != null);
    return vals.length ? +vals.reduce((a, b) => a + b, 0).toFixed(2) : null;
};
const spanHour = (hours, startHour) => {
    const temp = meanOf(hours, 'temp'), feels = meanOf(hours, 'feels');
    const cloud = meanOf(hours, 'cloud');
    // The span's weather is its worst hour, not its average one: an
    // average would quietly retire a thunderstorm into a cloudy
    // afternoon. WMO codes climb with severity, so the highest code in
    // the span is the one the block reports, and its condition and
    // hazard glyph come from that code.
    const code = maxOf(hours, 'code');
    const windy = hours.reduce((a, b) => (b.wind ?? -1) > (a.wind ?? -1) ? b : a, hours[0]);
    return {
        // The SLOT the block starts on, not the first hour that happens
        // to be present: a gap at the front of a span would otherwise
        // give the block a start it does not have, and everything that
        // rebuilds the span from `data-hour` would read past its range.
        hour: startHour,
        span: hours.length,
        temp: temp == null ? null : Math.round(temp),
        feels: feels == null ? null : Math.round(feels),
        humidity: meanOf(hours, 'humidity'),
        pop: maxOf(hours, 'pop'),
        mm: meanOf(hours, 'mm'),
        mmSpan: sumOf(hours, 'mm'),
        liquid: meanOf(hours, 'liquid'),
        liquidSpan: sumOf(hours, 'liquid'),
        snow: meanOf(hours, 'snow'),
        snowSpan: sumOf(hours, 'snow'),
        code,
        cloud: cloud == null ? null : Math.round(cloud),
        // The span's murk is its worst hour's, for the same reason its
        // weather is: an average would retire a foggy morning into a clear
        // one. It was not carried at all before, so every block past the
        // native hourly horizon drew as if the air were clear and the
        // texture stopped part-way across the grid.
        vis: minOf(hours, 'vis'),
        uv: maxOf(hours, 'uv'),
        wind: maxOf(hours, 'wind'),
        windDir: windy ? windy.windDir : null,
        gust: maxOf(hours, 'gust'),
        ...conditionFor(code, cloud ?? 0)
    };
};

// The whole sixteen-column frame as an array of columns of cell
// descriptors, a pure function of `state` + `view` + the hour window.
// Columns are ragged now: a home-week column holds one block per hour,
// a far column holds fewer and taller ones, and a column whose day is
// outside the parsed payload holds empties. Split out of updateDisplay
// because a city sweep needs the OUTGOING and INCOMING grids at the
// same time, so the painter can hold one on the cells the playhead has
// not reached yet. `colsForPlace` below builds one for a city that is
// not the current one.
// The block's pixel size, for the mark field. Unlike a pattern, a field of
// discrete marks has to know how big the box is before it can decide where
// a mark begins and ends, so the size has to reach the overlay.
//
// It comes from the geometry the elastic already computes rather than from
// measuring a node: a read per cell would be a forced layout inside the
// build, and every block in the grid is the same size anyway. A frame that
// cannot be measured yet answers 0 and the overlay falls back to its
// reference block.
//
// One consequence to name. The columns are rebuilt on a view or city
// change and never inside a gesture, so during a pull the field in the DOM
// is the one laid out for the width the columns had when they were built.
//
// That used to be a real cost and is now only a small one. The overlay
// declares the box it was laid out for, so the browser maps the field onto
// whatever the block has become and the chance edge keeps its true
// fraction at every width; what a squish costs is a flattened lean and a
// squashed flake, not a wrong reading. `settleFields` re-bakes exact
// geometry once the size stops moving.
//
// Before the box was declared the field was simply clipped, and because
// the chance channel is the fill's EXTENT that made a fixed fill cover
// more of a narrower block: at full pull an 80% hour read as certain. Nor
// was "the pull only ever narrows a column" true — a repaint taken while
// the elastic is locked bakes the squished width, and going home then
// stranded the field across 46% of the block.
// The sky levels a glint reads against. Anything cloudier gets the cloud
// pass instead, so a dry hour always has exactly one arrival cue.
const SKY_FX_CLEAR = new Set(['clear', 'mclear']);

const blockPx = rows => {
    const grid = $('grid');
    const gw = grid ? grid.clientWidth : 0, gh = grid ? grid.clientHeight : 0;
    if (!(gw > 0) || !(gh > 0) || !(rows > 0)) return { bw: 0, bh: 0 };
    const { w } = dayGeom(dayN, gw);
    return { bw: w[HOME_COL], bh: gh / rows - BLOCK_GAP_PX };
};
// The size the fields in the DOM were actually laid out for, written by
// `buildCols` and read by `settleFields` below. Null means nothing has
// been built yet, or the last build could not measure the frame.
let builtBlock = null;
// Re-bake the field geometry when the block has genuinely changed size.
//
// The overlay declares the box it was laid out for, so a block that has
// since changed size still READS correctly — the browser maps it, and the
// chance edge lands on its true fraction at any width. What that map
// cannot do is undo a non-uniform stretch: the lean flattens and a flake
// squashes. That is an acceptable price on a gesture in flight and a bad
// one on anything that stays, so whatever persists gets exact geometry
// instead of a stretched copy of stale geometry — a settled elastic, a
// locked stretch, a resized window.
//
// It is a rebuild, which the elastic is otherwise careful never to do:
// the field is what makes a build expensive, which is why a frame of a
// pull is sixteen style writes rather than a repaint. So it is gated on
// the block having actually moved. Springing home from a pull that
// started at home changes nothing and rebuilds nothing, which is the
// common case by a wide margin.
const FIELD_EPS = 0.5;   // px; under this nobody can see the difference
const settleFields = () => {
    if (!state.data.length || !builtBlock) return;
    const w = visibleWindow();
    const { bw, bh } = blockPx(w.end - w.start + 1);
    if (!(bw > 0) || !(bh > 0)) return;
    if (Math.abs(bw - builtBlock.bw) < FIELD_EPS
        && Math.abs(bh - builtBlock.bh) < FIELD_EPS) return;
    repaint(null);
};

const buildCols = () => {
    // No data, no columns. The frame is not drawn empty and then
    // explained: an empty grid IS the honest state, and the status line
    // says why (principle 4).
    if (!state.data.length) return [];
    const { start, end, days, off } = visibleWindow();
    const rows = end - start + 1;
    const currentHour = cityNow().hour;
    const { bw, bh } = blockPx(rows);
    // Remember what the fields are about to be laid out against, so a
    // later settle or resize can tell whether they are still true.
    builtBlock = bw > 0 && bh > 0 ? { bw, bh } : null;

// The rain view is the sky base (skyBaseRGB, which is the radiance
// model here and the classic build's palette) plus the streak
// overlay; temp and wind views draw their own scales.
const rainView = view === 'rain';

// The frost contour needs each cell's four neighbours (hour above /
// below in the same day, same hour in the day either side), on ACTUAL
// air temp. Null when the neighbour is off the shown window or missing
// (an honest gap), which the outline treats as the region's edge.
const lastDay = days - 1;
// A column that draws coarse has no hourly contour to join, so it
// answers null and the region's edge is drawn against it. Reading its
// real hourly temp would join a contour to blocks that are not there.
const actualTemp = (di, hh) => {
    if (di < 0 || di >= days) return null;
    if (cadenceForLead(di - PAST_DAYS) > 1) return null;
    const dd = state.data[off + di];
    const c = dd && dd.find(x => x.hour === hh);
    return c ? c.temp : null;
};

return Array.from({ length: days }, (_, dayIndex) => {
    const dayData = state.data[off + dayIndex];
    const meta = state.days[off + dayIndex];
    // The lead day this column stands on, which is what picks its
    // cadence. Column PAST_DAYS is today, so lead is the column's
    // distance from it.
    const lead = dayIndex - PAST_DAYS;
    const cadence = cadenceForLead(lead);
    const spans = blockSpans(cadence, rows);
    // A column the payload does not reach. It keeps its shape — the
    // painter and the city sweep both compare grids cell by cell — but
    // holds nothing, takes no width, and the reach caps never let the
    // pull ask for it.
    // The span rides along even here: the block's HEIGHT comes from it,
    // and a paint that reuses these nodes once the data arrives would
    // otherwise leave a three-hour block one hour tall.
    if (!dayData || !meta) return spans.map(slots => ({ empty: true, slots }));
    const isToday = meta.isToday;
    // A day behind today. Carried onto every cell so the painter can
    // recede the column. A dimmed past column is the affordance for
    // the axis running backward, so no control has to announce it.
    const isPast = !!meta.past;
    const sun = state.sun[meta.date] || {}; // per-day, for tooltip/aria
    const cells = [];
    let slot = start;
    for (const slots of spans) {
        const hours = [];
        for (let k = 0; k < slots; k++) {
            const found = dayData.find(x => x.hour === slot + k);
            if (found) hours.push(found);
        }
        const hour = slot;
        slot += slots;
        if (!hours.length) { cells.push({ empty: true, slots }); continue; } // honest gap
        // One hour is itself; a span is reduced to one hour-shaped
        // record, so everything below is written once and reads both.
        const h = slots === 1 ? hours[0] : spanHour(hours, hour);
        // A block that stands for several hours cannot be the current
        // one: the marker names an hour, and a three-hour block is not
        // one. Nor can it pulse on a model change, which is recorded
        // per hour and would be claiming the whole span moved.
        const isCurrent = isToday && slots === 1 && hour === currentHour;
        // Temperature view: comfort-band colour on feels-like
        // (raw temp only if apparent is missing). Wind view: wind
        // scale. Rain view: the WMO sky colour (tinted for rain,
        // cloud-spread, night after this hour's local sunset); rain
        // itself rides on top as the streak overlay, below.
        const rgb0 = view === 'temp' ? bandRGB(h.feels != null ? h.feels : h.temp)
            : view === 'wind'
                ? (h.wind != null ? windRGB(h.wind) : [40, 40, 40]) // no data: near-black, no arrow
                : skyBaseRGB(h, nightFactor(hour, sun));
        // A past block recedes in its own COLOUR, not by dimming the layer
        // it is drawn on. Those look the same and are not: dimming scales
        // the block and everything on it toward the page black together,
        // and a ratio between two colours does not survive both being
        // scaled — the marks lost up to a quarter of their contrast
        // against the very base they sit on. Stepping the colour down
        // here instead means the overlay is built against the receded
        // base, so it picks its blue and its opacity for the sky it will
        // actually be seen on and keeps every bit of its contrast. The day
        // labels already recede this way, and say why.
        const rgb = isPast ? pastRGB(rgb0) : rgb0;
        // Hazard icons: every applicable hazard shows, packed
        // into the bottom-right corner in a fixed order so
        // two never swap places: the weather-coded hazard first
        // (storm, fog, freeze, mutually exclusive), then heat, then
        // UV (the two threshold hazards, from the ⚙-menu
        // thresholds). Rarely more than two at once (usually heat +
        // UV, or a storm on a hot day). h.glyph is an MR_ICON key.
        const hot = h.temp >= settings.heatWarn;
        const uvHigh = h.uv != null && h.uv >= settings.uvWarn;
        // The danger glyph: temperature view only, on feels-like
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
            + (rainView && h.mm != null && h.mm >= LN.warn ? MR_ICON.rainwarn : '')
            + (hot ? MR_ICON.heat : '') + (uvHigh ? MR_ICON.uv : '')
            + (dangerCold || dangerHot ? MR_ICON.danger : '');
        // The frost contour (temperature view only), on ACTUAL air
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
        // Hourly blocks only. The contour is a shape traced across
        // neighbouring hours, and a block standing for six of them has
        // no inside edge to trace; the coarse column reads as the
        // region's edge instead, which is what `actualTemp` returning
        // the neighbouring day's real hour already makes it.
        let frost = '';
        if (view === 'temp' && slots === 1 && h.temp != null) {
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
        // it rides the day's 21:00 block, bottom-left, in all views —
        // whichever block covers 21:00 once the blocks are hours wide.
        const covers = hh => hh >= hour && hh < hour + slots;
        const sky = covers(21) ? skyEventFor(meta.date) : null;
        // Chance of rain is a forecast statement, so it is dropped on a
        // past hour: the outcome is known, and Open-Meteo keeps
        // returning the probability that was forecast rather than
        // retiring it, which reads as a live prediction about something
        // that already happened. The measured amount stays, and is the
        // only rain figure a past hour reports.
        const popText = (!isPast && h.pop != null) ? ` · ${h.pop}% rain` : '';
        // Rain view: the exact amount lives in the tooltip, never
        // printed in the cell, so the grid stays glanceable. A block
        // that stands for several hours reports the total across them,
        // because that is the question a coarse block is asked.
        const mmVal = slots === 1 ? h.mm : h.mmSpan;
        const mmText = rainView && mmVal != null && mmVal >= 0.1
            ? ` · ${+mmVal.toFixed(1)} mm${slots === 1 ? '/h' : ''}` : '';
        const snowVal = slots === 1 ? h.snow : h.snowSpan;
        const snowText = rainView && snowVal != null && snowVal > 0
            ? ` · ${+snowVal.toFixed(1)} cm${slots === 1 ? '/h' : ''} snow` : '';
        const windText = h.wind != null
            ? ` · ${displayWind(h.wind)} ${windUnitLabel()}${h.windDir != null ? ' ' + COMPASS[windOctant(h.windDir)] : ''}`
            : '';
        const hazText = (hot ? ' · extreme heat' : '')
            + (uvHigh ? ` · very high UV (${Math.round(h.uv)})` : '')
            + (dangerCold ? ' · dangerous cold' : '') + (dangerHot ? ' · dangerous heat' : '');
        const sunText = (sun.rise && covers(sun.rise.h) ? ` · sunrise ${timeLabel(sun.rise.h, sun.rise.m)}` : '')
            + (sun.set && covers(sun.set.h) ? ` · sunset ${timeLabel(sun.set.h, sun.set.m)}` : '');
        const skyText = sky ? ` · ${sky.label}` : '';
        // A cell whose forecast meaningfully moved since the
        // previous model run. The pulse is view-gated (a temp move
        // pulses in temp view, not rain view) and armed only while
        // pulsePending, so it fires once per new model run; the
        // was/now detail stays in the tooltip either way.
        // A cell whose forecast meaningfully moved since the
        // previous model run drives the one-shot blink on a refresh
        // (view-gated: a temp move only blinks in temp view). The
        // was/now detail rides the tooltip either way.
        let ch = slots === 1 ? state.changed?.[`${meta.date}|${h.hour}`] : null;
        // A past hour does not report its probability (see popText), so
        // a change to it must not pulse the cell or print a was/now line
        // for a number that is not on screen. Dropped from a copy, since
        // state.changed is shared with every other column.
        if (isPast && ch?.pop) { ch = { ...ch }; delete ch.pop; }
        const movedInView = ch && (view === 'temp' ? ch.temp : view === 'wind' ? ch.wind : ch.pop);
        const chText = changeLines(ch).map(l => ` · ${l}`).join('');
        // Name the comfort band in the temperature view so the
        // colour is spoken, not just seen.
        const feelsVal = h.feels != null ? h.feels : h.temp;
        const comfortText = view === 'temp' && feelsVal != null
            ? ` · ${TEMP_BANDS[bandIndex(feelsVal)].name.toLowerCase()}` : '';
        // What a block is FOR, said before what it says: an hourly
        // block names its hour, a coarse one names the hours it covers,
        // how wide it is, and that the data behind it is no longer
        // hourly. A reading with no span on it would be read as an
        // hour's reading, which past lead 7 it is not.
        // End-exclusive, the same way the tooltip's header states it: a
        // three-hour block from 18:00 covers up to 21:00, not through it.
        const spanLabel = slots === 1 ? hourLabel(h.hour)
            : slots >= rows ? 'all day'
                : `${hourLabel(hour)}–${hourLabel((hour + slots) % 24)}`;
        const cadText = slots === 1 ? ''
            : slots >= rows ? ' · daily value' : ` · ${slots}-hour block`;
        const provText = slots === 1 ? '' : ' · beyond native hourly';
        const info = `${meta.date ? dateLabel(meta.date) + ', ' : ''}${spanLabel} - ${h.description}, ${displayTemp(h.temp)}°${settings.unit}${comfortText}${popText}${mmText}${snowText}${windText}${hazText}${sunText}${skyText}${cadText}${provText}${chText}`;
        // Marks: the precipitation overlay first (under the glyphs) +
        // the frost contour (temp view) + centred wind arrow (wind view)
        // + bottom-right hazard glyph + bottom-left sky glyph. Any may
        // be empty.
        //
        // Which renderer `precipOverlay` is depends on which file this
        // variant names in its index.html, so this call site does not
        // know and does not need to. A coarse block stands for `slots`
        // hour bands and is that much taller, gaps included.
        //
        // The current hour asks for the layered field, which is the only
        // block whose overlay the arrival animation can drive.
        const precip = rainView
            ? precipOverlay(h, rgb, bw, bh > 0
                ? bh * slots + BLOCK_GAP_PX * (slots - 1) : 0,
                isCurrent ? { layered: true } : null)
            : '';
        // The arrival cue for an hour the precipitation field cannot
        // speak for. `precip` being empty IS the test for "this hour
        // draws no precipitation" — the amount, the chance floor and the
        // condition group are all weighed inside the renderer, and a
        // second reading of them here would drift away from it.
        const skyFX = () => {
            if (!isCurrent) return '';
            if (!rainView) return '<span class="sky-fx fx-neutral"><i></i><i class="b"></i></span>';
            if (STORM_CODES.has(h.code)) return '<span class="sky-fx fx-strike"></span>';
            if (precip) return '';
            return SKY_FX_CLEAR.has(skyLevelFor(h.code, h.cloud))
                ? '<span class="sky-fx fx-glint"><i></i></span>'
                : '<span class="sky-fx fx-cloud"><i></i><i class="b"></i></span>';
        };
        const marks = precip
            + skyFX()
            + frost
            + arrow
            + (hazGlyph ? `<span class="block-mark">${hazGlyph}</span>` : '')
            + (sky ? `<span class="block-mark sky">${mrIcon(sky.glyph)}</span>` : '');
        // dataset.day is absolute (an index into state.days), not the
        // column position, so a tooltip opened on a revealed day still
        // reads the right day back out. `slots` rides with it so the
        // tooltip can rebuild the same span the block stands for.
        cells.push({
            rgb, textColor: textOn(rgb), marks, info,
            current: isCurrent, past: isPast,
            dayIndex: off + dayIndex, hour: h.hour, slots,
            daily: slots >= rows, moved: !!movedInView
        });
    }
    return cells;
});
};

// The grid for a city that is NOT the current one, built without
// disturbing the app's state: the city selector has to sweep toward a
// destination long before it has committed to going there, and may
// never commit at all. Only the cached forecast is used; no fetch is
// triggered by a drag passing over a rung.
//
// A favourite with no usable cache (never opened, or expired) has no
// colours to arrive at. It returns null, and the caller sweeps to black
// instead: black is the page background rather than a value in any
// palette, so it reads as ABSENT and never as a wrong number. The real
// data arrives on landing, through the ordinary changeCity fetch.
//
// Everything that reads another city does it through here: swap `state`
// onto that city's cached payload, run `fn` against the ordinary render
// path, put `state` back. One delicate swap with one list of fields to
// restore, rather than one per caller — the failure mode of a second copy
// is a field nobody remembered to keep, and it surfaces as the live grid
// quietly indexing its week through another city's anchor.
const withPlaceState = (place, fn) => {
    if (!place) return null;
    if (placeKey(place) === placeKey(state.place)) return fn();
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
        return fn();
    } catch {
        return null;
    } finally {
        Object.assign(state, keep);
    }
};
const colsForPlace = place => withPlaceState(place, buildCols);

// The sweep needs both grids to be the same shape, and a city whose
// cached payload sits a day either side of this one's puts its coarse
// columns in different places. Fit to the reference grid column by
// column rather than reject: a column that does not match sweeps to
// black, which is the same honest "no data here" the cold-city case
// above uses.
const fitCols = (cols, ref) => ref.map((refCol, c) => {
    const col = cols && cols[c];
    return col && col.length === refCol.length
        ? col : refCol.map(d => d.slots > 1
            ? { ...blankDesc, slots: d.slots, daily: !!d.daily } : blankDesc);
});
// The grid the fitting is measured against: whatever is on screen, or
// what the app would draw if nothing is yet.
const refCols = () => (wave ? wave.to : lastCols) || buildCols();

// --- The elastic, as geometry --------------------------------------
// One signed number says where the day axis is. `dayN` is how many days
// have been pulled in, continuous and signed: positive reaches forward,
// negative reaches back, zero is the home week. `dayOv` is how far the
// pull has gone PAST the end it is heading for, in raw pixels, signed
// the same way. Between them they describe all three states, and there
// is no fourth.
//
// Nothing here rebuilds the grid. Every column already exists; what
// moves is their widths, so a frame of the pull costs sixteen style
// writes rather than a repaint of the whole field. That is the only
// reason this can track a finger at all: the rain patterns make
// the BUILD expensive, so the build happens on a view or city change
// and never inside a gesture.
let dayN = 0;
let dayOv = 0;
let dayMode = 'home';   // home | stretch | locked
const HOME_COL = PAST_DAYS;   // today's column, and the home week's first

// The gap between columns is a CSS variable and the layout is
// responsive, so it is measured rather than assumed — but once, not on
// every frame of a pull: reading a computed style inside the gesture is
// a forced style recalculation sixty times a second for a number that
// only changes when the stylesheet does.
let GAP_PX = 2;
// The vertical gap between blocks in a column, read the same way and for
// the same reason: the mark field needs the block's height, and a block
// is its hour band less this.
let BLOCK_GAP_PX = 6;
const measureGap = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = parseFloat(cs.getPropertyValue('--gap'));
    if (v > 0) GAP_PX = v;
    const b = parseFloat(cs.getPropertyValue('--block-gap'));
    if (b >= 0) BLOCK_GAP_PX = b;
};

// Past the end the columns freeze and the whole grid slides toward the
// pull instead, damped onto an asymptote: the finger keeps moving, the
// grid keeps answering, and it never runs away.
const SLIDE_MAX = 64;
const slideOf = px => SLIDE_MAX * (1 - Math.exp(-px / SLIDE_MAX));

// Every visible column shares one width — (frame − gaps) / (7 + n) —
// and the entering outermost column carries the fraction, which is what
// makes the reveal continuous instead of a series of steps. The home
// week squishes to pay for whatever is coming in, and today never
// leaves the screen because it is inside the home week.
//
// THE GAPS CARRY THE ENTERING COLUMN TOO, and that is not a detail. The
// gap budget is (DAY_SPAN − 1 + whole + gapOpen) rather than a ceil of
// it, so the entering column's own gap is paid for as it opens.
//
// It used to be a whole gap from the instant a sliver existed, and the
// asymmetry that hid is this: on the FUTURE side the entering column is
// appended on the right, so a gap popping into being there moves the
// right-hand edge, which sits under the overhang and is not watched. On
// the PAST side it is prepended on the LEFT, so the same pop shoves
// every column — today included — sideways by a whole 6px. The way home
// therefore decelerated smoothly to a near-stop and then jumped 6.5px at
// the very end, which is exactly what a bounce looks like. It was never
// the easing; the past side had a step in its geometry that the future
// side put somewhere nobody could see.
//
// The gap still starts at zero for that reason, but it does NOT open at
// `frac`. GAP × frac is under a pixel for the whole first tenth of a
// column, so a new day arrived touching the one beside it and read as
// that column widening rather than as a day appearing. It opens on its
// own ramp instead: zero at the instant the sliver exists, full by
// GAP_OPEN of a column, which on a 90px column is about 11px of travel.
//
// `n` is clamped to the reach here as well as at the source: past the
// end the columns FREEZE, and the opposite end must not go on squishing
// to pay for a pull that is revealing nothing.
//
// Returns widths and left-margins together, because after the above they
// are one calculation and splitting them is how they drifted apart.
const GAP_OPEN = 0.12;
const gapOpen = frac => Math.min(1, frac / GAP_OPEN);
const dayGeom = (n, W) => {
    const w = new Array(DAY_TOTAL).fill(0);
    const m = new Array(DAY_TOTAL).fill(0);
    const side = Math.sign(n) || 1;
    const a = Math.min(Math.abs(n), reachOn(side));
    const whole = Math.floor(a), frac = a - whole;
    const gf = frac > 0 ? gapOpen(frac) : 0;
    const cw = (W - (DAY_SPAN - 1 + whole + gf) * GAP_PX) / (DAY_SPAN + a);
    for (let k = 0; k < DAY_SPAN; k++) w[HOME_COL + k] = cw;
    for (let k = 0; k < whole; k++) {
        const i = side > 0 ? HOME_COL + DAY_SPAN + k : HOME_COL - 1 - k;
        if (i >= 0 && i < DAY_TOTAL) w[i] = cw;
    }
    let fracCol = -1;
    if (frac > 0) {
        const i = side > 0 ? HOME_COL + DAY_SPAN + whole : HOME_COL - 1 - whole;
        if (i >= 0 && i < DAY_TOTAL) { w[i] = cw * frac; fracCol = i; }
    }
    for (let i = 0; i < DAY_TOTAL; i++) if (w[i] > 0) m[i] = GAP_PX;
    // Which gap opens with the entering column is which side it enters
    // from: on the right it is the column's own leading gap, on the left
    // it is the gap between it and the column it is arriving beside.
    if (fracCol >= 0) {
        const g = side > 0 ? fracCol : fracCol + 1;
        if (g < DAY_TOTAL) m[g] = GAP_PX * gf;
    }
    return { w, m };
};
// A column narrower than this is not drawn. It has to be small enough to
// be nothing: at half a pixel it was a visible cliff on the past side,
// because dropping the column dropped its gap with it.
const VIS_PX = 0.02;

// The label row mirrors the columns exactly, so the dates stay over the
// days they name at every width. A label says both its lines or neither:
// the widths where a two-digit date fits are the widths where a
// weekday fits too, since the abbreviations are one or two letters (M,
// TH) and never wider than the number above them. There was a middle
// bucket that dropped the weekday first, and it was answering a width
// problem the row does not have — a pull lost the weekdays a good deal
// before it lost the room for them.
//
// So: both lines while a number can be read, nothing under that. Stepped
// rather than continuous, so a pull rewrites a label once instead of on
// every frame. Both lines stay in the DOM and stay laid out either way;
// the bucket only toggles a class and the fade is the stylesheet's, so
// the row keeps its height and the grid does not move.
const labelTiny = px => px < 16;
// The slide is written only when it changes, so a rebuild of the columns
// has to say that the fresh nodes carry nothing yet. `null` is a value
// no transform string can equal, which is the whole point of it.
let slideTf = null;
const invalidateSlide = () => { slideTf = null; };
const applyDayWidths = () => {
    const grid = $('grid'), row = $('days');
    const cols = grid.children, labels = row.children;
    if (!cols.length) return;
    // A paint can land before the frame is measurable (first paint, a
    // hidden tab). The widths are still worked out, against a nominal
    // frame, and written as flex-grow RATIOS rather than pixels: the
    // proportions are what the elastic is saying, and a ratio says them
    // correctly at whatever width the box turns out to be.
    const W = grid.clientWidth;
    const measurable = W > 0;
    const { w, m } = dayGeom(dayN, measurable ? W : 700);
    let first = -1;
    for (let i = 0; i < DAY_TOTAL; i++) if (w[i] > VIS_PX) { first = i; break; }
    const tx = dayOv ? -Math.sign(dayOv) * slideOf(Math.abs(dayOv)) : 0;
    const tf = tx ? `translate3d(${tx.toFixed(1)}px,0,0)` : '';
    // The slide has to move the columns INSIDE the frame, not the frame
    // itself: a transform on the clipping box would carry the clip with
    // it and nothing would ever clip into black.
    const moveTf = tf !== slideTf;
    for (let i = 0; i < DAY_TOTAL; i++) {
        const width = w[i], vis = width > VIS_PX;
        const col = cols[i], lab = labels[i];
        for (const el of [col, lab]) {
            if (!el) continue;
            el.style.display = vis ? '' : 'none';
            if (measurable) { el.style.flex = '0 0 auto'; el.style.width = vis ? width.toFixed(2) + 'px' : '0px'; }
            else { el.style.flex = vis ? `${width.toFixed(3)} 0 0` : '0 0 0'; el.style.width = ''; }
            el.style.marginLeft = vis && i > first ? m[i].toFixed(2) + 'px' : '0px';
            if (moveTf) el.style.transform = tf;
        }
        if (!lab || lab.classList.contains('absent')) continue;
        const tiny = labelTiny(width) ? 1 : 0;
        // A seam divides a column from the one before it, so the leading
        // visible column cannot carry one: the only thing to its left is
        // the gutter. `first` is already worked out above for the margins,
        // which is the same question asked once.
        const lead = i === first ? 1 : 0;
        if (+lab.dataset.b === tiny && +lab.dataset.lead === lead) continue;
        lab.dataset.b = tiny;
        lab.dataset.lead = lead;
        lab.classList.toggle('tiny', !!tiny);
        lab.classList.toggle('seam-lead', !!lead);
    }
    if (moveTf) {
        slideTf = tf;
        // Clipping costs nothing at rest and is only ever needed while
        // the grid is sliding, so it is switched on for exactly that.
        // At home the current-hour marker deliberately overhangs the
        // field's left edge, and a clip that was always on would eat it.
        grid.classList.toggle('sliding', !!tf);
        row.classList.toggle('sliding', !!tf);
    }
    $('dayHome').hidden = dayMode !== 'locked';
    $('dayHome').textContent = dayMode === 'locked' ? '⌂' : '';
    paintLockMark();
    // The elastic can pull the day a reading points at right off the
    // screen, on any frame of a pull. Only the class is touched here, not
    // the content: the numbers on the card are still true, so a rebuild per
    // frame would be paying to write the same words.
    if (cardOpen()) $('readingCard').classList.toggle('orphan',
        !blockCovering(activeBlock.day, activeBlock.hour));
};

// The row that labels the window. Split out of updateDisplay because a
// pull moves the widths on every frame while the grid itself is painted
// by the wave, and a strip that says a date the grid is no longer
// showing is worse than no strip at all.
//
// The per-day min/max row that used to sit under this is gone. Every
// temperature it carried is already in the grid it labelled, and the
// tooltip gives the exact figure for any hour, so it was a summary of
// the thing directly beneath it.
// Monday opens the week, the local convention and the one every planner
// the strip is read against uses. `dowOf` counts from Sunday.
const WEEK_START_DOW = 1;
// Which boundary, if any, a column opens. Two seams, and never both on
// one label: a week that starts on today puts the two boundaries on the
// same edge, and the week seam is the coarser division, so it is the one
// that survives. Deciding it here rather than letting the stylesheet's
// source order settle it keeps the rule where the dates are known.
const seamClass = day =>
    dowOf(day.date) === WEEK_START_DOW ? ' seam-week'
        : day.isToday ? ' seam-past' : '';

const renderDayStrip = () => {
    const { days, off } = visibleWindow();
    // Once per repaint, never inside a pull: a computed-style read is a
    // forced layout, and the gesture path must not pay for one.
    measureGap();
    if (!state.data.length) { $('days').innerHTML = ''; return; }

    // The real date over its weekday. The elastic can bring any day on
    // screen, so a weekday letter alone would stop being an answer to
    // "which day is this" — and the date is the line that survives every
    // width, so it is the line on top. Today stays gold, the marker it
    // already had; it is not restated as a dot as well.
    //
    // The past class rides the same row as the blocks, so a receded column
    // reads as one whole column sitting behind today. It used to go on the
    // min/max row as well; that row is gone, and its share of the recession
    // went with it.
    //
    // One label per column, all sixteen, built once and then only ever
    // resized: the labels ARE the columns' widths, and rewriting the row
    // on every frame of a pull is the jitter the elastic exists to
    // avoid. Both lines are written now and stay written; what changes as
    // a column narrows is which of them is visible, and `applyDayWidths`
    // toggles that by width bucket so the stylesheet can fade it.
    $('days').innerHTML = Array.from({ length: days }, (_, i) => {
        const day = state.days[off + i];
        if (!day) return '<div class="day-label absent" aria-hidden="true"></div>';
        return `<div class="day-label${day.isToday ? ' today' : ''}${day.past ? ' past' : ''}${seamClass(day)}">`
            + `<span class="day-date">${+day.date.slice(8, 10)}</span>`
            + `<span class="day-wd">${esc(day.text)}</span></div>`;
    }).join('');
    applyDayWidths();
};

// Everything outside the grid whose position depends on the hour
// window: the day strip, the hour axis, and the sun hairlines. Split
// out of `updateDisplay` because an hour slide changes exactly these and
// nothing else, so the home tween can keep them in step with the blend
// underneath without paying for a whole repaint per notch.
const sunForToday = () => {
    const meta = state.days[state.todayIndex] || state.days[0];
    return (meta && state.sun[meta.date]) || {};
};
const renderOffsetChrome = (sun = sunForToday()) => {
    const { start, end } = visibleWindow();
    const rows = end - start + 1;
    renderDayStrip();
    renderTimes();
    // Sun hairlines: one straight line across the whole grid at today's
    // sunrise/sunset minute (⚙ Sun → hide turns them off). Neighbouring
    // days drift only minutes; each day's exact times are in its blocks'
    // tooltips.
    $('sunLines').innerHTML = !settings.sunLines ? '' : ['rise', 'set'].map(k => {
        const t = sun[k];
        if (!t) return '';
        const f = t.h + t.m / 60;
        if (f < start || f > end + 1) return ''; // outside the hour window
        return `<div class="sun-line" style="top:${((f - start) / rows * 100).toFixed(2)}%"></div>`;
    }).join('');
    // The hour peek's own carets. The day arrows went with the paging:
    // the elastic shows its extent itself, in the widths.
    showReachMarks(legendHeld);
};

const updateDisplay = (anim = null) => {
    // A lock carried in from another city or another view is measured
    // against THIS payload before anything is drawn against it, so the
    // strip and the grid are laid out from the same reach.
    reconcileElastic();
    // Measured once and handed down: both the sun lines and the night
    // swap want the same answer, and working it out asks for the visible
    // window and a slice of the week each time.
    const sun = sunForToday();
    renderOffsetChrome(sun);

    const currentHour = cityNow().hour;
    // Hybrid chrome: once the current local hour is past sunset, the
    // background eases to night (blocks already colour per their own
    // hour). Purely ambient: a single --bg swap, accent stays gold.
    document.body.classList.toggle('night', nightFactor(currentHour, sun) >= 0.5);

    // Read BEFORE the paint, not after it with pulsePending: the paint is
    // what fires the arrival, and an unanimated one fires it inline.
    if (state.arrivePending) { state.arrivePending = false; armArrival(); }

    const cols = buildCols();
    paintGrid($('grid'), cols, anim);
    // Keep an open block tooltip in sync with the repaint (city swap,
    // view switch, background refresh) even when the mouse hasn't moved.
    refreshActiveTooltip();

    // The first render after a rotation consumes the pulse, so
    // settings and view re-renders rebuild without .changed and the
    // animation can never re-fire on identical DOM.
    state.pulsePending = false;

    renderViewValues();
    renderSwipeHint();
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
        // The strip is the eight comfort bands, not a °C ramp;
        // each swatch is its band colour, the block tooltip carries the
        // prep cue on tap.
        return TEMP_BANDS.map(b => ({ bg: `rgb(${b.rgb})`, label: b.name }));
    }
    // Rain view: the strip is the sky ramp (lighter = sunnier, darker
    // = cloudier, storm darkest) plus a blue-hatched "rain" swatch
    // (teaching "blue = rain") and a white-dot "snow" swatch.
    // Block tooltips still name every condition on tap.
    //
    // Built in shared/colors.js, not here, so the key is sampled from
    // whichever sky model is painting the grid. Swapping SKY_MODEL
    // swaps the legend with it; the two cannot drift apart.
    return skyLegend();
};
// Whether the key is currently the caption slot's occupant. It is not a
// resting element any more: it appears while a finger (or a pointer) is on
// the grid, which is exactly when "what does this colour mean" is the
// question being asked, and it gives the slot back on release.
//
// Two things it must never do. It must not move anything: the slot has a
// fixed height, so the swap is a swap and not a reflow. And it must not
// cover a transient status, since offline, stale and error messages all
// pass through that line and a finger on the grid would otherwise hide the
// fact that the data is wrong.
// The one glyph the icon set does not already have. Drawn to MR_ICON's own
// construction (24 box, 2px stroke, round caps) so it sits with the rest.
const SHEET_ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M16.2 16.2 21 21"/></svg>',
    gear: MR_ICON.gear
};
let legendHeld = false;
const legendLive = () => settings.legend && legendHeld && !statusTimer;
// One line, three occupants, in priority order: the key while the grid is
// being touched, the swipe hint on a first run, the status line otherwise.
// They never coexist, so they never needed three homes.
//
// The `hidden` ATTRIBUTE, not the shared `hidden` class: the elements carry
// the attribute in the markup so they cannot flash before the first render,
// and an attribute a class toggle never clears would outrank the class
// forever.
// They are stacked rather than swapped once the first render has run: all
// three sit in the same grid cell and only opacity distinguishes them, so
// the key arriving under a finger is a 120ms dissolve instead of a hard cut
// on a line the eye is already resting on. The `hidden` attribute is still
// what keeps them off the screen BEFORE that first render; `capReady` is
// the one-way door between the two regimes.
let hintLive = false;
let capReady = false;
const syncCaption = () => {
    const key = legendLive();
    const hint = !key && hintLive;
    if (!capReady) {
        capReady = true;
        $('legend').hidden = false;
        $('swipeHint').hidden = false;
        $('captionText').hidden = false;
        $('botcap').classList.add('stacked');
    }
    $('legend').classList.toggle('cap-off', !key);
    $('swipeHint').classList.toggle('cap-off', !hint);
    $('captionText').classList.toggle('cap-off', key || hint);
};
const holdLegend = on => {
    if (on === legendHeld) return;
    legendHeld = on;
    syncCaption();
    showReachMarks(on);
};

// --- The reach carets ----------------------------------------------
// The hour peek is drawn as nothing at rest, and a hit box nobody can
// see is a feature nobody finds. These are the marks that say where its
// window can still go: a caret above and below the hour axis.
//
// They follow the key's own rule, which is the rule that made the key work:
// they exist for the moment a hand is on the surface, and the screen at
// rest is exactly what it was. So the glance costs nothing, and the answer
// is there the first time anyone touches the thing.
//
// Only the directions that lead somewhere are drawn, so a mark never
// promises a move the app will refuse.
//
// The day axis had a pair of gold arrows here too. They are gone with
// the paging: the elastic shows its own extent, in the widths of the
// columns, for as long as the pull lasts. A mark that says "there is
// more that way" is redundant beside a grid that is visibly making room.
const showReachMarks = on => {
    const live = on && !!state.data.length;
    const hours = live && hourPeekLive();
    const { min, max } = hours ? hourPeekRange() : { min: 0, max: 0 };
    $('reachUp').hidden = !(hours && hourOff > min);
    $('reachDown').hidden = !(hours && hourOff < max);
};

const renderLegend = () => {
    const legend = $('legend');
    // The key can still be turned off outright (⚙ Key → hide), in which
    // case it never appears at all; block tooltips still name every
    // condition on tap.
    if (!settings.legend) { legendHeld = false; syncCaption(); legend.innerHTML = ''; return; }
    legend.classList.remove('hidden');
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
    syncCaption();
};

// Toggle shows only the views enabled in ⚙; hidden entirely when
// just one view is left, since there is nothing to switch to.
// The underline is a measured element rather than a border, so it slides
// between the buttons on the stylesheet's own transition instead of
// jumping. It parks on the active view, and a view change moves it.
const viewBtn = v => $('viewSeg').querySelector(`button[data-view="${v}"]`);
const renderViewBar = () => {
    const seg = $('viewSeg'), bar = $('viewBar');
    const a = viewBtn(view);
    // No layout to measure (hidden toolbar, or a host that never lays
    // out): fall back to the button's own border-bottom, which is still
    // the underline until `has-bar` says otherwise.
    if (!a || !a.offsetWidth) { seg.classList.remove('has-bar'); bar.hidden = true; return; }
    seg.classList.add('has-bar');
    bar.hidden = false;
    // transform, not left/width: both of those are layout properties, and
    // the bar is a 1px block whose whole job is to move. The base is 1px
    // wide at x=0, so scaleX IS the width in pixels.
    bar.style.transform = `translateX(${a.offsetLeft}px) scaleX(${a.offsetWidth})`;
};

const renderViewToggle = () => {
    document.querySelectorAll('#viewToggle .seg button').forEach(b => {
        b.style.display = settings.views[b.dataset.view] ? '' : 'none';
        b.classList.toggle('active', b.dataset.view === view);
    });
    // Only the three view buttons come and go. The row itself carries the
    // city name and the status line, so hiding it would strand a phone
    // user with one view enabled: no way to change city, no way to search.
    $('viewSeg').style.display = enabledViews().length > 1 ? '' : 'none';
    renderViewBar();
};
const setView = (v, anim) => {
    const prev = view;
    view = v;
    // A view change owns the whole grid, so the hour peek goes home with
    // it. A LOCKED day stretch does not: the same nine days in rain and
    // then in wind is one of the two things a lock is for, and dropping
    // it here made the user set it up again for every view. Any unlocked
    // stretch still goes (the ways home now mean the peek, not the
    // decision).
    resetReveal();
    saveJSON(LS_VIEW, v);
    renderViewToggle();
    renderLegend();
    if (!state.data.length) return; // initial paint: no grid to animate yet
    // A swipe/arrow passes the wave direction; a toolbar click derives it
    // from the view's position relative to the previous one. paintGrid
    // falls back to an instant repaint under reduced motion.
    let a = anim;
    if (!a) {
        const en = enabledViews();
        const oi = en.indexOf(prev), ni = en.indexOf(v);
        a = (oi >= 0 && ni >= 0 && oi !== ni)
            ? { type: 'wave', axis: 'x', dir: ni > oi ? -1 : 1 }
            : { type: 'reveal' };
    }
    armArrival();
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
// PAST_DAYS trim. The elastic is measured in days from today, so a
// stretch left locked open across midnight keeps holding the same
// distance from today rather than the same calendar day, which is what
// the ⌂ chip promises.
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
const tooltipOpen = () => $('tooltip').style.opacity === '1';
// What is rendered and what it measured. The tooltip is asked to re-read
// itself far more often than it has anything new to say, and both the
// write and the measure are layout work; see the single write at the
// bottom of showTooltip. Cleared by hideTooltip (next open is a fresh one)
// and by onFrameResize (the width cap moved under it).
let tipHtml = '', tipW = 0, tipH = 0;
const invalidateTip = () => { tipHtml = ''; };
// `anchor` is the hour this reading was opened on, passed back in only by
// refreshActiveTooltip. Without it the anchor re-derives from whatever
// block covers it now, taking that block's START hour, so on a coarse day
// whose spans re-phase a notch at a time it walks backwards one block per
// notch. The hour asked for doesn't change because the grid redrew.
const showTooltip = (el, anchor = null) => {
    const tooltip = $('tooltip');
    // Whether this is an OPEN or a MOVE, decided before anything below
    // touches the opacity. A move travels to the new block; an open lands
    // where it is asked to and fades up, because a box sliding in from
    // wherever it was last used is not an entrance.
    const moving = tooltipOpen();
    // A tooltip opening means the screen is being read: pause any
    // reveal-idle countdown already running (the day drawer / hour
    // peek's own way home) rather than let it fire mid-investigation.
    // `pendingRevealFn` is left alone, so `hideTooltip` below knows
    // what to re-arm once this tooltip closes, and `armRevealIdle`
    // itself skips arming a fresh one while a tooltip is still open.
    clearTimeout(revealTimer);
    // A grid block on a coarse pointer is read by the docked card instead,
    // and the tooltip must be left entirely alone for it: an invisible box
    // whose pointerEvents had been set to 'auto' below is still a hit
    // target, so it would swallow taps aimed at the grid it is lying over.
    // The legend swatches and the freshness line keep the tooltip on every
    // pointer, so this is scoped to blocks.
    const cardCase = coarse() && el.id !== 'statusInfo' && el.dataset.cond == null;
    if (!cardCase) {
    // Prose explanation wraps and is interactive (so its link is
    // clickable); the fact tooltips stay single-line.
    tooltip.classList.toggle('explain', el.id === 'statusInfo');
    // Block tooltip gets the capped-width, hero-line layout; legend and
    // freshness tooltips keep the plain single-line style.
    tooltip.classList.toggle('block', el.id !== 'statusInfo' && el.dataset.cond == null);
    // Always interactive, not click-through. #tooltip lives
    // outside .chart in the DOM (a sibling, absolutely positioned),
    // so this can never be mistaken for a touch on the grid itself
    // or feed the chart's own swipe detection; it only ever reaches
    // the document click handler below, whose "not a TIP_SEL
    // target" branch closes it. That's the whole feature: tapping
    // the open tooltip closes it, same as tapping anywhere else
    // that isn't a block/legend swatch.
    tooltip.style.pointerEvents = 'auto';
    }
    // Cleared here; the grid-block branch re-arms it so a repaint (city
    // swap, view switch, background refresh) can re-render the open
    // tooltip against the new data at the same grid position.
    activeBlock = null;
    // Built here, written once at the bottom, only if it differs from what
    // is on screen. waveFrame re-reads an open tooltip on every frame of a
    // sweep where any cell changed hands, and nearly all of those frames
    // produce the same words: the cell being read flips once, not sixty
    // times. Writing innerHTML anyway invalidates layout and the
    // offsetWidth read below forces it back, per frame, under a wave that
    // is already writing a colour to every block.
    let html = '';
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
        html =
            title + body.map(l => `<div class="tip-body">${l}</div>`).join('') + docs;
    } else if (el.dataset.cond != null) { // legend cell: exact condition names
        const c = CONDITIONS[+el.dataset.cond];
        html =
            `<div><strong>${esc(c.label)}</strong></div><div>${namesFor(c.key).map(esc).join(' · ')}</div>`;
    } else { // grid block: view-ordered main lines, one detail line, hazard chips
        const di = +el.dataset.day;
        const day = state.days[di];
        // A far-day block stands for several hours, and the
        // tooltip is where the block says so. It is rebuilt from the
        // same hours the block was built from, through the same
        // reduction, so what the tooltip reports and what the block is
        // coloured by can never drift.
        const span = Math.max(1, +el.dataset.span || 1);
        const h0 = +el.dataset.hour;
        const hours = [];
        for (let k = 0; k < span; k++) {
            const found = state.data[di]?.find(x => x.hour === h0 + k);
            if (found) hours.push(found);
        }
        // No data behind this block. A bare return here left the tooltip
        // half-changed: the .explain/.block classes were already toggled
        // (they carry the padding and width cap, so the box re-sizes) and
        // activeBlock was already cleared, but the write, measure,
        // selection and position below never ran. It stayed on screen at
        // the old size and place, with no activeBlock for
        // refreshActiveTooltip to find it by again. Close instead.
        if (!day || !hours.length) { hideTooltip(); return; }
        const h = span === 1 ? hours[0] : spanHour(hours, h0);
        const rows = hourRange().end - hourRange().start + 1;
        const wholeDay = span >= rows;
        // The day and hour this reading is OF, so refreshActiveTooltip can
        // find it again. dayIndex is absolute and hour is an hour of the
        // day, so both survive a city swap, a view switch, a re-phased hour
        // window and a cadence change.
        activeBlock = {
            day: di,
            hour: anchor != null && anchor >= h0 && anchor < h0 + span ? anchor : h0
        };
        const sun = state.sun[day.date] || {};

        // Header: day + date left, the hour range right (kept whole so
        // it never wraps onto a second line). The hairline under it
        // (--divider, .tip-when's border-bottom) separates it from the
        // stats block below.
        const range = wholeDay ? 'all day'
            : `${hourLabel(h0)}–${hourLabel((h0 + span) % 24)}`;
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
        // Across a span the figure is the TOTAL, not the rate: "how much
        // rain in this block" is the question a three-hour block is
        // asked, and a mm/h that is the mean of three hours answers a
        // question nobody asked.
        const rainBits = [];
        let snowBit = '';
        const per = span === 1 ? '/h' : '';
        const mmVal = span === 1 ? h.mm : h.mmSpan;
        const snowVal = span === 1 ? h.snow : h.snowSpan;
        const liquidVal = span === 1 ? h.liquid : h.liquidSpan;
        if (!day.past && h.pop != null) rainBits.push(`${h.pop}%`);
        if (snowVal != null && snowVal > 0) {
            if (liquidVal != null && liquidVal >= 0.1) rainBits.push(`${liquidVal} mm${per}`);
            snowBit = `${snowVal} cm${per} snow`;
        } else if (mmVal != null) {
            rainBits.push(`${+mmVal.toFixed(1)} mm${per}`);
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
            // The band cue has two possible homes on a coarse pointer: this
            // line and the dressing figure, which draws the same band and
            // says the same sentence. Only one may print it, and the figure
            // is the one that needs it, so here it is the band NAME alone.
            // A fine pointer has no figure and keeps the whole line.
            activeDetail = coarse() ? esc(band.name)
                : `${esc(band.name)} - ${esc(band.cue)}`;
        } else if (view === 'wind') {
            const bits = [];
            // On a coarse pointer both halves of this line already have a
            // home in the card: the expanded foot owns the gusts and the
            // wind column's own second line owns the direction. Printing
            // them here as well is the repeat the two states forbid.
            if (!coarse()) {
                if (h.gust != null && h.wind != null && h.gust - h.wind >= GUST_MIN) bits.push(`gusts ${displayWind(h.gust)}`);
                if (h.windDir != null) bits.push(COMPASS[windOctant(h.windDir)]);
            }
            activeDetail = bits.join(' · ');
        }
        const shared = [];
        if (!claimedCondition) shared.push(esc(h.description));
        if (h.humidity != null && !claimedHumidity) shared.push(`humidity ${Math.round(h.humidity)}%`);
        // Visibility, but only when it is low enough to be the reason the
        // block is drawing a murk texture across itself. Every hour has a
        // visibility and a clear one's is not worth the room; a textured
        // block that cannot be asked why is what this is for. A tenth of a
        // km throughout, because the range it ever prints is 0 to 2 and the
        // difference between 200 m and 900 m is the whole reading.
        if (misty(h)) shared.push(`visibility ${(h.vis / 1000).toFixed(1)} km`);
        if (sun.rise && sun.set) shared.push(h0 < sun.rise.h + sun.rise.m / 60
            ? `sunrise ${timeLabel(sun.rise.h, sun.rise.m)}`
            : `sunset ${timeLabel(sun.set.h, sun.set.m)}`);
        if (21 >= h0 && 21 < h0 + span) { const sky = skyEventFor(day.date); if (sky) shared.push(esc(sky.label)); }
        const detailText = [activeDetail, ...shared].filter(Boolean).join(' · ');
        const detailLine = detailText ? `<div class="tip-ctx tip-detail">${detailText}</div>` : '';

        // What the block IS, said in its own line rather than folded in
        // with the weather: past the model's native hourly horizon the
        // series is interpolated, so a block covering six hours
        // has to say that it does and that the data behind it is no
        // longer hourly. Silence there would let a coarse reading be
        // read as an hour's reading.
        const provenance = span === 1 ? ''
            : `<div class="tip-ctx">${wholeDay ? 'daily value' : `${span}-hour block`} · beyond native hourly</div>`;

        // The was/now detail, as small muted lines under the detail
        // line. Recorded per hour, so a span has nothing to report.
        const chgLines = span > 1 ? []
            : changeLines(state.changed?.[`${day.date}|${h.hour}`]);
        const chg = chgLines.map(l => `<div class="tip-ctx">${l}</div>`).join('');

        // Hazard chips: one per corner glyph currently shown on the
        // block (none in wind view, where the arrow replaces them),
        // reusing the amber status pill.
        const chips = [];
        if (view !== 'wind') {
            if (h.glyph === 'storm') chips.push(h.code === 96 || h.code === 99 ? 'thunderstorm, hail' : 'thunderstorm');
            else if (h.glyph === 'fog') chips.push('fog');
            else if (h.glyph === 'freeze') chips.push('freezing rain');
            if (view === 'rain' && h.mm != null && h.mm >= LN.warn) chips.push(span === 1 ? 'heavy rain' : 'heavy rain in this block');
            if (h.temp >= settings.heatWarn) chips.push('extreme heat');
            if (h.uv != null && h.uv >= settings.uvWarn) chips.push(`very high UV (${Math.round(h.uv)})`);
            // The danger glyph, temperature view only, on feels-like.
            if (view === 'temp') {
                const dv = h.feels != null ? h.feels : h.temp;
                if (dv != null && dv <= TEMP_DANGER_COLD) chips.push('dangerous cold');
                else if (dv != null && dv >= TEMP_DANGER_HOT) chips.push('dangerous heat');
            }
        }
        const chipHtml = chips.length
            ? `<div class="tip-chips">${chips.map(c => `<span class="tip-chip">${esc(c)}</span>`).join('')}</div>` : '';

        // The comparison sits directly under the detail line and above the
        // hazard chips: it is a reading, not a warning, and a chip row
        // between the two numbers being compared would break the pair.
        // The city comparison reads the same hour in the other city, so
        // it has an hour to read. A span does not, and one hour of it
        // set against a whole block would be a comparison of two
        // different things.
        const compare = span === 1 ? sheetCompareLine(day.date, h) : '';

        // A coarse pointer takes the same facts and lays them out as the
        // docked card instead. Routed from here, at the bottom of the one
        // place that gathers them, so the two readings cannot come to
        // disagree about what the block says. The card arranges them
        // differently — three columns, a head and an expanded foot — but
        // every value below came from the lines above.
        if (coarse()) {
            showCard({
                day, h, span, wholeDay, sun, h0, dayName, range,
                activeDetail, claimedCondition, chips, chgLines, compare,
                mmVal, snowVal, liquidVal, per
            });
            markSelection();
            return;
        }
        html = when + temp + rain + wind + divider + detailLine + provenance + chg + compare + chipHtml;
    }
    // The one write, only when there is something new to write. Size is
    // cached with it: the box can only change size when its content does,
    // except on resize, which onFrameResize handles by clearing the cache.
    if (html !== tipHtml) {
        tooltip.innerHTML = html;
        tipHtml = html;
        tipW = tooltip.offsetWidth;
        tipH = tooltip.offsetHeight;
    }
    // The travel transition is armed BEFORE the position is written, and
    // only for a move. Placed after the innerHTML write so the box is
    // already the size it will be when it starts travelling.
    tooltip.classList.toggle('travel', moving && !reduceMotion());
    tooltip.style.opacity = '1';
    // Center on the block, clamp to the viewport; flip below the block
    // near the top edge.
    const rect = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(window.innerWidth - tipW - 8, rect.left + rect.width / 2 - tipW / 2));
    const y = rect.top < tipH + 16 ? rect.bottom + 8 : rect.top - tipH - 8;
    // transform rather than left/top: neither of those can be composited,
    // and this element moves on every block the pointer visits.
    const tf = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    if (tf !== tooltip.style.transform) tooltip.style.transform = tf;
    // Mark the block on the block itself. The tap that opened this repaints
    // nothing, so the class is set by hand here; every later repaint writes
    // it through cellClass.
    // Last, after the getBoundingClientRect above: a class change dirties
    // style, and a layout read right after one forces the recalc that the
    // cache above exists to avoid. markSelection also no-ops when the right
    // block is already marked, so on the sweep path it dirties nothing.
    markSelection();
};
let tappedBlock = null; // element whose tooltip was opened by a tap/click (shared by mouse and touch again)
let activeBlock = null; // {day,hour} of the open block tooltip, for re-render on repaint
// The live block standing for activeBlock's hour. The DOM half of
// coversActive, for the same reason: the hour peek, allHours and the
// tail-fold in blockSpans all re-phase spans, so the hour a reading was
// opened on routinely stops being any block's START hour.
const blockCovering = (day, hour) => {
    for (const el of $('grid').querySelectorAll(`.weather-block[data-day="${day}"]`)) {
        // Every column the elastic can reach stays in the DOM with its
        // dataset intact; applyDayWidths hides the out-of-reach ones with
        // display:none. They still match the selector and measure as a zero
        // rect, which parked the tooltip at the top-left corner.
        if (!el.getClientRects().length) continue;
        const h0 = +el.dataset.hour;
        if (hour >= h0 && hour < h0 + (+el.dataset.span || 1)) return el;
    }
    return null;
};
// The tap that opens a tooltip repaints nothing, so the selection class is
// written by hand for that case; every repaint after it goes through
// cellClass. Both read activeBlock, so they cannot disagree.
const markSelection = () => {
    const want = activeBlock ? blockCovering(activeBlock.day, activeBlock.hour) : null;
    const have = $('grid').querySelectorAll('.weather-block.sel');
    // Already right: touch nothing. On the sweep path cellClass has usually
    // just written the same class, and mutating would dirty style for free.
    if (have.length === (want ? 1 : 0) && (!want || have[0] === want)) return;
    have.forEach(n => n.classList.remove('sel'));
    want?.classList.add('sel');
};

// --- The docked reading, coarse pointers only ---------------------
// A full-width card resting under the date strip, in two states. It never
// takes a touch: `pointer-events: none` is permanent, so elementFromPoint
// never returns it and the grid underneath keeps every tap. Its own
// gestures are claimed by where they STARTED, in the pointer handlers
// further down.
//
// The two states share nothing. Everything the head and the three columns
// carry is absent from the foot and the advice row by design, so expanding
// adds facts rather than repeating them.
let cardExpanded = false;   // whether the open reading is showing its foot
let cardKey = '';           // date|hour of the reading the state belongs to
let cardHtml = '';          // last written markup, so a repaint that changes
                            // nothing writes nothing
const cardOpen = () => $('readingCard').classList.contains('open');
// Whether a point is inside the card's rectangle. A containment test on
// the card's own rect, NOT a hit test: elementFromPoint returning the card
// is the exact thing the form is built to avoid, and asking the browser
// what is under a point would re-introduce it.
const insideCard = (x, y) => {
    const r = $('readingCard').getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};
// Set on every pointerdown while a reading is open, and read by the two
// handlers that decide what a gesture on the card means. Origin, not
// target: the card takes no events, so where the finger LANDED is the only
// thing that can tell its gestures from the grid's.
let downInCard = false;

// How far the card may rise into the day strip, measured rather than
// assumed. Two readings, not a constant: the weekday's TOP is far enough to
// cover the weekday whole including whatever slack the label's line box
// leaves under it, and the date's own BOTTOM is the hard stop. They are the
// same boundary in a healthy layout, and taking the smaller means a broken
// measurement fails by covering too little rather than by eating the date.
// The +1 lands inside the date line box's half-leading, so no glyph is
// touched.
const cardRise = () => {
    const chart = document.querySelector('.chart');
    const wd = $('days').querySelector('.day-wd'), dt = $('days').querySelector('.day-date');
    if (!chart || !wd || !dt) return 0;
    const cr = chart.getBoundingClientRect();
    const wr = wd.getBoundingClientRect(), dr = dt.getBoundingClientRect();
    if (!wr.height || !dr.height) return 0;
    return Math.max(0, Math.min(cr.top - wr.top, cr.top - dr.bottom) + 1);
};

// Where the card rests. It has one home, the top of the chart risen into
// the weekday line, and one reason to leave it: a reading must never sit on
// the block it is a reading of.
//
// "Sit on" means GONE, not merely touched. A block with half of itself
// still showing is still a block you can see and still a block you can hit,
// so the card holds its place; it flips to the far end only when nothing of
// the block is left. Flipping on first contact made the card jump for
// blocks that were never actually hidden, which is a bigger cost than a
// clipped edge, and this threshold means the card moves rarely.
//
// Measured against the block's own rect rather than computed from rows:
// --band is a percentage here, set from JS, so a pixel band would be a
// second copy of the row geometry that could drift from the first.
const placeCard = () => {
    const card = $('readingCard');
    if (!card.classList.contains('open')) return;
    const chart = document.querySelector('.chart');
    const top = -cardRise();
    // No block covers this hour: the elastic has pulled the day off screen.
    // The card says so (see the orphan class) and does not move, because
    // there is nothing left to be in the way of.
    const blk = activeBlock && blockCovering(activeBlock.day, activeBlock.hour);
    if (chart && blk) {
        const cr = chart.getBoundingClientRect(), br = blk.getBoundingClientRect();
        const blkTop = br.top - cr.top, blkBot = br.bottom - cr.top;
        const h = card.offsetHeight;
        const cover = t => Math.max(0, Math.min(blkBot, t + h) - Math.max(blkTop, t));
        // Half a pixel of tolerance, so subpixel rounding cannot leave a
        // sliver that claims the block is still visible when it is not.
        const gone = (blkBot - blkTop) > 0 && cover(top) >= (blkBot - blkTop) - 0.5;
        card.classList.toggle('at-bottom', gone);
        card.style.top = (gone ? Math.max(0, chart.clientHeight - h) : top).toFixed(1) + 'px';
        measureVeil(chart, card);
        return;
    }
    card.style.top = top.toFixed(1) + 'px';
    if (chart) measureVeil(chart, card);
};

// --- The veil -----------------------------------------------------
// How much see-through the gesture in progress needs, 0..1. Two sources,
// taken at their maximum, neither of them a state flag:
//
//   proximity  1 while the finger is inside the card, ramping to 0 over
//              2.2 hour-rows outside it. Counted in rows rather than
//              pixels so it means the same at 390 and at 360. A gesture
//              that never goes near the card leaves it alone.
//   pull       ramps with the elastic's travel, because during a peek the
//              columns underneath are the thing being watched.
//
// The pull ramp is SQUARED, so a short pull barely touches the panel: a
// small pull is a correction rather than a comparison, and thinning the
// reading for it takes the reading away in exchange for nothing. Squared
// rather than a hold-then-ramp, because holding needs a second distance
// threshold and PULL_SLOP is the only arbiter § Navigation allows.
const VEIL_DEPTH = 2.2;     // hour-rows
const VEIL_TOP = 0.96, VEIL_FLOOR = 0.75;
// Both measured once per placement, not per frame: the card only moves
// when it flips, and a rect read inside a gesture is a forced layout.
let veilRect = null, veilRange = 0;
const measureVeil = (chart, card) => {
    const w = visibleWindow();
    veilRange = (chart.clientHeight / Math.max(1, w.end - w.start + 1)) * VEIL_DEPTH;
    veilRect = card.getBoundingClientRect();
};
const veilFor = (x, y) => {
    let prox = 0;
    if (veilRect && veilRange > 0 && x != null) {
        const r = veilRect;
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        prox = Math.max(0, 1 - Math.hypot(dx, dy) / veilRange);
    }
    const t = Math.abs(pull?.travel || 0);
    return Math.max(prox, Math.pow(Math.min(1, t / 100), 2));
};
// 0.96 → 0.75: thinned enough to read the grid through, not so thin that
// the reading stops being a panel. The text never fades either way.
const applyVeil = v => {
    const card = $('readingCard');
    if (!card.classList.contains('open')) return;
    card.classList.toggle('veiling', v > 0.002);
    card.style.setProperty('--card-a', (VEIL_TOP - (VEIL_TOP - VEIL_FLOOR) * v).toFixed(3));
};

const cardCells = (f) => {
    const dim = k => k === view ? '' : ' dim';
    const cell = (k, lb, big, sub) =>
        `<div class="rc-cell rc-${k}${k === view ? ' on' : ''}">`
        + `<span class="rc-lb">${lb}</span>`
        + `<span class="rc-val${dim(k)}">${big}</span>`
        + (sub ? `<span class="rc-sub">${sub}</span>` : '')
        + `</div>`;
    const h = f.h;
    // Temperature: the reading, with the apparent temperature under it. The
    // band the figure draws comes from the same feels-like.
    const temp = cell('temp', 'Temp',
        h.temp != null ? `${displayTemp(h.temp)}°` : '—',
        h.feels != null ? `feels ${displayTemp(h.feels)}°` : '');
    // Rain: the amount leads, because that is what the block is drawing;
    // the chance follows it. A snowing hour puts the snow depth in front
    // and keeps its liquid equivalent in the second line, which is the
    // same split the tooltip makes across two lines.
    const snowing = f.snowVal != null && f.snowVal > 0;
    const rainBig = snowing ? `${f.snowVal} cm${f.per}`
        : f.mmVal != null ? `${+f.mmVal.toFixed(1)} mm${f.per}` : '—';
    const rainSub = [];
    // A past day drops the chance for the reason the tooltip drops it: the
    // hour has happened, so a probability beside a known outcome is a
    // prediction about the past.
    if (!f.day.past && h.pop != null) rainSub.push(`${h.pop}%`);
    if (snowing && f.liquidVal != null && f.liquidVal >= 0.1) rainSub.push(`${f.liquidVal} mm${f.per}`);
    const rain = cell('rain', 'Rain', rainBig, rainSub.join(' · '));
    const wind = cell('wind', 'Wind',
        h.wind != null ? `${displayWind(h.wind)} ${windUnitLabel()}` : '—',
        h.windDir != null ? COMPASS[windOctant(h.windDir)] : '');
    return `<div class="rc-cells">${temp}${rain}${wind}</div>`;
};

// The expanded state's own facts: the three the columns had no room for,
// then the ambient ones the tooltip carried on its detail line. Nothing
// here appears anywhere else on the card.
const cardFoot = (f) => {
    const h = f.h, bits = [];
    if (h.gust != null && h.wind != null && h.gust - h.wind >= GUST_MIN)
        bits.push(`gusts ${displayWind(h.gust)} ${windUnitLabel()}`);
    if (h.humidity != null) bits.push(`humidity ${Math.round(h.humidity)}%`);
    if (h.cloud != null) bits.push(`cloud ${Math.round(h.cloud)}%`);
    if (misty(h)) bits.push(`visibility ${(h.vis / 1000).toFixed(1)} km`);
    if (f.sun.rise && f.sun.set) bits.push(f.h0 < f.sun.rise.h + f.sun.rise.m / 60
        ? `sunrise ${timeLabel(f.sun.rise.h, f.sun.rise.m)}`
        : `sunset ${timeLabel(f.sun.set.h, f.sun.set.m)}`);
    if (21 >= f.h0 && 21 < f.h0 + f.span) {
        const sky = skyEventFor(f.day.date); if (sky) bits.push(esc(sky.label));
    }
    return bits.length ? `<div class="rc-foot">${bits.join(' · ')}</div>` : '';
};

// --- What the hour means for walking out of the door --------------
// The expanded state is worth opening only if it says something the
// collapsed state does not, and the collapsed columns already carry every
// number worth printing. This is the one part of the reading that is not
// the data restated.
//
// The warmth half is the app's own comfort scale and nothing else. TEMP_BANDS
// has carried an absolute feels-like scale since the temperature view was
// built — eight bands, the same edges in every city, each with one prep cue
// the temp view already prints. The figure draws the band the block behind it
// is already coloured by and says the sentence the app already wrote, so
// there is no second scale to drift from the first. `bandIndex` is what
// decides which band, which means the lower-edge-inclusive comparison
// (`feels < max`, so -8 is Freezing and 0 is Cold) exists in exactly one
// place and cannot be got backwards here.
//
// The accessory half is a branch of its own, and its thresholds are fixed:
// gusts at 35 km/h is where an umbrella stops being the answer, a 30% chance
// puts a carried umbrella on a dry hour, and UV 6 is strong sun. They run on
// feels-like and on the block's own numbers, so a span reads the same
// reduction its colour and its glyphs already come from.
const GEAR_GUST = 35, GEAR_CHANCE = 30, GEAR_UV = 6;
// Band index to the garment it puts on. One entry per TEMP_BANDS band, cold
// to hot; each step is one garment against the step below it.
const WEAR_BANDS = ['bitter', 'freezing', 'cold', 'cool', 'comfort', 'warm', 'hot', 'veryhot'];
const dressFor = (h, past) => {
    const feels = h.feels != null ? h.feels : h.temp;
    if (feels == null) return null;
    const i = bandIndex(feels);
    const gusty = h.gust != null && h.gust >= GEAR_GUST;
    const wet = (h.mm != null && h.mm > 0) || (h.snow != null && h.snow > 0);
    let gear = null;
    if (wet && h.mm > 2)
        gear = gusty ? ['hood', 'rain jacket. the gusts will turn an umbrella out']
                     : ['umbrella', 'umbrella, or arrive soaked'];
    else if (wet)
        gear = gusty ? ['hood', 'rain jacket rather than an umbrella']
                     : ['umbrella', 'umbrella'];
    // A past hour has no chance left to advise on, the same reason the rain
    // column drops the percentage there.
    else if (!past && h.pop != null && h.pop >= GEAR_CHANCE)
        gear = ['umbrella', 'umbrella, on the chance it turns'];
    else if (h.uv != null && h.uv >= GEAR_UV) gear = ['sun', 'strong sun. hat, or sunscreen'];
    else if (gusty) gear = ['wind', 'gusty enough to hold on to a hat'];
    return {
        wear: WEAR_BANDS[i], gear: gear && gear[0], wet,
        lines: gear ? [TEMP_BANDS[i].cue, gear[1]] : [TEMP_BANDS[i].cue]
    };
};

// --- The dressing figure ------------------------------------------
// A wardrobe on a 34x44 box. A step up the scale is a garment arriving
// rather than a hem moving: at this size a proportion is not legible and a
// category is, so warmth is a count of garments and the sleeve carries the
// warm end.
//
// Three construction rules, each of which exists because the obvious
// version failed a render.
//
// 1. ONE LINE WEIGHT, so occlusion is constructed rather than painted.
//    Uniform 1.5 everywhere and no fills, which has a consequence: with no
//    fill, drawing something later does not hide what is under it, so
//    z-order is meaningless and every garment is drawn as the part of it
//    that can actually be seen. Pants start at the hem of whatever is over
//    them, the coat loses its neckline when the scarf is on, and trouser
//    legs stop at the top of the shoe — a round cap puts half its width
//    past its own endpoint, which reads as a spur below the foot.
// 2. THE ARM IS AN AXIS FIRST AND A SLEEVE SECOND. The axis runs from the
//    centre of the armhole to the wrist, the sleeve is generated as a quad
//    around it, and the bare forearm is that same line continued past the
//    cuff, so the two cannot disagree. Drawing the sleeve as a shape and
//    aiming the forearm at it afterwards makes them agree only as well as
//    they were nudged, which on the t-shirt was visibly not.
// 3. THE HEAD IS A CIRCLE, hatted or not, and the brim crosses the crown,
//    which is what a brim does.
//
// Colour is a second channel and never the carrier: remove it and the
// ladder still reads, which is the only version that survives greyscale, a
// colour-blind reader or a thinned panel.
const FIGURE = (() => {
    const f = n => n.toFixed(2);
    // side is +1 left, -1 right; it keeps the polygon from self-intersecting
    // on the mirrored arm. cut is the fraction of the axis the sleeve covers
    // and is the only thing separating a t-shirt sleeve from a jumper's:
    // below about 0.6 the wrist is bare and the forearm is drawn, above it
    // the sleeve reaches the wrist and a hand closes it.
    const arm = (side, st, ua, wrist, cut, w) => {
        const m = [(st[0] + ua[0]) / 2, (st[1] + ua[1]) / 2];
        const d = [wrist[0] - m[0], wrist[1] - m[1]];
        const len = Math.hypot(d[0], d[1]) || 1;
        const ox = -side * d[1] * w / len, oy = side * d[0] * w / len;
        const h = [m[0] + d[0] * cut, m[1] + d[1] * cut];
        return {
            sleeve: `<path d="M${f(st[0])} ${f(st[1])} L${f(h[0] + ox)} ${f(h[1] + oy)} `
                + `L${f(h[0] - ox)} ${f(h[1] - oy)} L${f(ua[0])} ${f(ua[1])} Z"/>`,
            fore: `<path d="M${f(h[0])} ${f(h[1])} L${f(wrist[0])} ${f(wrist[1])}"/>`,
            wrist
        };
    };
    const UP = [22.90, 13.40];          // where the umbrella handle runs
    // The armhole is 4.2 long against a 3.0 cuff, so the sleeve tapers
    // rather than flares. It still read as a wing at first: a wrist at x 8.6
    // puts the sleeve more than a unit outside the coat hem at 9.9 and the
    // eye takes the overhang for the garment. The wrist came in rather than
    // the shape changing.
    const GEOM = {
        tshirt: { st: [11.2, 14.0], ua: [12.6, 18.6], wr: [9.40, 25.40], cut: 0.42, w: 1.50 },
        jumper: { st: [11.0, 13.9], ua: [12.4, 17.9], wr: [9.50, 25.70], cut: 0.88, w: 1.40 },
        jacket: { st: [11.0, 13.8], ua: [12.4, 17.8], wr: [9.45, 26.00], cut: 0.89, w: 1.45 },
        coat: { st: [10.8, 13.7], ua: [12.2, 17.7], wr: [9.40, 26.40], cut: 0.90, w: 1.50 }
    };
    const mirror = p => [30 - p[0], p[1]];
    const arms = (garment, raised) => {
        const g = GEOM[garment];
        const L = arm(1, g.st, g.ua, g.wr, g.cut, g.w);
        const R = raised
            ? arm(-1, mirror(g.st), mirror(g.ua), UP, g.cut, g.w)
            : arm(-1, mirror(g.st), mirror(g.ua), mirror(g.wr), g.cut, g.w);
        return {
            sleeve: L.sleeve + R.sleeve,
            bare: g.cut < 0.6 ? L.fore + R.fore : '',
            hands: [L.wrist, R.wrist]
        };
    };

    const HEAD = '<circle cx="15" cy="7.6" r="4"/><path d="M15 11.6 V13.6"/>';
    const HAT = '<path d="M11.6 5.2 A3.5 3.5 0 0 1 18.4 5.2"/>'
        + '<path d="M10.7 5.3 H19.3"/><circle cx="15" cy="1.4" r="1.2"/>';
    // A sun hat is a shallow crown over a brim that overhangs the head by two
    // units either side; the winter hat is a tall crown over a narrow brim.
    // Shape tells them apart, which matters because they share the accessory
    // colour and sit at opposite ends of the same scale.
    const SUNHAT = '<path d="M12.3 5.6 A2.8 2.8 0 0 1 17.7 5.6"/>'
        + '<path d="M9.4 5.7 H20.6"/>';
    const SCARF = '<path d="M11.2 12.2 H18.8 V15.4 H11.2 Z"/>'
        + '<path d="M16.2 15.4 H18.8 V21.8 L17.5 22.8 L16.2 21.8 Z"/>';
    const TEE = '<path d="M11.2 14.0 L12.6 18.6 L12.0 24.8 H18.0 L17.4 18.6 '
        + 'L18.8 14.0 Q15 16.4 11.2 14.0 Z"/>';
    const JUM = '<path d="M11.0 13.9 L12.4 17.9 L11.9 26.6 H18.1 L17.6 17.9 '
        + 'L19.0 13.9 Q15 16.3 11.0 13.9 Z"/>';
    // The Cool band's light jacket: the same blue as the coat, three units
    // shorter, and no scarf. Cool to Cold is the scarf arriving.
    const JKT = '<path d="M11.0 13.8 L12.4 17.8 L10.7 28.4 H19.3 L17.6 17.8 '
        + 'L19.0 13.8 Q15 16.3 11.0 13.8 Z"/><path d="M15 15.3 V28.0"/>';
    const CTC = '<path d="M10.8 13.7 L12.2 17.7 L9.9 30.4 H20.1 L17.8 17.7 '
        + 'L19.2 13.7 Q15 16.2 10.8 13.7 Z"/><path d="M15 15.2 V30.0"/>';
    // The same coat with no neckline: the scarf is sitting on it.
    const CTO = '<path d="M10.8 13.7 L12.2 17.7 L9.9 30.4 H20.1 L17.8 17.7 '
        + 'L19.2 13.7"/><path d="M15 15.8 V30.0"/>';
    const BARE = {
        L: '<path d="M15 15.6 L10.2 23.4"/>',
        R: '<path d="M15 15.6 L19.8 23.4"/>',
        up: '<path d="M15 15.6 L22.4 13.2"/>'
    };
    const shortsBare = '<path d="M11.4 23.2 H18.6 L19.2 29.2 H15.8 L15 26.8 '
        + 'L14.2 29.2 H10.8 Z"/>';
    const shortsTee = '<path d="M11.1 24.8 L10.6 29.4 H14.2 L15 26.9 L15.8 29.4 '
        + 'H19.4 L18.9 24.8"/>';
    const bareLegs = '<path d="M13.5 29.3 L13.1 35.8"/><path d="M16.5 29.3 L16.9 35.8"/>';
    const trousers = (y, to) =>
        `<path d="M12.0 ${y} L11.6 ${to}"/><path d="M14.6 ${y} L14.2 ${to}"/>`
        + `<path d="M18.0 ${y} L18.4 ${to}"/><path d="M15.4 ${y} L15.8 ${to}"/>`;
    const SHOE_T = '<path d="M11.6 35.8 H14.2 V37.6 H9.8 V36.6 Z"/>'
        + '<path d="M18.4 35.8 H15.8 V37.6 H20.2 V36.6 Z"/>';
    const SHOE_B = '<path d="M12.3 35.8 H14.0 V37.6 H10.4 V36.6 Z"/>'
        + '<path d="M17.7 35.8 H16.0 V37.6 H19.6 V36.6 Z"/>';
    const BOOTS = '<path d="M11.6 33.4 H14.2 V37.8 H9.6 V36.4 Z"/>'
        + '<path d="M18.4 33.4 H15.8 V37.8 H20.4 V36.4 Z"/>';
    const dot = (p, r) => `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${r}"/>`;

    // The hood is rain and the hat is cold; neither has to be read in the
    // light of the other. This hood is the figure's own: the shared one arcs
    // to y 4.9 against a crown at 3.6 and cuts across the face.
    const HOOD = '<path d="M9.6 13.0 A6.8 6.8 0 0 1 20.4 13.0"/>'
        + '<path d="M9.6 13.0 L10.9 15.8"/><path d="M20.4 13.0 L19.1 15.8"/>';
    const RAIN = '<path d="M4.6 13.8 L3 17.6"/><path d="M7.2 16.4 L5.6 20.2"/>'
        + '<path d="M4.2 23 L2.6 26.8"/>';
    const BROLLY = '<path d="M17.2 9.6 A6.3 6.3 0 0 1 29.8 9.6 Z"/><path d="M23.5 2.6 V4"/>'
        + '<path d="M23.5 9.6 V15.4"/>';
    const SUN = '<circle cx="27" cy="7" r="2.8"/>'
        + '<path d="M27 2.2 V3.4 M27 10.6 V11.8 M22.2 7 H23.4 M30.6 7 H31.8 '
        + 'M23.6 3.6 L24.4 4.4 M29.6 9.6 L30.4 10.4 M30.4 3.6 L29.6 4.4 M24.4 9.6 L23.6 10.4"/>';
    const WIND = '<path d="M2 15.5 H8.4 A1.9 1.9 0 1 0 6.5 13.6"/><path d="M2 20.5 H6.6"/>';

    // A colour per garment rather than a colour per temperature. A ramp says
    // how cold it is, which the words beside the figure already say; this
    // says what is on the figure, which is the only thing the drawing is for.
    // One accessory colour covers scarf, hat, mittens and boots together,
    // because those are read as a count and not as four separate things.
    // Legwear is 11 and 15 points darker than any body garment on purpose: at
    // its first value it sat within 3% lightness of both the jumper and the
    // coat, a hue difference and nothing else, so in greyscale the trousers
    // merged into the coat above them.
    const WEARC = {
        skin: '#E8E1D4', leg: '#6E7C96', tee: '#F2C14E',
        jum: '#E07A5F', coat: '#5BA8D8', acc: '#6FCF97'
    };
    const GEARC = { umbrella: '#87CEEB', hood: '#87CEEB', sun: '#F0C060', wind: '#50C878' };

    // Both ends of the scale saturate, and not symmetrically. At the cold end
    // there is always one more thing to put on. At the hot end there is not:
    // `hot` has already removed everything a figure can remove, so `veryhot`
    // has to ADD the only garment that gets worn for heat.
    const build = (band, raised) => {
        const p = [], add = (k, s) => p.push([k, s]);
        const hatted = band === 'freezing' || band === 'bitter';
        const mitts = band === 'bitter';
        const hr = mitts ? 1.7 : 1.3, hk = mitts ? 'acc' : 'skin';

        if (band === 'hot' || band === 'veryhot') {
            add('leg', shortsBare + bareLegs + SHOE_B);
            add('skin', HEAD + '<path d="M15 13.4 V23.4"/>');
            add('skin', BARE.L + (raised ? BARE.up : BARE.R));
            if (band === 'veryhot') add('acc', SUNHAT);
            return p;
        }
        if (band === 'warm') {
            const a = arms('tshirt', raised);
            add('leg', shortsTee + bareLegs + SHOE_B);
            add('skin', HEAD);
            add('tee', TEE); add('tee', a.sleeve);
            add('skin', a.bare);
            return p;
        }
        if (band === 'comfort') {
            const a = arms('jumper', raised);
            add('leg', trousers(26.6, 35.8) + SHOE_T);
            add('skin', HEAD);
            add('jum', JUM); add('jum', a.sleeve);
            add('skin', a.hands.map(w => dot(w, 1.3)).join(''));
            return p;
        }
        if (band === 'cool') {
            const a = arms('jacket', raised);
            add('leg', trousers(28.4, 35.8) + SHOE_T);
            add('skin', HEAD);
            add('coat', JKT); add('coat', a.sleeve);
            add('skin', a.hands.map(w => dot(w, 1.3)).join(''));
            return p;
        }
        const a = arms('coat', raised);
        add('leg', trousers(30.4, mitts ? 33.4 : 35.8) + (mitts ? '' : SHOE_T));
        if (mitts) add('acc', BOOTS);
        add('skin', HEAD);
        add('coat', hatted ? CTO : CTC); add('coat', a.sleeve);
        add(hk, a.hands.map(w => dot(w, hr)).join(''));
        add('acc', SCARF + (hatted ? HAT : ''));
        return p;
    };

    // The raised arm is the same call with the wrist replaced by the
    // umbrella handle, so the whole limb — cuff, hand and mitten — swaps as
    // one piece rather than a second arm being added beside the first.
    return (a) => {
        const raised = a.gear === 'umbrella';
        let body = build(a.wear, raised)
            .map(([k, s]) => `<g stroke="${WEARC[k]}" color="${WEARC[k]}">${s}</g>`).join('');
        let extra = '';
        if (raised) extra = BROLLY + (a.wet ? RAIN : '');
        else if (a.gear === 'hood') { body += `<g stroke="${GEARC.hood}">${HOOD}</g>`; extra = RAIN; }
        else if (a.gear === 'sun') extra = SUN;
        else if (a.gear === 'wind') extra = WIND;
        const gc = a.gear && GEARC[a.gear];
        if (extra && gc) extra = `<g stroke="${gc}">${extra}</g>`;
        return `<svg viewBox="0 0 34 44" fill="none" stroke="currentColor" stroke-width="1.5" `
            + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}${extra}</svg>`;
    };
})();

// The advice row. Expanded state only, and nothing in it is tappable: it
// lives inside a pointer-events:none element and must stay that way. It does
// not animate, so prefers-reduced-motion is honoured by construction.
const cardAdvice = (f) => {
    const a = dressFor(f.h, f.day.past);
    if (!a) return '';
    return `<div class="rc-adv"><span class="rc-fig">${FIGURE(a)}</span>`
        + `<span class="rc-lines">${a.lines.map(l => `<span class="rc-a">${esc(l)}</span>`).join('')}</span></div>`;
};

const cardHTML = (f, expanded) => {
    // What the active view makes of this block, then what the block is.
    // In the rain view those are the same sentence and the detail line
    // says so, so it is not printed twice.
    const cond = [f.activeDetail, f.claimedCondition ? '' : esc(f.h.description)]
        .filter(Boolean).join(' · ');
    const chips = f.chips.length
        ? `<div class="rc-chips">${f.chips.map(c => `<span class="rc-chip">${esc(c)}</span>`).join('')}</div>` : '';
    const head = `<div class="rc-head">`
        + `<span class="rc-when">${f.dayName} ${dateLabel(f.day.date)}</span>`
        + `<span class="rc-hr">${f.range}</span>`
        + (cond ? `<span class="rc-cond">${cond}</span>` : '')
        + chips + `</div>`;
    // The span provenance, the was/now lines and the city comparison stay
    // with the collapsed state: each is a reason the reading exists rather
    // than detail the expansion reveals, and the comparison in particular
    // is what makes an open reading the comparison tool.
    const notes = [
        f.span === 1 ? ''
            : `<div class="rc-note">${f.wholeDay ? 'daily value' : `${f.span}-hour block`} · beyond native hourly</div>`,
        f.chgLines.map(l => `<div class="rc-note">${l}</div>`).join(''),
        f.compare
    ].filter(Boolean).join('');
    return head + cardCells(f) + notes + (expanded ? cardAdvice(f) + cardFoot(f) : '');
};

const showCard = (f) => {
    const card = $('readingCard');
    // Keyed on the DATE, not on the day index: a preview sweep can put two
    // columns on the same index for a frame, and an index is a position in
    // the window rather than a property of the reading.
    const key = `${f.day.date}|${activeBlock.hour}`;
    // Expansion is a property of the reading that was expanded, not a
    // preference the next one inherits.
    if (key !== cardKey) { cardExpanded = false; cardKey = key; }
    const html = cardHTML(f, cardExpanded);
    // Written only when it differs. A repaint mid-sweep re-reads the open
    // card on every frame and nearly all of them produce the same words.
    if (html !== cardHtml) { card.innerHTML = html; cardHtml = html; }
    card.classList.remove('orphan');
    card.classList.add('open');
    // At open time, never mid-gesture: see the .chart.reading-open note in
    // the stylesheet for why the scope is the whole chart and not the card.
    document.querySelector('.chart')?.classList.add('reading-open');
    placeCard();
};

const hideCard = () => {
    const card = $('readingCard');
    if (!card) return;
    document.querySelector('.chart')?.classList.remove('reading-open');
    card.classList.remove('open', 'orphan');
    cardHtml = '';
    cardKey = '';
    cardExpanded = false;
};

const hideTooltip = () => {
    const t = $('tooltip');
    t.style.opacity = '0';
    // Closed, so the next open is an open: it must land where it is asked
    // to rather than slide there from the block this one was on.
    t.classList.remove('travel');
    t.style.pointerEvents = 'none'; // hidden tooltip must never intercept clicks
    hideCard();                     // one reading, one way to close it
    tappedBlock = null;
    activeBlock = null;
    // Nothing is being read, so nothing is selected. After activeBlock is
    // cleared, which is what markSelection reads to know there is no ring.
    markSelection();
    // Next open is an open, not a re-read: build and measure from scratch
    // rather than trust a size taken for different words.
    invalidateTip();
    // A hover grace still counting down would re-open a moment after this
    // closed it. Matters most when the close wasn't the pointer's doing:
    // visibilitychange, or a repaint finding the block gone.
    cancelTipHover();
    // The tooltip that was pausing the reveal-idle countdown (see
    // `showTooltip`) just closed: resume it. `springHours` is a no-op
    // once the offset is already back at rest, so re-arming here even
    // when there is nothing left to do is harmless rather than
    // something this needs to check first.
    if (pendingRevealFn) {
        clearTimeout(revealTimer);
        revealTimer = setTimeout(pendingRevealFn, REVEAL_IDLE_MS);
    }
};
// Re-render an open block tooltip after the grid repaints. The mouse
// hasn't moved (no mouseover fires), so swapping city with the keyboard
// would otherwise leave the old city's tooltip on screen. Re-target the
// block covering the same hour and re-show it from fresh state.
const refreshActiveTooltip = () => {
    if (!activeBlock || !(cardOpen() || $('tooltip').style.opacity === '1')) return;
    // By coverage. The old exact [data-hour] match tied a reading to a
    // block's start hour, which is a property of where the hour window
    // happens to be standing, not of the forecast. One notch of hour peek
    // re-phased every span on a coarse day and the reading vanished, while
    // the same reading survived a seven-day pull.
    const el = blockCovering(activeBlock.day, activeBlock.hour);
    if (!el) {
        // The card holds its hour rather than closing when the day it reads
        // has been pulled off screen: the numbers on it are still true, and
        // the day comes back when the elastic does. What it stops doing is
        // claiming to point at something visible. A floating tooltip has no
        // way to say that, so it still closes.
        if (cardOpen()) { $('readingCard').classList.add('orphan'); markSelection(); return; }
        return hideTooltip();
    }
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
    showTooltip(el, activeBlock.hour);
    // showTooltip may find nothing behind the block and close instead (its
    // !hours.length branch). Re-pinning then would point tappedBlock at a
    // tooltip that isn't open, so "tap the same block to close it" would
    // answer a tooltip nobody can see. activeBlock is the flag: the close
    // path clears it, the show path sets it.
    if (wasPinned && activeBlock) tappedBlock = el;
};

// Index of the arrow-key-highlighted search row (-1 = none). Reset
// whenever the results list is rebuilt or the panel closes.
let searchHighlight = -1;
// Search is done. The field is emptied and focus dropped so the global
// keydown guard stops treating keystrokes as typing, and the sheet steps
// BACK to the places rather than closing: search is a mode of it, and one
// step back out of a mode is not the same thing as dismissing the sheet.
const closeSearch = () => {
    $('searchInput').value = '';
    $('searchResults').innerHTML = '';
    searchHighlight = -1;
    $('searchInput').blur();
    if (sheetMode !== 'search') return;
    if (sheetLive()) setSheetMode('places');
    else { sheet = null; hideSheetChrome(); }
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

// Paint state.place's cached forecast, if any. One code path
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
        // First open and a city switch both land here, and both are a
        // grid the eye has not seen before.
        armArrival();
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
    // A new city arrives on the default hours, the same way the app
    // opens. A locked day stretch comes with it, because "how does day 9
    // look THERE" is the question a city switch under an open stretch is
    // asking, and closing it made that question two gestures every time.
    // It is measured in days from today, so it means the same thing
    // against the new payload; if that payload is shorter,
    // `reconcileElastic` clamps it when it lands, and closes it if the
    // new city has no reach at all.
    resetReveal();
    saveJSON(LS_PLACE, place);
    if (remember) rememberCity(place);
    state.data = []; state.days = []; state.fetchedAt = 0;
    // Change marks belong to the previous city; a cached paint
    // or startup paint alone never pulses (no new model run to
    // announce). The next differing fetch rebuilds them.
    state.changed = null; state.pulsePending = false;
    renderLocation();
    syncURL(place);
    closeSearch();
    // Paint this place's cached forecast in the same frame (the
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

// Ordering: ★ pinned first (always, filtered by the query), then
// (only in the resting list) the transient recents, then live geocoding
// hits. Typing collapses recents but keeps matching pinned above the
// geocoding results, so a pinned city is always one keystroke away.
//
// The three used to be one flat run of identical rows, distinguishable
// only by which buttons happened to be on them — so the list said nothing
// about the fact that its three parts have three different lifetimes.
// They are grouped and named now, with the same seam the switcher uses,
// because the search list is where those lifetimes are decided.
const SUGGEST_TIERS = { pinned: 'pinned', recent: 'recent', result: '' };
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
        ...favs.map(p => ({ ...p, tier: 'pinned' })),
        ...recents.map(p => ({ ...p, tier: 'recent' })),
        ...hits.map(p => ({ ...p, tier: 'result' }))
    ];
    searchHighlight = -1; // list rebuilt: drop any arrow-key highlight
    $('searchResults').innerHTML =
        state.suggestions.map((p, i, all) => {
            const first = i === 0 || all[i - 1].tier !== p.tier;
            const label = first ? SUGGEST_TIERS[p.tier] : '';
            // One action per row, and it is the one that applies. A pinned
            // city can only be unpinned and everything else can only be
            // pinned, so there is never a button here whose meaning has to
            // be worked out from the row it is sitting on. The old ✕ meant
            // three things at once — drop from recents, drop from
            // favourites, and evict the cache — and none of them was the
            // one thing anybody wanted, which was "not in my mains".
            const action = p.tier === 'pinned'
                ? `<button class="unpin" data-i="${i}" aria-label="Unpin ${esc(p.name)}" title="Unpin">${MR_ICON.unpin}</button>`
                : `<button class="pin" data-i="${i}" aria-label="Pin ${esc(p.name)}" title="Pin to your mains">${MR_ICON.pin}</button>`;
            return `<div class="search-result tier-${p.tier}${first && i > 0 ? ' seam' : ''}" data-i="${i}">
                <span class="result-label"><span class="rl-city">${esc(p.name)}</span>${
                    (p.admin1 || p.country)
                        ? `<span class="rl-region">${p.admin1 ? `, ${esc(p.admin1)}` : ''}${p.country ? `, ${esc(p.country)}` : ''}</span>`
                        : ''
                }</span>
                ${label ? `<span class="rl-tier">${esc(label)}</span>` : ''}
                <span class="result-actions">${action}</span>
            </div>`;
        }).join('');
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

// A pointer crossing the grid passes over a lot of blocks on the way to
// the one it wants, and each of those used to open a tooltip. The result
// was a box strobing across the screen ahead of the cursor. A short grace
// means the crossing costs nothing and only the block the pointer stops on
// opens. Once one IS open the grace is skipped: moving between blocks with
// a tooltip already up is reading, not crossing, and it should keep up.
const TIP_HOVER_MS = 90;
let tipHoverTimer = 0;
const cancelTipHover = () => { if (tipHoverTimer) { clearTimeout(tipHoverTimer); tipHoverTimer = 0; } };
document.addEventListener('mouseover', e => {
    const el = e.target.closest(TIP_SEL);
    if (!el) return;
    cancelTipHover();
    if (tooltipOpen()) { showTooltip(el); return; }
    tipHoverTimer = setTimeout(() => { tipHoverTimer = 0; showTooltip(el); }, TIP_HOVER_MS);
});
document.addEventListener('mouseout', e => {
    if (!e.target.closest(TIP_SEL)) return;
    cancelTipHover();
    hideTooltip();
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
// A claimed day pull is not a tap, and its trailing click must not reach
// the tooltip. The old day handler got that from `preventDefault` on a
// non-passive touchmove; a pointer gesture does not, and on a mouse the
// click is guaranteed — so a pull whose press and release land on the
// same block would open a tooltip on release, which is exactly the
// collision the slop exists to prevent.
//
// One flag, and it lives only in the gap between a claimed release and
// the very next input of any kind: this handler consumes it, and any
// press or key press clears it. No window, no timer, and no way for it
// to still be set when a later tap or an Enter on a focused block comes
// along. The guard sits here rather than on the click itself, because
// the tooltip is the only thing a stray click on the grid does.
let swallowClick = false;
const clearSwallow = () => { swallowClick = false; };
// Recorded on the document rather than on .chart, so it holds for the
// card's left edge as well. That strip overlaps #hourRail, whose origin
// gate in the day-elastic handler returns before the elastic's own record
// is made: a SWIPE starting there is the hour peek's and the card does not
// get it, which is the one place the origin rule does not reach. A TAP
// still works, because this handler sees it either way.
document.addEventListener('pointerdown', e => {
    clearSwallow();
    downInCard = cardOpen() && insideCard(e.clientX, e.clientY);
    // A new gesture starts from an opaque panel; the moves below thin it.
    applyVeil(0);
}, true);
document.addEventListener('keydown', () => { clearSwallow(); downInCard = false; }, true);

// Tap/click toggles the tooltip; the same block or anywhere else
// dismisses. Shared by mouse and touch (touch no longer swallows its
// trailing synthetic click now that the hold gesture is reverted, so
// this single handler is back to covering both).
document.addEventListener('click', e => {
    if (swallowClick) { swallowClick = false; return; }
    // A tap that STARTED inside the open card is the card's, and it
    // expands or collapses the reading. Without this the tap reads
    // straight through to the block underneath — the card takes no
    // events — and closes or re-points the reading instead.
    if (downInCard && cardOpen() && activeBlock) {
        cardExpanded = !cardExpanded;
        refreshActiveTooltip();
        return;
    }
    const el = e.target.closest(TIP_SEL);
    if (el) {
        if (tappedBlock === el) return hideTooltip();
        showTooltip(el);
        tappedBlock = el;
    } else {
        // Also reached by tapping/clicking the open tooltip
        // itself, since it no longer click-through's (see the
        // pointerEvents assignment in showTooltip). e.target is
        // the tooltip or one of its children, which never matches
        // TIP_SEL, so it falls here and closes, same as any other
        // outside tap.
        hideTooltip();
    }
});

// Search is the sheet's second mode. Opening it opens the sheet if it is
// not already up, so ⌘K and the placeholder row land in the same place.
const openSearch = () => {
    if (sheetMode === 'search') { $('searchInput').focus(); return; }
    openSheetChrome();
    // Give the sheet a list to step back to, so leaving search does not
    // land on an empty body when search was what opened the sheet.
    if (!sheet && sheetLive()) {
        const rows = buildSheetRows();
        sheet = {
            via: 'tap',
            rows,
            aim: Math.max(0, rows.length - 1),
            moved: false,
            cache: new Map(),
            live: !reduceMotion()
        };
        renderSheet();
    }
    setSheetMode('search');
    renderSuggestions(''); // saved cities + geolocate, before any typing
    $('searchInput').focus();
};
// The header strip is a readout now, not a control: the city name has
// moved to the control row and search is reached through the sheet, so
// tapping the summary does nothing. Only ⌘K, the sheet's search row and
// the geolocation button open the field.

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
// The sheet has three bodies and shows one at a time: the saved places, the
// search results, and the menu. None of them is a panel of its own. Each is
// a MODE of the same bottom sheet, so every one of them opens under the
// thumb that asked for it rather than at the far end of the screen, and one
// dismissal closes all three.
let sheetMode = 'places';   // 'places' | 'search' | 'settings'
const setSheetMode = m => {
    const entering = m === 'places' && sheetMode !== 'places';
    sheetMode = m;
    // The switch is a thing you hold open over the grid, so it is drawn on
    // the scrim's own translucency and the scrim behind it stands down: you
    // keep seeing the weather you are switching away from. Search and the
    // menu are places you go, so they are opaque with the scrim behind.
    $('citySheet').classList.toggle('switching', m === 'places');
    $('sheetScrim').classList.toggle('clear', m === 'places');
    show($('sheetList'), m === 'places');
    $('searchResults').hidden = m !== 'search';
    $('settings').classList.toggle('hidden', m !== 'settings');
    if (m === 'settings') renderSettings();
    // Coming back INTO the places body from search or the menu, the list is
    // rebuilt from a fresh snapshot. Search is where the lists get reshaped
    // — pinning and unpinning both move cities between tiers — and stepping
    // back used to reuse rows built before any of that, so every data-idx
    // in them addressed a list that no longer existed.
    //
    // It also covers the sheet that was never built: search can be opened
    // with nothing worth listing (⌘K, or a first run), and pinning from
    // there makes the places body worth showing for the first time.
    if (entering && (sheet || sheetLive())) {
        if (!sheet) sheet = { via: 'tap', aim: 0, moved: false, cache: new Map(), live: !reduceMotion() };
        resnapSheet();
        renderSheet();
        pinListToBottom();   // a re-snapped list is read from the bottom too
        return;   // renderSheet does the actions and the aim
    }
    renderActions();
    // The readout is mode-dependent (see paintAim), and callers set the mode
    // AFTER building the sheet, so it has to be repainted here or the control
    // row keeps whatever the previous mode wrote into it.
    if (sheet) paintAim();
};
// Kept as a name because a dozen call sites already say "close the menu"
// and mean it, including Escape and the outside-click guard.
const toggleSettings = open => {
    const willOpen = open ?? sheetMode !== 'settings';
    if (willOpen) setSheetMode('settings');
    else if (sheetMode === 'settings') setSheetMode('places');
};
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

// --- Grid gestures: the elastic day axis --------------------------
// One axis, one meaning. The grid field is the calendar surface, so a
// horizontal drag on it moves the dates, the convention every calendar
// on the phone already teaches. What that drag DOES is what changed.
//
// It used to page: a seven-column window that stepped over sixteen days
// one notch at a time, latched where it was left, and drifted back on a
// four-second timer. Three things were wrong with it and none of them
// were fixable by tuning. A notch is a decision you cannot take back
// half-way. A latched window has a scroll position, so there is
// somewhere to be lost. And a timer takes the screen back while you are
// still reading it.
//
// The elastic has none of them. Pull sideways and the days accordion in
// from the side they sit on, continuously, one-to-one under the finger,
// while the home week squishes to pay for them; today never leaves the
// screen. Let go anywhere short of the end and it was a peek: the grid
// eases home and stops there, and there was never a position to lose.
// It does not overshoot — home is the seam between the two sides, and
// anything past it reveals a day from the end the pull was leaving. At full
// extension the columns freeze and the whole grid slides toward the
// pull instead, its trailing edge clipping into black — and 32px into
// THAT slide, a hairline beside the grid arms. Release while armed and
// the stretch locks open. Release below it and it was still a peek.
//
// Three states, and no fourth: home, stretch, locked. The ⌂ chip exists
// only while locked, because only then is there somewhere to come back
// from.
//
// THE FRAME STILL DOES NOT MOVE, in the sense that mattered: the grid is
// never translated off-screen as a new screen arriving. The carousel
// this resembles from the outside was ruled out on that ground and the
// reason survives — the columns stay in their frame and change width, so
// the week reads as the same grid making room rather than as a page
// turning. The overtravel slide is the one exception, and it is a
// bounded 64px of feedback on a gesture that has run out of days, not a
// way of getting anywhere.
const chart = document.querySelector('.chart');

const viewStepTo = dir => {
    const enabled = enabledViews();
    if (enabled.length < 2) return null;
    const i = enabled.indexOf(view);
    return enabled[(i + dir + enabled.length) % enabled.length];
};
const stepView = dir => {
    const v = viewStepTo(dir);
    if (!v) return;
    // Horizontal wave: the new view enters from the side it sits on, so
    // next (right in the control row) fills right-to-left.
    setView(v, { type: 'wave', axis: 'x', dir: -Math.sign(dir) });
};

// --- The elastic's constants, tuned by hand -----------------------
// A touch is a TAP until it has moved this far. Below it nothing renders
// and nothing is preventDefault-ed, so the touch falls through to the
// browser's trailing synthetic click and tap-to-open-tooltip runs
// untouched. The two paths stay mutually exclusive by construction
// rather than by a race, which is the sharpest constraint on this
// handler and the one thing that must not regress.
const PULL_SLOP = 10;
// Travel per revealed day, in pixels. The past side charges more,
// because the two ends are different lengths: seven days forward, two
// days back. At one price the past end locks by accident on a flick and
// the future end is a haul, so the past's days cost 2.5x and the two
// ends meet at comparable total travel — 284px forward, 212px back.
const PULL_COST = 36;
const PAST_FACTOR = 2.5;
const dayCost = side => side > 0 ? PULL_COST : PULL_COST * PAST_FACTOR;
// The margin past full extension that turns a release from a peek into
// a lock. The same raw PIXELS on both sides: the last inch of intent
// costs the same wherever it is spent. 60 was compared and read as the
// last stretch dragging.
const LOCK_GAP = 32;
// Arming is one threshold and disarming a lower one, so riding the line
// cannot rattle the haptic or the mark.
const LOCK_HYST = 0.6;
const HOME_MS = 230;          // the ease home, monotonic: it arrives and stops
const LOCK_SETTLE_MS = 160;   // an armed release settling onto whole days
// Travel is accumulated in PIXELS and converted per side, so a drag that
// crosses the origin prices each side correctly rather than carrying one
// side's exchange rate into the other.
const rawFromPx = px => px / dayCost(Math.sign(px) || 1);
const pxFromRaw = rw => rw * dayCost(Math.sign(rw) || 1);
// Honesty guard: with nowhere to go on either end there is nothing to
// reveal, so the gesture is suppressed outright rather than arming and
// then doing nothing.
const elasticLive = () => maxFuture() > 0 || maxPast() > 0;

// --- The lock mark ------------------------------------------------
// A hairline BESIDE the grid, never on it: the grid surface is data and
// stays data. It grows and brightens with the overpull, goes solid when
// armed, and stays small and dim while locked — the persistent reminder
// of which edge is being held, and where to pull to let go.
let lockArmed = false;
const paintLockMark = () => {
    const mark = $('lockMark');
    if (!mark) return;
    const side = Math.sign(dayOv || dayN) || 1;
    const held = dayMode === 'locked' && !pull && dayOv === 0;
    mark.className = 'lock-mark' + (side > 0 ? ' right' : ' left')
        + (lockArmed ? ' armed' : '') + (held ? ' held' : '');
    if (held) { mark.style.opacity = ''; mark.style.height = ''; return; }
    const p = Math.min(1, Math.abs(dayOv) / LOCK_GAP);
    mark.style.opacity = p <= 0 ? '0' : (0.3 + 0.7 * p).toFixed(2);
    mark.style.height = (12 + 56 * p).toFixed(1) + '%';
};
const setArmed = on => {
    if (on === lockArmed) return;
    lockArmed = on;
    // One tick, on arming only. The mark is the sight and this is the
    // touch of the same threshold; disarming is silent, because taking
    // something back should not feel like doing something.
    if (on) navigator.vibrate?.(8);
    paintLockMark();
};
const updateArmed = () => {
    const a = Math.abs(dayOv);
    if (!lockArmed && a >= LOCK_GAP) setArmed(true);
    else if (lockArmed && a < LOCK_GAP * LOCK_HYST) setArmed(false);
};

// --- The springs --------------------------------------------------
// Two, and both of them MONOTONIC. Neither may pass its destination.
//
// The way home used to overshoot (ease-out-back), on the reasoning that
// an elastic thing which stops dead was never under tension. That
// reasoning is right about elastics and wrong about this one, because of
// where home sits: home is zero, and zero is the seam between the two
// sides of the axis. An overshoot past it gives `dayN` the opposite
// sign, and a signed `dayN` is a REVEAL — so for about eighty
// milliseconds the grid accordions in a day from the end the pull was
// never heading toward, and then takes it away again. A day appears that
// nothing asked for. On a release that has already crossed the origin
// (pull left, carry on right, let go) it happens on the side just left,
// which reads as the same animation playing twice.
//
// So: ease-out-quint, arriving and stopping. The deceleration is the
// settle; it is a long tail and it does read as elastic, but it reads as
// an elastic coming to rest rather than one still moving after it has
// arrived. The lock settle was always monotonic (ease-in-out onto the
// whole-day extent) and is unchanged: it is arriving somewhere.
let elasticAnim = null;
// The wheel's own hold, declared up here because `stopElastic` below has
// to be able to cancel it and is reachable before the wheel handler is
// installed.
let wheelBack = null;
const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const springTo = (tn, tov, ms, ease, done) => {
    if (elasticAnim) cancelFrame(elasticAnim);
    const fromN = dayN, fromOv = dayOv, t0 = performance.now();
    // Reduced motion takes the destination directly. There is nothing
    // here to slow down: the movement IS the feedback, and a user who
    // has asked for none wants the answer, not a shorter animation.
    if (reduceMotion()) {
        elasticAnim = null;
        dayN = tn; dayOv = tov; applyDayWidths();
        settleFields();
        if (done) done();
        return;
    }
    const step = now => {
        const t = Math.min(1, (now - t0) / ms);
        dayN = fromN + (tn - fromN) * ease(t);
        dayOv = fromOv + (tov - fromOv) * ease(t);
        applyDayWidths();
        if (t < 1) { elasticAnim = scheduleFrame(step); return; }
        elasticAnim = null;
        dayN = tn; dayOv = tov;
        applyDayWidths();
        // Geometry first, then whatever the caller wanted to do about
        // having arrived: a rebuild replaces the blocks, so anything
        // armed on the old ones would be armed on nodes that are gone.
        settleFields();
        if (done) done();
    };
    elasticAnim = scheduleFrame(step);
};

// Whatever is in flight, stopped where it is. Anything that takes the
// axis calls this first, so two things are never writing `dayN` at
// once — the failure that reads as the grid moving under a finger that
// is holding still.
const stopElastic = () => {
    if (elasticAnim) { cancelFrame(elasticAnim); elasticAnim = null; }
    clearTimeout(wheelBack);
    wheelBack = null;
};
// The wheel's hold, in one place, because both its callers have to leave
// `wheelBack` honest: it is read as "a peek is being held" and a timer id
// that has already fired still reads as true.
const holdWheelBack = () => {
    clearTimeout(wheelBack);
    wheelBack = setTimeout(() => { wheelBack = null; elasticHome(); }, WHEEL_HOLD_MS);
};

// Home is home whichever of the three states it is leaving, and it is
// the only destination any way out has.
//
// Already home and already still is not a journey, and starting one
// anyway is how a second ease came to play over a grid that had finished
// moving: the ways home overlap (a release, then an Escape; a tap in
// dead space landing on a stretch that has just settled), and each of
// them used to schedule its own. Nothing to travel, nothing scheduled.
const elasticHome = () => {
    if (dayMode === 'home' && !dayN && !dayOv && !elasticAnim && !wheelBack) return;
    stopElastic();
    dayMode = 'home';
    setArmed(false);
    // A frame of the spring never rebuilds the grid. The settle may, if
    // the block came home to a different size than it was built for, and
    // `springTo` does that before it calls back — so by here the blocks
    // are final either way and there is nothing to wait for.
    springTo(0, 0, HOME_MS, easeOutQuint, () => { armArrival(); flushArrival(); });
};
// Straight back to rest: no spring, no decision, nothing kept.
const resetElastic = () => {
    stopElastic();
    dayN = 0; dayOv = 0; dayMode = 'home';
    lockArmed = false;
    applyDayWidths();
    settleFields();
};

// What a view or city change does to the axis. A LOCKED stretch is
// carried across: it is a decision the user made and can see, and the
// two things it is for — the same nine days in another view, the same
// nine days in another city — are exactly the switches that used to drop
// it. Anything else (a finger still down, a spring still flying, a wheel
// peek still held) is not a decision and goes home with the repaint.
//
// The new grid may not reach as far as the old one did. That is settled
// by `reconcileElastic` once the data is actually in hand, not here:
// a city change clears state.data before it fetches, so every reach is
// zero at this moment and clamping now would close every lock.
const carryElastic = () => {
    stopElastic();
    lockArmed = false;
    dayOv = 0;
    if (dayMode !== 'locked') { dayN = 0; dayMode = 'home'; }
    applyDayWidths();
};

// A lock is held in DAYS FROM TODAY, so it survives a repaint by
// meaning the same distance rather than the same column. What it cannot
// survive is a payload that does not reach that far: the new city may be
// shorter, or a cached one may be stale. Clamped to what the data
// actually has, and released outright when that end has nothing behind
// it at all — a ⌂ over a grid identical to home is a lock on nothing.
const reconcileElastic = () => {
    if (dayMode !== 'locked' || pull) return;
    const side = Math.sign(dayN) || 1;
    const cap = reachOn(side);
    if (!cap) { resetElastic(); return; }
    if (Math.abs(dayN) > cap) { dayN = side * cap; dayOv = 0; }
};

// One whole day either way, for the keyboard. It holds where it is put
// rather than springing: there is no hand to take away, so there is no
// release to read as "that was a peek".
const nudgeElastic = dir => {
    stopElastic();
    const next = Math.max(-maxPast(), Math.min(maxFuture(), Math.round(dayN) + dir));
    if (next === dayN && !dayOv) return;
    dayN = next; dayOv = 0;
    dayMode = next ? (dayMode === 'locked' ? 'locked' : 'stretch') : 'home';
    if (next) retireHint('days');
    applyDayWidths();
    // The keyboard holds where it is put rather than springing, so this
    // IS the settle: there is no spring to finish and re-bake later.
    settleFields();
};

// --- The gesture ---------------------------------------------------
// Pointer events, so one path covers finger, mouse and stylus, and
// pointer capture routes every move and the release back here whatever
// a repaint did to the DOM underneath.
let pull = null;   // { x, y, id, axis, slop, basePx, wasLocked }

chart.addEventListener('pointerdown', e => {
    if (pull || !e.isPrimary) return;
    // Origin gate: a drag that starts on the hour rail belongs to the
    // hour peek. The rail sits inside .chart, so its events bubble here.
    if (e.target.closest?.('.rail')) return;
    swallowClick = false;
    pull = {
        x: e.clientX, y: e.clientY, id: e.pointerId, axis: null,
        // A pull continues from wherever the axis actually STANDS, not
        // from home. For a locked stretch that is the point: "the same
        // pull again" is the same travel from here as it was from home.
        // For a stretch still easing home it matters just as much, and
        // it used to be zero — so a finger that landed mid-ease and then
        // dragged the other way snapped the grid shut on its first
        // moved pixel and re-opened it from nothing, which is the second
        // animation in what should be one continuous gesture.
        basePx: pxFromRaw(dayN),
        wasLocked: dayMode === 'locked',
        // What the press interrupted, so a press that turns out not to
        // be a pull can put it back rather than leave the axis parked
        // wherever the finger happened to land on it.
        wasAnimating: !!elasticAnim,
        heldWheel: !!wheelBack
    };
    // The hand takes the axis: whatever spring or wheel hold was still
    // running stops where it is, and the pull is anchored to what is
    // actually on screen rather than to where it was heading.
    stopElastic();
});
// A press that turns out not to be a pull — a tap, or a vertical drag
// the page takes — hands the axis back exactly as it found it.
const restPull = p => {
    if (p.heldWheel) { holdWheelBack(); return; }
    if (!p.wasAnimating) return;   // nothing was in flight; nothing to resume
    if (dayMode === 'locked') {
        const side = Math.sign(dayN) || 1, cap = reachOn(side);
        if (Math.abs(dayN) !== cap || dayOv) springTo(side * cap, 0, LOCK_SETTLE_MS, easeInOut);
    } else if (dayN || dayOv) elasticHome();
};

chart.addEventListener('pointermove', e => {
    if (!pull || e.pointerId !== pull.id) return;
    const dx = e.clientX - pull.x, dy = e.clientY - pull.y;
    // The panel thins as the gesture comes near it, and as the elastic
    // travels. Computed one frame before any reposition rather than after
    // one: the card moves only when it flips, which at this threshold is
    // rare, and a rect read per repositioned frame is a forced layout in
    // the middle of a gesture.
    applyVeil(veilFor(e.clientX, e.clientY));
    if (!pull.axis) {
        if (Math.hypot(dx, dy) < PULL_SLOP) return;
        // A swipe that began inside the card's rectangle is the card's, and
        // up or sideways closes the reading the way a notification does.
        // Down is not a dismiss direction, so it falls through.
        //
        // PULL_SLOP, not a bigger number: the elastic claims at 10, so a
        // swipe that has to win against it cannot ask for more travel than
        // it does. One slop, one arbiter.
        //
        // The counter for it is a real cost, and it is this: a sideways
        // swipe starting inside the card is a pull the grid does not get.
        // The two rows the card covers trade the day elastic for the
        // dismissal.
        if (downInCard && cardOpen()) {
            const up = dy < -PULL_SLOP && Math.abs(dy) > Math.abs(dx);
            const side = Math.abs(dx) > PULL_SLOP && Math.abs(dx) >= Math.abs(dy);
            if (up || side) {
                e.preventDefault();
                // The trailing click must not land on the block under the
                // card and re-open a reading the swipe just closed.
                swallowClick = true;
                restPull(pull); pull = null;
                hideTooltip();
                return;
            }
        }
        pull.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        // Vertical belongs to nobody here. Let go of the pointer rather
        // than claim it, so the page behaves as any page would — and
        // give the axis back the movement the press interrupted, or a
        // finger that lands mid-ease and then scrolls the page would
        // leave the days parked where it caught them, with no ⌂ and no
        // way back.
        if (pull.axis !== 'x' || !elasticLive()) { restPull(pull); pull = null; return; }
        chart.setPointerCapture?.(e.pointerId);
        // Where the pull was claimed, frozen once. Every later frame
        // measures travel from HERE, so the slop is spent exactly once at
        // the start of the gesture and is never re-applied.
        pull.slop = dx;
        // When, for the same reason: a flick and a drag differ only in how
        // long the finger stays down, and this is the moment the clock
        // starts. The press before it may have been a tap deciding not to
        // be one, which is not part of the gesture.
        pull.t0 = performance.now();
        if (dayMode !== 'locked') dayMode = 'stretch';
        // Deliberately NOT closing an open tooltip: it survives the pull
        // and keeps reading the same block, which is what makes it the
        // comparison tool.
    }
    e.preventDefault();
    // Pull left and future days accordion in from the right: the motion
    // and the meaning share a side, which is the whole logic of it. The
    // slop is subtracted rather than ignored, so the grid does not jump
    // by the threshold at the moment the pull is claimed.
    //
    // Subtracted as a FIXED origin, not as `sign(dx) * PULL_SLOP`. That
    // form flips with the finger, so a drag that goes out one way and
    // comes back through its own starting point moved the origin 20px in
    // one frame — the grid jumped a day and a half sideways at the exact
    // moment the pull crossed from one side of the axis to the other,
    // which is the one place a continuous gesture must be continuous.
    // Peeking forward and then back in a single motion crosses it every
    // time.
    const travel = -(dx - pull.slop);
    pull.travel = travel;
    const raw = rawFromPx(pull.basePx + travel);
    const side = Math.sign(raw) || 1, cap = reachOn(side);
    // An end with no days behind it does not stretch and does not arm.
    // A rubber band there would offer a lock on nothing: the release
    // would latch a stretch of zero days, ⌂ and all, over a grid
    // identical to home.
    if (!cap) { dayN = 0; dayOv = 0; }
    else if (Math.abs(raw) <= cap) { dayN = raw; dayOv = 0; }
    else { dayN = side * cap; dayOv = side * (Math.abs(raw) - cap) * dayCost(side); }
    applyDayWidths();
    updateArmed();
    // The gesture has been used, so its hint has done its job. Only a
    // pull away from rest counts: the way home is not a discovery.
    if (dayN) retireHint('days');
});

// The release is the decision, and there are only two of them: this was
// a peek, or this was a lock.
const endPull = e => {
    // The hand is off the glass, so the panel eases back to opaque. Ahead
    // of the early return, because a press that never became a pull still
    // thinned the card by being near it.
    applyVeil(0);
    if (!pull || (e && e.pointerId !== pull.id)) return;
    const p = pull;
    pull = null;
    if (chart.hasPointerCapture?.(e?.pointerId)) chart.releasePointerCapture(e.pointerId);
    // A tap. The trailing click opens the tooltip, and nothing here
    // navigates — but the press stopped whatever was in flight when the
    // finger landed, so it is set going again toward where it was headed.
    if (p.axis !== 'x') { restPull(p); return; }
    // A claimed pull is not a tap, whatever it lands on.
    swallowClick = true;
    const side = Math.sign(dayOv || dayN) || 1;
    const cap = reachOn(side);
    if (p.wasLocked) {
        // Three ways out of locked, all of them home. The same pull
        // again to the same threshold — same mark, same single buzz.
        if (lockArmed) { elasticHome(); return; }
        // A clear pull back toward home is the second.
        if (Math.abs(dayN) < cap - 0.5) { elasticHome(); return; }
        // Anything less is a wiggle, and the lock holds.
        setArmed(false);
        springTo(side * cap, 0, LOCK_SETTLE_MS, easeInOut);
        return;
    }
    if (lockArmed) {
        dayMode = 'locked';
        setArmed(false);
        springTo(side * cap, 0, LOCK_SETTLE_MS, easeInOut);
        // The gesture has been used to its end. Nothing left to explain.
        retireFlickSay();
        return;
    }
    setArmed(false);
    // A peek that was over almost before it began was a flick: thrown at
    // the grid the way a calendar is paged, and answered with a twitch,
    // because this axis has no momentum in it to catch. Say what it wants
    // instead, once the days are already on their way back.
    if (performance.now() - p.t0 < FLICK_MS && Math.abs(p.travel || 0) >= FLICK_PX) sayFlick();
    elasticHome();
};
// On the window, not the chart. Capture is only taken once the axis is
// claimed, so a press that never travels far enough releases wherever
// the finger happens to be — and if that is off the chart, a listener
// bound to the chart never hears it and `pull` is left set for the rest
// of the session, with every later pull refused.
addEventListener('pointerup', endPull);
addEventListener('pointercancel', endPull);

// The key follows the hand. A finger on the grid is the moment the question
// "what does this colour mean" is actually being asked, so that is when the
// caption slot hands itself over. Hover is the same signal for a pointer,
// which is all a desktop has: without it the key would never appear there.
chart.addEventListener('touchstart', () => holdLegend(true), { passive: true });
chart.addEventListener('touchend', () => holdLegend(false));
chart.addEventListener('touchcancel', () => holdLegend(false));
chart.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') holdLegend(true); });
chart.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') holdLegend(false); });

// A horizontal wheel over the grid holds a peek open. It is the one
// input with no release to decide on, so it cannot lock and it cannot
// latch: the stretch it opens settles back a beat after the wheel stops,
// which is the same "let go and it eases home" the finger gets, driven by
// the only thing a wheel has that resembles letting go.
//
// Claimed only when the horizontal component dominates, so an ordinary
// vertical scroll over the grid is left to the page.
let wheelAcc = 0, wheelAt = 0;
chart.addEventListener('wheel', e => {
    if (!elasticLive() || dayMode === 'locked') return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt > WHEEL_GAP_MS) wheelAcc = 0;
    wheelAt = now;
    wheelAcc += e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (Math.abs(wheelAcc) < WHEEL_STEP) return;
    // A wheel is scrolling, not direct manipulation, so the viewport
    // follows the wheel rather than the content following the hand.
    const dir = Math.sign(wheelAcc);
    wheelAcc = 0;
    stopElastic();
    dayMode = 'stretch';
    dayN = Math.max(-maxPast(), Math.min(maxFuture(), dayN + dir));
    dayOv = 0;
    if (dayN) retireHint('days');
    applyDayWidths();
    holdWheelBack();
}, { passive: false });

// --- The city sheet ----------------------------------------------
// The city name IS the switcher: there is no second city control on the
// screen. Two ways in, one list.
//
//   Swipe up from the control row  the sheet opens under the finger and
//                                  tracks it; releasing takes whichever
//                                  city is under the finger.
//   Tap the city name              the same sheet, staying open until a
//                                  row is tapped or it is dismissed.
//
// The grid previews the aimed city while the finger is still down, at
// its true colours, because comparing two cities during the gesture is
// the thing this replaces and a preview that withholds the colours until
// release would not serve it. Nothing dims.
// Travel on one axis before the touch is a swipe rather than a press. This is
// now the ONLY thing that separates the two gestures on the row, so it has to
// be a distance a tap does not reach by accident: 12 was under every platform's
// own tap slop (Android's ViewConfiguration is 8dp, which is 16-24 CSS px on a
// real phone; iOS allows about 10pt), and the thumb roll that every tap on a
// 52px target has in it was clearing it. 24 is past the roll and still a short
// flick — under half the height of one row in the sheet, so the switcher is
// open well before the finger has anywhere to aim.
const SHEET_ARM_PX = 24;
// Sideways travel that commits a view step. Larger than the arming slop, so
// a drag that wandered off the vertical axis and came back does not also
// change the view on the way out.
const VIEW_COMMIT_PX = 45;
const VIBE_DETENT = [2];        // one 2ms tick per new aim; Android only
// Clamped, not wrapped: the first and last entry are hard stops.
const cityClamp = i => Math.max(0, Math.min(sheetRows().length - 1, i));

// --- What the switcher lists, and in what order -------------------------
//
// The switcher used to list ★ favourites and nothing else, sorted by
// recency with the current city forced to the bottom. That produced one
// good property — the swap was always one row — by giving up two others,
// and it could not serve the case it most needed to.
//
// The case: you land somewhere, look the place up, and want to flick
// between it and home for a couple of days. A searched city goes into
// recents, recents are not in the switcher, so the only route back was
// through search again, every time. The workaround on offer was ★, which
// is a permanent capped list you then have to remember to clean up. That
// is a filing decision demanded in exchange for a glance.
//
// So the list has TIERS instead, and each one buys a property the single
// sorted list could not hold at the same time as the others. Bottom-up,
// because the finger enters from the bottom and cheapness is measured
// from there:
//
//   current      always the bottom row, whether or not it is pinned. The
//                aim opens here, so a release that never moved is a no-op
//                by construction rather than by luck.
//   back         the city the last switch came from. One row, always, so
//                the swap costs one row whichever two cities it is
//                between — the property the old sort existed to produce.
//                Drawn only when that city is NOT pinned: when it is, it
//                keeps its place in the block above and nothing is
//                duplicated. See "What this gives up".
//   pinned       your mains, in your own order, and they do not move.
//                Muscle memory, which the old list explicitly could not
//                offer. Reversed so the FIRST city you pin sits nearest
//                the thumb: the first pin is almost always home.
//   transient    the cities you looked up. Filled automatically, MRU,
//                capped at MAX_TRANSIENT, and aged out after
//                TRANSIENT_TTL_MS. Nothing to add, nothing to clean up.
//
// Read top to bottom the single gradient is commitment: things you have
// not committed to are furthest away, and browsing is what justifies the
// travel. Read bottom-up it is cost: the two rows you actually swap
// between are the two cheapest rows on the screen.
//
// What this gives up. When the previous city IS pinned there is no back
// row, so that one swap costs however far up the pinned block it sits.
// The alternative was drawing it twice, or pulling it out of the block —
// and both of those spend the pinned block's stability, which is the
// whole reason the tier exists. Owner-directed, and the honest reading is
// that a pinned city is one you already know the position of.
const TIER_TRANSIENT = 'recent', TIER_PINNED = 'pinned',
      TIER_BACK = 'back', TIER_HERE = 'here';

const buildSheetRows = () => {
    const here = placeKey(state.place);
    const pinnedKeys = new Set(favorites.map(placeKey));
    // The city the last switch came from, which is an MRU-POSITION fact:
    // `rememberCity` stamps the arriving city at the head, so the previous
    // city is the first entry that is not the current one. Deliberately not
    // read off `seenAt` — `unpinCity` stamps a fresh time without anyone
    // having gone anywhere, and reading the timestamp here would put a city
    // you just unpinned into the slot reserved for the one you came from.
    const prev = savedCities.find(c => placeKey(c) !== here) || null;
    const back = prev && !pinnedKeys.has(placeKey(prev)) ? prev : null;

    // One city, one row. Claimed bottom-up, so the cheaper tier wins any
    // city two tiers could both show.
    const taken = new Set([here]);
    if (back) taken.add(placeKey(back));
    const pinned = [...favorites].reverse().filter(p => !taken.has(placeKey(p)));
    pinned.forEach(p => taken.add(placeKey(p)));

    // The transient tier is a RECENCY fact, so it is ordered by `seenAt` and
    // not by position in the MRU. The two agree for ordinary visits, and
    // differ for exactly the case the tier exists to catch: `unpinCity`
    // appends to the far end of the MRU on purpose (so the demoted city
    // cannot be mistaken for the one you came from) while stamping it as
    // seen now. Slicing by position dropped it on the floor whenever three
    // fresher recents already existed, which is the opposite of the
    // demotion the button promises.
    //
    // It is also the tier that gives way when the sheet is full. Everything
    // else in the list has a claim: `here` is where you are, `back` is the
    // swap the gesture exists for, and a pinned city was chosen and counted
    // against a cap the interface states out loud. A transient row is a place
    // you passed through that is going to expire by itself anyway, so when
    // there is no room it simply does not draw, oldest first. See
    // MAX_SHEET_ROWS for why the total is what it is.
    const room = Math.max(0, Math.min(
        MAX_TRANSIENT,
        MAX_SHEET_ROWS - pinned.length - (back ? 1 : 0) - 1
    ));
    const fresh = Date.now() - TRANSIENT_TTL_MS;
    const transient = savedCities
        .filter(c => !taken.has(placeKey(c)) && (c.seenAt || 0) >= fresh)
        .sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0))
        .slice(0, room)
        .reverse();   // newest-first above; the list runs oldest at the top

    const rows = [
        ...transient.map(place => ({ place, tier: TIER_TRANSIENT })),
        ...pinned.map(place => ({ place, tier: TIER_PINNED })),
        ...(back ? [{ place: back, tier: TIER_BACK }] : []),
        { place: state.place, tier: TIER_HERE }
    ];
    // The seam is drawn by the row BELOW it, so it costs no element and no
    // geometry: a separator row would be a dead zone the aim falls into,
    // and a margin would be a smaller one. `renderSheet` turns this into an
    // inset hairline, which is a paint and nothing else.
    //
    // It follows the GROUP rather than the tier, and the two differ in one
    // place: `back` and `here` are one group. They are the swap — the two
    // rows the gesture exists to move between — and a line drawn between
    // them would separate the only pair on the screen that belongs
    // together. Everything above the seam is somewhere you might go;
    // everything below it is the flick.
    const group = r => r.tier === TIER_BACK || r.tier === TIER_HERE ? 'anchor' : r.tier;
    rows.forEach((r, i) => { r.seam = i > 0 && group(rows[i - 1]) !== group(r); });
    return rows;
};

// While a sheet is open the rows are FROZEN, and that is a correctness
// rule rather than an optimisation. Every `data-idx` in `#sheetList` is an
// index into this list, so anything that recomputes it mid-opening can
// hand back a different list than the DOM was built from and every index
// silently means something else.
//
// It is reachable: search is a MODE of the same sheet, pinning and
// unpinning from it reshape both lists, and stepping back to the places
// body did not rebuild the rows. Pin a city, press Escape, tap the row
// that says Auckland, and you got whatever now occupied that index.
//
// So the rows are snapshotted when the sheet opens and re-snapshotted
// exactly where the DOM is rebuilt with them — `setSheetMode('places')`,
// which is the one door back into the list from either other mode.
let sheet = null;   // { via, aim, rows, cache, live, aligned }
const sheetRows = () => sheet?.rows || buildSheetRows();
// Every index in the sheet is an index into this, so the two must stay
// derived from one another rather than computed twice.
const sheetPlaces = () => sheetRows().map(r => r.place);
// The current city is always a row, so two rows means one other city to
// go to. The hint, the arm gate and the arrow keys all read this, and all
// three used to go quiet for someone who had never starred anything.
// Asked with a sheet open it reads the frozen rows, which is what every
// index in that sheet already means.
const sheetLive = () => sheetRows().length >= 2;
// Take a fresh snapshot and keep the aim on the same CITY across it, so a
// list that reshaped while you were in search does not leave the aim
// pointing at whatever moved into that index.
const resnapSheet = () => {
    if (!sheet) return;
    const was = sheet.rows?.[sheet.aim]?.place;
    sheet.rows = buildSheetRows();
    sheet.cache.clear();
    const i = was ? sheet.rows.findIndex(r => placeKey(r.place) === placeKey(was)) : -1;
    sheet.aim = i >= 0 ? i : Math.max(0, sheet.rows.length - 1);
    // The indices are new, so the old one no longer names the grid on
    // screen. The aim is where the grid is: it did not move, the list did.
    sheet.swept = sheet.aim;
};

// The destination grid for a PLACE, fitted to the live frame and cached
// per opening. Keyed by the PLACE, not the row index: the rows are frozen
// while a sheet is open but a re-snapshot can renumber them, and a cache
// keyed by position would then answer with another city's grid.
const previewCols = (pl, sh = sheet) => {
    if (!pl || !sh) return null;
    const key = placeKey(pl);
    if (sh.cache.has(key)) return sh.cache.get(key);
    const raw = colsForPlace(pl);
    // No cached forecast for that city yet. Preview NOTHING rather than
    // sweeping the grid to black: black is the app's "absent", and a grid
    // that goes blank under the finger reads as the preview having failed
    // rather than as the data not being here yet. The commit still
    // fetches, and the status line says so.
    if (!raw) { sh.cache.set(key, null); return null; }
    const built = fitCols(raw, refCols());
    sh.cache.set(key, built);
    return built;
};
const sheetColsFor = (idx, sh = sheet) => previewCols((sh?.rows || sheetRows())[idx]?.place, sh);

// --- The reading on each row -------------------------------------------
// A weather app's city switcher listed names and nothing else, so
// comparing cities was strictly SERIAL: preview one, hold it in your head,
// preview the next. The reader was the register file.
//
// A number on every row makes the list itself the comparison, and demotes
// the live grid preview to what it should always have been — confirmation
// of a decision already made rather than the mechanism for making it.
//
// It is the ACTIVE view's value, so the switcher answers the question you
// are already asking: chance in rain, temperature in temp, speed in wind.
// That is the control row's own convention, where each view button
// already prints its own current reading, applied one level out.
//
// A city with no cached forecast reads BLANK, never a guess and never a
// zero. Same honesty rule as the preview, where an uncached
// city sweeps to black rather than to invented colours: the app
// has one way of saying "not here yet" and it is to say nothing.
const placeReading = place => withPlaceState(place, () => {
    const h = nowHour();
    return h ? viewReading(h, view) : null;
});

// --- The comparison line in the tooltip ---------------------------------
// The app already keeps an open tooltip alive across a city switch and
// re-targets the same grid position, and that has been called "the
// comparison tool" ever since. Nothing on screen has ever said so, and
// nothing about it read as a comparison: you got one city's numbers, then
// the other city's numbers in the same box, and holding the first set in
// your head was still your job.
//
// So while a preview is aimed, the open tooltip prints BOTH — same hour,
// same date, two cities, in numbers rather than in colours. That is the
// honest A/B the whole gesture is for, and it needs no new surface: it is
// drawn exactly where the reader was already looking.
//
// Matched on the date STRING, not on the column index. Two cities can put
// today at different indices — one a day ahead across the date line, one
// with fewer past days cached — and comparing column 3 to column 3 would
// then be comparing two different days while claiming to compare one hour.
const sheetCompareLine = (date, h) => {
    if (!sheet || sheetMode !== 'places') return '';
    const aimed = sheetPlaces()[sheet.aim];
    if (!aimed || placeKey(aimed) === placeKey(state.place)) return '';
    const mine = viewReading(h, view);
    const theirs = withPlaceState(aimed, () => {
        const di = state.days.findIndex(d => d.date === date);
        const hh = di >= 0 ? state.data[di]?.find(x => x.hour === h.hour) : null;
        return hh ? viewReading(hh, view) : null;
    });
    // Either side missing is not a comparison. Say nothing rather than
    // print one number under a heading that promises two.
    if (mine == null || theirs == null) return '';
    return `<div class="tip-ctx tip-compare">`
        + `<span>${esc(state.place.name)} ${esc(mine)}</span>`
        + `<span class="tc-vs">→</span>`
        + `<span class="tc-there">${esc(aimed.name)} ${esc(theirs)}</span>`
        + `</div>`;
};

// What the mark slot on the right of a row says. The two anchor rows name
// themselves, because which is which is the whole point of the bottom of
// the list; the tiers above are named on their FIRST row only, beside the
// seam, so the label sits on the boundary it explains rather than
// repeating down the block.
const rowMark = (r, first) =>
    r.tier === TIER_HERE ? 'now'
  : r.tier === TIER_BACK ? 'back'
  : first ? r.tier : '';

// Built once, when the sheet opens.
const renderSheet = () => {
    if (!sheet) return;
    const rows = sheetRows().map((r, i, all) => {
        const first = i === 0 || all[i - 1].tier !== r.tier;
        const mark = rowMark(r, first);
        const val = placeReading(r.place);
        // The slot is drawn whether or not it has a value, so a city with
        // no cache does not shunt the name beside it out of line with the
        // rest of the list. Aria takes the value with the name, in that
        // order whatever the row's own order is: a screen reader is reading
        // the same comparison, and the name is what identifies the row.
        return `<div class="sheet-row tier-${r.tier}${r.tier === TIER_HERE ? ' current' : ''}${r.seam ? ' seam' : ''}"`
            + ` id="sheetRow${i}" role="option" tabindex="-1" aria-selected="false" data-idx="${i}"`
            + ` aria-label="${esc(r.place.name)}${val ? `, ${esc(val)}` : ''}">`
            + `<span class="sr-val">${val ? esc(val) : ''}</span>`
            + `<span class="sr-name">${esc(r.place.name)}</span>`
            + (mark ? `<span class="sr-mark">${esc(mark)}</span>` : '')
            + `</div>`;
    });
    $('sheetList').innerHTML = rows.join('');
    renderActions();
    paintAim();
};

// The action row. The wide slot on the left says which mode the sheet is in;
// the button on the right is the mode it is not. In search the wide slot IS
// the field, in the same place the placeholder was, so tapping the
// placeholder turns it into a live input without anything moving.
//
// The row lives outside all three bodies, because a body is exactly what
// each mode replaces, and a row that vanished with one could not bring you
// back out of it.
const renderActions = () => {
    const si = sheetPlaces().length;
    const wide = $('sheetWide'), mode = $('sheetMode');
    const searching = sheetMode === 'search';
    $('searchContainer').hidden = !searching;
    wide.hidden = searching;
    if (!searching) {
        const menu = sheetMode === 'settings';
        wide.className = `sheet-row sheet-action${menu ? ' sheet-here' : ''}`;
        wide.dataset.idx = si;
        wide.innerHTML = menu
            ? `<span class="sr-glyph">${SHEET_ICON.gear}</span><span class="sr-name">Settings</span>`
            : `<span class="sr-glyph">${SHEET_ICON.search}</span><span class="sr-name">Search for a city…</span>`;
    }
    // The button always offers the other half of the sheet: the menu from
    // the places and the search, and the search from the menu.
    const toMenu = sheetMode !== 'settings';
    mode.dataset.idx = si + 1;
    mode.setAttribute('aria-label', toMenu ? 'Settings' : 'Search for a city');
    mode.innerHTML = `<span class="sr-glyph">${toMenu ? SHEET_ICON.gear : SHEET_ICON.search}</span>`;
};

// Repainted on every aim change, and it must NOT rebuild the list. A
// click only fires when mousedown and mouseup land on the same element,
// and a hover or a drag changes the aim between the two: rewriting the
// rows there swaps that element out, the browser retargets the click to
// the container, and every click on a row is silently swallowed. Same
// class of bug as re-rendering under a drag, which is why the app already
// forbids it elsewhere.
// The row the highlight is currently on, so moving it is two writes
// rather than a walk of every row in the sheet. A fast drag crosses a row
// every few frames and this is on the hot path; the list is also the one
// thing that must not be rebuilt under a finger, so the node is looked up
// by id and never re-created.
let aimRow = null;
const paintAim = () => {
    if (!sheet) return;
    // A re-render of the list (a mode change, a re-snapshot) replaces the
    // node this was holding, and a detached node's classes mean nothing.
    if (aimRow && !aimRow.isConnected) aimRow = null;
    const next = $('citySheet').querySelector(`.sheet-row[data-idx="${sheet.aim}"]`);
    if (next !== aimRow) {
        if (aimRow) { aimRow.classList.remove('aim'); aimRow.setAttribute('aria-selected', 'false'); }
        if (next) { next.classList.add('aim'); next.setAttribute('aria-selected', 'true'); }
        aimRow = next;
    }
    const n = sheetPlaces().length;
    // Only a place is an option in the listbox; the two actions sit outside
    // it, so pointing the descendant at one of them would name a node the
    // listbox does not own.
    $('sheetList').setAttribute('aria-activedescendant', sheet.aim < n ? `sheetRow${sheet.aim}` : '');
    // The name in the control row is the destination readout; the counter
    // says where that sits in the list. Both revert on close.
    //
    // Only the PLACES list has a destination. Search and the menu keep a sheet
    // object around purely as the list to step back out to, and its aim is the
    // bottom row by default — which is the current city only when the current
    // city is a favourite. Look at somewhere unstarred, open search, and the
    // control row relabelled itself with an unrelated favourite: the city name
    // visibly changed without the city changing, which reads exactly like the
    // switch having fired by mistake.
    const rows = sheetMode === 'places' ? sheetRows() : [];
    const aimedRow = rows[sheet.aim] || null;
    const aimed = aimedRow?.place || null;
    $('locationName').textContent = aimed ? aimed.name : state.place.name;
    // Beside the destination, WHAT it is rather than where it sits. The
    // counter used to read "3/5", which is a position in a list that
    // reorders as you switch: it says how far you have travelled, never
    // what you will land on or what is next to it, and it means something
    // different every time. The tier is the fact you can act on — whether
    // the release lands on a main, on somewhere you were passing through,
    // or on the city you are already standing on, which is the one reading
    // that tells you a release changes nothing.
    $('cityCount').textContent =
        aimedRow ? (aimedRow.tier === TIER_HERE ? 'now' : aimedRow.tier) : '';
    // The readout at the bottom of the held sheet, which sits exactly where
    // the control row's name will be once the sheet goes.
    $('sheetAim').textContent = aimed ? aimed.name : '';
    // Re-run on every aim change: cheap, and it self-corrects if the first
    // measurement caught the sheet mid-appearance.
    alignAimReadout();
};

// --- What an aim change costs, and when ---------------------------------
// Two jobs, and they do not belong in the same frame. Moving the highlight
// is two class writes; previewing the aimed city means BUILDING that
// city's grid — sixteen columns of blocks with their precipitation fields
// — and that is milliseconds, not microseconds.
//
// Both used to run inline in the touchmove handler, so a thumb crossing
// five rows in a tenth of a second built five grids before the highlight
// could paint, and the highlight visibly trailed the finger. The rows the
// finger passed THROUGH were built and thrown away: the only aim worth
// drawing is the one the finger is on when the frame lands.
//
// So the highlight moves now and the preview is coalesced to one frame:
// the latest aim wins, intermediate ones are never built. `swept` is what
// the grid was last pointed at, which is what makes the sweep direction
// the distance actually travelled rather than the last detent crossed.
let aimFrame = null;
const flushAim = () => {
    aimFrame = null;
    if (!sheet) return;
    // An open tooltip carries the comparison line, so it has to be re-read
    // when the aim moves — the same "re-target the same grid position after
    // a repaint" path a city commit already uses. It is safe to run inside
    // the drag for the reason the sheet list is not: #tooltip is a sibling
    // of .chart, so rewriting it cannot detach the element the touch is
    // being dispatched to.
    refreshActiveTooltip();
    // Preview the aimed city on the grid, sweeping the way the list is
    // moving so everything visible moves with the finger. Off under
    // reduced motion, where the sheet is the whole answer.
    if (!sheet.live || reduceMotion()) return;
    const idx = sheet.aim, was = sheet.swept;
    if (idx === was) return;
    sheet.swept = idx;
    const cols = sheetColsFor(idx);
    if (cols) waveTo($('grid'), cols, -(Math.sign(idx - was) || 1), { axis: 'y', hold: true });
};
const queueAim = () => { if (!aimFrame) aimFrame = scheduleFrame(flushAim); };
// `run` is for the paths that end the gesture in the same task the aim
// moved in — a tap on a row sets the aim and closes the sheet without a
// frame in between, and it still gets its sweep.
const cancelAim = (run = false) => {
    if (!aimFrame) return;
    cancelFrame(aimFrame);
    aimFrame = null;
    if (run) flushAim();
};

const setAim = idx => {
    if (!sheet || idx === sheet.aim) return;
    sheet.aim = idx;
    // The aim has been pointed somewhere on purpose. A drag will not commit
    // without this: see closeSheet.
    sheet.moved = true;
    navigator.vibrate?.(VIBE_DETENT);
    paintAim();
    queueAim();
};

// The cities either side of the aim, built while nothing is happening.
// `previewCols` caches per opening, so this is not extra work — it is the
// same work moved off the drag, where it was the thing the highlight was
// waiting behind. Walked outward from the opening aim, because the rows
// nearest where the finger starts are the ones it reaches first, and
// abandoned the moment the sheet it belongs to is gone.
const IDLE = cb => (window.requestIdleCallback || (f => setTimeout(f, 24)))(cb);
const warmSheet = (sh, k = 1) => {
    if (!sh || sheet !== sh || k > sh.rows.length) return;
    IDLE(() => {
        if (sheet !== sh) return;
        // A preview is already queued, so the finger is moving. Warming is
        // the one thing here with no deadline; it waits.
        if (aimFrame) { warmSheet(sh, k); return; }
        for (const i of [sh.aim - k, sh.aim + k]) {
            if (i >= 0 && i < sh.rows.length) previewCols(sh.rows[i].place, sh);
        }
        warmSheet(sh, k + 1);
    });
};

// `via` is how the sheet was reached, tap or drag, and is not the same
// thing as which mode it is showing.
// A scrolling list starts at the top, and this one must not. The list is
// read from the BOTTOM: the current city is the last row, the one you came
// from sits directly above it, and the ordering spends the cheapest travel on
// the likeliest answer. So a list too tall for the sheet has to lose its top,
// which costs the most reach anyway — losing the bottom instead threw away
// `here` and `back`, the two rows the whole gesture is about.
//
// MAX_SHEET_ROWS means this should not trigger. It still can: the pin cap
// only gates ADDING, so anyone who pinned more before the cap came down keeps
// them, and their list is legitimately longer than the sheet.
const pinListToBottom = () => {
    const l = $('sheetList');
    l.scrollTop = l.scrollHeight;   // clamped by the browser to the real max
};

const openSheet = via => {
    openSheetChrome();
    // Nothing to pick between: skip the list and land straight in search,
    // which is the only thing a one-row list could offer anyway. This used
    // to ask about ★ favourites alone, so someone with three recents and
    // no stars was sent to search past a list that had plenty to show.
    if (!sheetLive()) { setSheetMode('search'); renderSuggestions(''); $('searchInput').focus(); return; }
    // The rows are taken once, here, and every index in the sheet from now
    // until it closes is an index into this exact array. See sheetRows.
    const rows = buildSheetRows();
    sheet = {
        via,
        rows,
        // The bottom row, which buildSheetRows makes the current city
        // unconditionally, so the aim starts where the finger is and a
        // release that never moved is a no-op by construction. `moved`
        // keeps it inert anyway: it is the only thing standing between a
        // thumb roll and a city change, and one guard on a gesture that
        // fires by accident is not enough.
        aim: Math.max(0, rows.length - 1),
        // Where the GRID is pointed, which starts as the city on screen and
        // is only moved by a preview that actually ran. See flushAim.
        swept: Math.max(0, rows.length - 1),
        moved: false,
        cache: new Map(),
        live: !reduceMotion()
    };
    setSheetMode('places');
    setGestureMode(via === 'drag');
    renderSheet();
    pinListToBottom();
    // Build the neighbouring cities' grids while nothing is happening, so
    // the first pass over them is a cache hit rather than a stall.
    if (sheet.live) warmSheet(sheet);
    // The one re-measure. renderSheet's alignment ran while the sheet was
    // still rising, so take the reading again once it has landed and let
    // every detent after this reuse it.
    if (via === 'drag') setTimeout(() => { alignAimReadout(true); pinListToBottom(); }, SHEET_EXIT_MS + 20);
    // The list is the listbox, so it is what holds focus while the sheet
    // is open: aria-activedescendant is only read off the focused element.
    if (via === 'tap') $('sheetList').focus({ preventScroll: true });
};

// One exit for every route out: release, tap, scrim, Escape. `commit`
// says whether the aim is taken; the grid is left to settle on whatever
// the preview last showed either way, so the commit itself is invisible.
// --- The on-screen keyboard --------------------------------------------
// A fixed element is positioned against the LAYOUT viewport, and Android
// does not shrink that when the keyboard opens: it shrinks the VISUAL one.
// So a sheet anchored to bottom:0 stays where it was and the keyboard covers
// it, taking the search field and its buttons with it. visualViewport is the
// only thing that reports the difference, so the sheet is offset by it.
//
// `offsetTop` matters as well as `height`: iOS scrolls the visual viewport
// up to reveal a focused field rather than resizing, and without it the
// sheet would be pushed twice as far as it should.
const syncViewport = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const gap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const root = document.documentElement.style;
    // Only a real keyboard moves the sheet. The difference between the two
    // viewports is also non-zero for a retracting URL bar, for overscroll,
    // and for rounding, and offsetting by those produced the small stray gap
    // between the field and the row. A keyboard is never 80px.
    //
    // On a browser that honours interactive-widget=resizes-content this is
    // zero anyway, because innerHeight shrank too: the meta tag does the work
    // and this measures nothing. It is a fallback for the browsers that do
    // not, which is the whole reason it still exists.
    root.setProperty('--kb', gap > 80 ? `${gap}px` : '0px');
    root.setProperty('--vvh', `${Math.round(vv.height)}px`);
};
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);
syncViewport();

// Show and hide the sheet itself, with no opinion about which of its three
// modes is inside. Split out because search can open the sheet on its own
// (⌘K reaches it with no city ever aimed at), and every route out of every
// mode has to leave exactly the same nothing behind.
// How long the sheet takes to leave. Entry is the same figure, spent in
// CSS; only the exit needs the number here, because the markup inside the
// sheet has to survive until the animation has finished with it.
const SHEET_EXIT_MS = 140;
let sheetExitTimer = null;
const openSheetChrome = () => {
    hideSwipeHint();
    // A reopen inside a still-running exit: finish the teardown now, so the
    // sheet is opened onto clean state rather than onto the previous mode's
    // rows with a fade playing over them.
    if (sheetExitTimer) sheetExitTimer();
    const sh = $('citySheet'), sc = $('sheetScrim');
    // Is the sheet ALREADY up? Asked after the exit above has been finished
    // off, so a sheet mid-fade counts as gone rather than as showing.
    //
    // This is the difference between opening the sheet and moving between
    // its modes. The menu button inside the sheet reaches search through
    // openSearch, which comes through here, and the entrance was replayed
    // over a sheet that was already open: `sheetIn` starts at opacity 0, so
    // the sheet and its scrim both blanked for a frame and what showed
    // through was the grid — the app's main screen flashing between two
    // panels that never went anywhere. A mode swap is a change of contents,
    // and the surface holding them does not move.
    const already = !sh.hidden && !sh.classList.contains('sheet-out');
    sc.hidden = false;
    sh.hidden = false;
    if (!already) {
        // Restart the entrance even if one is already on the element:
        // removing the class, forcing the reflow and adding it back is the
        // one reliable way to replay a CSS animation.
        sh.classList.remove('sheet-in');
        sc.classList.remove('sheet-in');
        void sh.offsetHeight;
        sh.classList.add('sheet-in');
        sc.classList.add('sheet-in');
    }
    $('location').classList.add('sheet-open');
    $('location').setAttribute('aria-expanded', 'true');
};
// While the switch is being HELD open, everything that is not the list gets
// out of the way: the control row underneath (which otherwise ghosts its city
// name and its three view words up through the translucency) and the sheet's
// own action row (which the drag cannot aim at anyway). What is left is the
// list and the weather behind it, which is all the gesture is about.
//
// It also fixes the jump. With the action row gone the bottom row of the list
// falls almost exactly where the control row sits, so the name you release on
// is already in the place it will rest.
// Put the readout exactly where the control row's name will be. Measured
// rather than computed, because the distance is the sum of the body's bottom
// padding, the safe-area inset, the row's own margins and its line box, and a
// formula built from those would be four numbers that have to stay true. The
// control row is only at opacity 0, so it still has a box to measure.
// Measured once per gesture, not once per detent. The write-read-write it
// does is a forced synchronous layout, and it used to run on every row the
// finger crossed, which is exactly where a stutter is most visible. The
// correction cannot change mid-gesture anyway: it is the distance between
// two boxes that both stay put for the life of the sheet.
//
// `force` is the one exception. The first measurement can catch the sheet
// mid-entrance, so the entrance schedules one forced re-measure when it
// lands, and that is the last of them.
//
// What the entrance does to the measurement, taken back out of it. The
// sheet rises 14px on the way in, and `getBoundingClientRect` reports that
// transform: measured at the first frame, the readout is 14px lower than
// where it will come to rest, so the correction came out 14px too big and
// the re-measure 160ms later took those 14px away again — the whole list
// settling downward a moment after the switcher opened. Discounting the
// animation makes the first reading the same as the last one, and the
// forced re-measure a confirmation rather than a correction.
const sheetShift = () => {
    const t = getComputedStyle($('citySheet')).transform;
    if (!t || t === 'none') return { x: 0, y: 0 };
    try {
        const m = new DOMMatrixReadOnly(t);
        return { x: m.m41, y: m.m42 };
    } catch { return { x: 0, y: 0 }; }
};
const alignAimReadout = (force = false) => {
    if (!sheet || sheet.via !== 'drag') return;
    if (sheet.aligned && !force) return;
    const pin = $('sheetAim'), name = $('locationName');
    // Zeroed first, then measured, so the reading is never contaminated by a
    // previous gesture's correction. Reading a rect after writing a style
    // forces the reflow, which is what makes this safe to do synchronously;
    // an animation frame was one frame too early and measured the sheet
    // before it had landed.
    pin.style.marginBottom = '0px';
    pin.style.paddingLeft = '0px';
    const a = pin.getBoundingClientRect(), b = name.getBoundingClientRect();
    // Nothing laid out yet: leave `aligned` false so the next aim tries
    // again rather than locking in a measurement that never happened.
    if (!a.height || !b.height) return;
    sheet.aligned = true;
    // Move the BOX, by exactly the gap. It used to move the text INSIDE the
    // box, with bottom padding, on the reasoning that border-box padding eats
    // into the 52px row and a centred line therefore lifts by half of it. That
    // holds for the first 28px — the slack between the 52px row and its 24px
    // line — and then stops dead: `min-height` is a minimum, so past the slack
    // the padding grows the box instead of displacing the line, and the box
    // grows UPWARD because it is the last child of a bottom-anchored sheet.
    //
    // Measured, the gap is 64px, so it applied 128px of padding: 28 of that
    // behaved as designed and lifted 14px, the other 100 grew the box 52 → 152
    // and dragged the line up one-for-one. 114px of lift for a 64px gap. It
    // overshot the control row by 50px AND spent 100px of the list doing it —
    // worse on both counts than leaving it alone would have been. The ×2 only
    // ever described the first 28px, and no single factor describes both.
    //
    // Margin rather than a transform, which would be free: in gesture mode
    // this is the last thing in the sheet and the list above it takes whatever
    // is left, so a transform would slide the readout up over rows that still
    // think they own that space. The margin makes the list give the space up.
    //
    // Both readings are taken where the sheet will REST: the readout is
    // inside it and carries its entrance, the control row's name is not and
    // does not, so the animation would otherwise land entirely in the gap
    // between them.
    const s = sheetShift();
    const dy = (a.top - s.y + a.height / 2) - (b.top + b.height / 2);
    pin.style.marginBottom = dy > 0 ? `${Math.round(dy)}px` : '0px';
    pin.style.paddingLeft = `${Math.max(0, Math.round(b.left - (a.left - s.x)))}px`;
};

const setGestureMode = on => {
    document.querySelector('.container').classList.toggle('switching', on);
    $('citySheet').classList.toggle('gesture', on);
};
// Two halves, and the split is the point. Everything a caller may read on
// the very next line (the mode, the highlight, focus, the control row) is
// reset synchronously, exactly as before. Only the MARKUP waits: the rows
// stay in the sheet until the exit animation has finished with them, so the
// sheet leaves holding what it was showing instead of collapsing to an
// empty black box for the length of the fade.
const hideSheetChrome = () => {
    // The control row comes back at once. It has its own 140ms fade, so it
    // arrives underneath the sheet as the sheet leaves — the opening's
    // handover, run backwards.
    //
    // The sheet's OWN gesture class stays on, where it used to come off here
    // as the other half of one `setGestureMode(false)`. `.city-sheet.gesture`
    // is what takes the action row off screen for the length of a drag, so
    // dropping it here put that row back for the 140ms the sheet then spent
    // fading out: the search field appearing at the moment the switcher was
    // dismissed, in a mode the sheet had never been in. It comes off in
    // `wipe` instead, once the sheet is hidden and there is nothing left for
    // it to reveal.
    document.querySelector('.container').classList.remove('switching');
    const sh = $('citySheet'), sc = $('sheetScrim');
    $('sheetList').setAttribute('aria-activedescendant', '');
    if (sh.contains(document.activeElement)) $('location').focus({ preventScroll: true });
    $('searchInput').value = '';
    searchHighlight = -1;
    sheetMode = 'places';
    $('location').classList.remove('sheet-open');
    $('location').setAttribute('aria-expanded', 'false');
    $('cityCount').textContent = '';
    renderLocation();

    const wipe = () => {
        sheetExitTimer = null;
        // The other half of the close, held back until now: see above.
        // Idempotent on the container, which left gesture mode when the exit
        // began.
        setGestureMode(false);
        sh.hidden = true;
        sc.hidden = true;
        sh.classList.remove('sheet-in', 'sheet-out');
        sc.classList.remove('sheet-in', 'sheet-out');
        $('sheetList').innerHTML = '';
        $('searchResults').innerHTML = '';
        $('searchResults').hidden = true;
        $('searchContainer').hidden = true;
        $('settings').classList.add('hidden');
        show($('sheetList'), true);
    };
    if (sheetExitTimer) sheetExitTimer();
    // Nothing on screen to animate away, or the preference says not to.
    if (sh.hidden || reduceMotion()) { wipe(); return; }
    sh.classList.remove('sheet-in');
    sc.classList.remove('sheet-in');
    sh.classList.add('sheet-out');
    sc.classList.add('sheet-out');
    const t = setTimeout(wipe, SHEET_EXIT_MS);
    // The handle IS the finisher: calling it runs the teardown early and
    // cancels the timer, so a reopen mid-exit has one thing to call.
    sheetExitTimer = () => { clearTimeout(t); wipe(); };
};

const closeSheet = (commit = false) => {
    // A sheet the FINGER opened only commits a city the finger actually aimed
    // at. The x-axis has always worked this way — a sideways drag under
    // VIEW_COMMIT_PX changes nothing — and the y-axis had no equivalent: it
    // took whatever the opening aim happened to be, on the assumption that the
    // opening aim was always the current city and therefore always a no-op.
    // It is not (see openSheet), so a touch that armed the switcher by
    // accident — a tap that outlasted the hold, a thumb roll past the slop —
    // and then released without ever crossing a row would change the city.
    // That is the whole reported bug: tapping the name swapped cities.
    //
    // A tap-opened sheet is untouched by this. There the aim IS the intent:
    // the row you tap is the row you get, and the click handler sets the aim
    // and commits in one go.
    if (commit && sheet && sheet.via === 'drag' && !sheet.moved) commit = false;
    // A preview waiting on the next frame has run out of frames. A commit
    // takes it now — a tap sets the aim and closes in one task, and the
    // sweep it would have had is the one the commit lands on. Anything
    // that takes nothing drops it: there is nothing left to preview.
    cancelAim(commit);
    // The two action indices are answered before anything is torn down, and
    // off the sheet's own frozen rows rather than off a fresh list. The wide
    // one is the mode the sheet is already in; the compact one is the mode it
    // is not. So the same index means different things depending on which way
    // you are going, and both directions are one tap in one place.
    const si = sheetRows().length;
    if (commit && sheet && sheet.aim >= si) {
        // The wide slot is the mode the sheet is in; the button is the mode
        // it is not. Both stay INSIDE the sheet, so this path tears nothing
        // down: it changes what the sheet is showing. Handling it after the
        // teardown below put a mode inside a sheet that had just been hidden.
        const wide = sheet.aim === si;
        const want = wide
            ? (sheetMode === 'settings' ? 'settings' : 'search')
            : (sheetMode === 'settings' ? 'search' : 'settings');
        if (want === 'search') openSearch();
        else setSheetMode('settings');
        paintAim();
        return;
    }

    const s = sheet;
    sheet = null;
    // Off the sheet's own rows, captured when it opened. Reading a fresh
    // list here would be reading a different list than the one the aim is
    // an index into.
    const place = (commit && s) ? s.rows[s.aim]?.place : null;
    hideSheetChrome();
    // hideSheetChrome puts the OLD city back in the control row, and the
    // commit below can be a whole wave behind it. Name the destination now,
    // or the row reappears saying the city you just left for a third of a
    // second, which reads as the release having missed.
    if (place) $('locationName').textContent = place.name;
    if (!s) return;
    if (!place || placeKey(place) === placeKey(state.place)) {
        // Back where it started, or nothing taken. The preview leaves the
        // wave aimed at whatever was last under the finger, and waveRelease
        // only lets that wave FINISH: it does not undo where it was pointed.
        // So aim it back at the city that is actually current before letting
        // go, or the grid settles showing one city while every label on the
        // screen names another. That is what used to happen when the current
        // city was in neither list and this lookup came back -1; it always
        // has a row now, which is what makes the lookup answerable at all.
        // Measured against `swept`, not the aim: the aim is where the finger
        // ended and the grid may never have been pointed there — a preview
        // the release beat to the frame is a preview that never ran.
        const cur = s.rows.findIndex(r => placeKey(r.place) === placeKey(state.place));
        const back = cur >= 0 && cur !== s.swept ? sheetColsFor(cur, s) : null;
        if (back) waveTo($('grid'), back, -(Math.sign(cur - s.swept) || 1), { axis: 'y' });
        waveRelease();
        if (!wave) repaint();
        // The sheet is already null, so this drops the comparison line and
        // leaves the tooltip reading one city again. The commit path gets
        // the same thing for free out of changeCity's repaint.
        refreshActiveTooltip();
        // A held sheet that was aimed around and then released where it
        // started IS the peek, so the hint that names it has done its job
        // and retires. `moved` is what separates it from a dismissal: a
        // scrim tap or an Escape never aimed at anything and has learned
        // nothing. Deliberately not retired by a plain commit — switching
        // city is the other gesture, and it is already named by its own
        // hint.
        if (s.via === 'drag' && s.moved) retireHint('peek');
        return;
    }
    // Commit exactly once, and never gate it on something that might not
    // happen. Letting the sweep finish first is a nicety: the grid settles on
    // the destination and the commit repaints onto the frame it already
    // shows, so the change is invisible. But `wave` can be a wave that has
    // ALREADY settled (the preview is skipped for a city with no cached
    // forecast, so the object left in flight belongs to an earlier aim), and
    // a settled wave never calls `onSettle` again. Gating on it alone lost
    // the commit outright: the aim was right, the release was right, and the
    // city did not change. Intermittent, because it depended on what the
    // previous gesture had left running.
    let committed = false;
    const land = () => {
        if (committed) return;
        committed = true;
        changeCity(place, true, null);
    };
    if (!s.live || reduceMotion()) { land(); return; }
    waveRelease();
    if (!wave) { land(); return; }
    wave.onSettle = land;
    // The backstop. One wave is ~380ms; anything still unsettled past this
    // is not going to settle.
    setTimeout(land, 600);
};

// Which row a point is over. Above the sheet entirely, the aim simply
// stays where it was rather than snapping to an end.
const aimAtPoint = (x, y) => {
    const row = document.elementFromPoint(x, y)?.closest?.('.sheet-row');
    if (!row) return;
    // A sheet opened by the gesture aims at PLACES ONLY. The action row sits
    // where the control row was, which is exactly where the finger starts,
    // so leaving it aimable made every hold land on search: the gesture
    // opened the switch and then immediately pointed at the way out of it.
    if (sheet && sheet.via === 'drag' && !$('sheetList').contains(row)) return;
    setAim(+row.dataset.idx);
};

// The swipe is armed by the CITY NAME, not by the whole row. The row also
// holds the three view buttons, and a swipe that started on `temp` opening
// the city list is a gesture answering a question nobody asked. The name is
// also where the caret and the hint already point, so the affordance and the
// origin are the same place.
// --- The control row is one gesture surface -----------------------------
// The whole row, not just the name. Two axes, one origin:
//
//   swipe up          the city switcher, tracking the finger
//   swipe sideways    the view switcher, one step per swipe
//   tap the name      search
//   tap a view word   that view
//
// Every one of them is decided on RELEASE, not on the way down. Deciding on
// the way down was the original bug: search opened the instant the finger
// landed, which left no room for the finger to then go anywhere.
//
// The axis is locked once, at the slop distance, from whichever component of
// the travel is larger, and never re-read. Two gestures sharing a surface
// need one arbiter, not a running argument.
//
// And DISTANCE is the only arbiter. There was a press-and-hold here too — a
// second way into the switcher, for a finger that had not moved — and a
// threshold in milliseconds cannot tell a hold from a tap, because a tap does
// not have a length people control. Whatever the number was, some taps were
// under it and some were over, so the same gesture produced search one time
// and a city switch the next: not a threshold that needed tuning, a question
// that cannot be answered from the clock. It is gone. A press that does not
// travel is a tap, however long it lasts, and the swipe is the only way into
// the switcher. One gesture, one outcome, decided by where the finger went.
const controlRow = $('controlRow');
let rowTouch = null;
// Set for a moment after a touch has decided the outcome, so the trailing
// synthetic click cannot decide it a second time. A press that never moved
// is not preventDefault-ed, so that click does arrive.
let cityTouchOwns = false;

const armSwitch = () => {
    if (rowTouch.armed) return false;
    // Nothing to switch between: leave the touch alone so it falls through
    // to the tap, which is the only useful thing left.
    if (sheetPlaces().length < 2) return false;
    rowTouch.armed = true;
    openSheet('drag');
    return true;
};

controlRow.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { rowTouch = null; return; }
    const t = e.touches[0];
    rowTouch = {
        x: t.clientX, y: t.clientY, dx: 0,
        axis: null, armed: false,
        // Which tap this would be if it turns out to be one.
        onName: !!e.target.closest?.('#location')
    };
}, { passive: true });

controlRow.addEventListener('touchmove', e => {
    if (!rowTouch || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - rowTouch.x, dy = t.clientY - rowTouch.y;
    rowTouch.dx = dx;
    if (!rowTouch.axis) {
        // Which way is this going? Nothing is claimed until the travel says
        // so on one axis, and the distance is measured on THAT axis rather
        // than as a straight-line hypotenuse: a mostly-sideways wobble whose
        // diagonal happened to clear the slop was arming the switcher.
        if (Math.abs(dy) > Math.abs(dx)) {
            // Dragged well downward: off the gesture entirely. There is
            // nothing below the bottom row, and a finger heading that way is
            // leaving, so it is neither a switch nor still a tap.
            if (dy > SHEET_ARM_PX) { rowTouch = null; return; }
            if (-dy < SHEET_ARM_PX) return;
            if (!armSwitch()) { rowTouch = null; return; }
            rowTouch.axis = 'y';
            e.preventDefault();
            // The sheet opened on THIS event, so its rows are wherever the
            // entrance animation has them — a frame short of where they will
            // land. Aiming now would aim at the animation. This move opened
            // the door; the next one aims.
            return;
        }
        if (Math.abs(dx) < SHEET_ARM_PX) return;
        rowTouch.axis = 'x';
    }
    e.preventDefault();
    // The sideways drag renders nothing on the way out. The travel is only
    // read at the release, below.
    if (rowTouch.axis === 'y') aimAtPoint(t.clientX, t.clientY);
}, { passive: false });

// --- The view switch --------------------------------------------------
// The sideways drag used to scrub: the grid crossfaded under the finger
// and the release either completed the sweep or rewound it. A view is one
// of three, not a position on a continuum, so a half-played sweep is a
// grid painted in a scale the legend is not showing and the transition
// went as fast or as slow as the hand did. It steps on release instead,
// and the wave that follows is the same one a toolbar tap plays: one
// direction, one tempo, start to finish.

// Release. Travel past the commit distance takes the step; anything
// short of it takes nothing, and either way nothing on screen has moved
// until now.
const endViewSwipe = (r, commit) => {
    if (!r) return;
    if (commit && Math.abs(r.dx) > VIEW_COMMIT_PX) stepView(r.dx < 0 ? 1 : -1);
};

const endRowTouch = commit => {
    const r = rowTouch;
    rowTouch = null;
    if (!r) return;
    cityTouchOwns = true;
    setTimeout(() => { cityTouchOwns = false; }, 400);
    if (r.axis === 'x') {
        // Drag left for the next view, right for the previous, the same
        // direction the control row reads in. Decided on release off the
        // travel, so a slow drag and a flick differ only in where they end.
        endViewSwipe(r, commit);
        // A sideways swipe usually ends on top of a view button, and that
        // button's own click would then set a view the swipe did not choose.
        return true;
    }
    if (!r.armed) {
        // Never travelled far enough to be a swipe on either axis, so it was
        // a press, so it is a tap — and how long it lasted does not enter
        // into it. A tap on a view word is left to its own click handler.
        if (commit && r.onName) { openSearch(); return true; }
        return;
    }
    // A swipe up. `closeSheet` takes the aim only if the finger reached a row,
    // so a swipe that opened the switcher and came back down takes nothing.
    if (sheet) closeSheet(commit);
    return true;
};
// Preventing the default on touchend is what stops the browser synthesising
// the compatibility mouse events — mousedown, mouseup and CLICK — from this
// touch. That click is the last thing standing between a tap and search, and
// the reason is geometry rather than timing: the click is dispatched at the
// finger's coordinates about 300ms later, by which point search has opened
// UNDER that point, so it lands on whatever row of the freshly-drawn list now
// occupies it. Tap the top of the city name and that is a city; tap the
// bottom and it is a different one, or the field, which is exactly why the
// same tap did something different depending on where in the label it fell.
//
// Only when the touch actually did something. A tap on a view word does
// nothing here on purpose and reaches its button through that very click, so
// suppressing it unconditionally would stop rain/temp/wind working.
controlRow.addEventListener('touchend', e => { if (endRowTouch(true)) e.preventDefault(); });
controlRow.addEventListener('touchcancel', () => endRowTouch(false));

// --- A surface that opens under a finger is not pressed by it -------------
// The belt to the braces above, for the cases preventDefault cannot reach: a
// touchend the browser will not let us cancel, a pointer stack that fires the
// click anyway, or any future caller that opens the sheet from a release.
//
// A click is the END of a press, so it belongs to whatever was under the
// finger when the press BEGAN. Anything that appeared in between was never
// pressed at all. `pointerdown` is the right thing to read: it fires once per
// real press, from the finger, at the moment of contact — the compatibility
// mouse events that follow a touch do not produce another one.
let pressTarget = null;
document.addEventListener('pointerdown', e => { pressTarget = e.target; }, true);
$('citySheet').addEventListener('click', e => {
    // Keyboard activation of a focused row: no pointer involved, so there is
    // no press to trace and nothing to distrust.
    if (e.detail === 0) return;
    if ($('citySheet').contains(pressTarget)) return;
    e.stopPropagation();
    e.preventDefault();
}, true);

// Mouse and stylus, which have no hold to read: a click is the tap, and the
// saved places are the first thing search lists before anything is typed, so
// the same list is one step away either way.
$('location').addEventListener('click', () => {
    if (cityTouchOwns) return;   // the touch above already answered this one
    if (!sheet) openSearch();
});
$('location').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (!sheet) openSearch();
});
$('citySheet').addEventListener('click', e => {
    const row = e.target.closest('.sheet-row');
    if (!row || !sheet) return;
    // Through setAim, not by assignment: a tapped row is an aim like any
    // other, and the commit gate in closeSheet reads the flag setAim sets.
    // Tapping the row that is already aimed is still a commit, so the flag
    // is set either way rather than left to setAim's no-op early return.
    setAim(+row.dataset.idx);
    sheet.moved = true;
    closeSheet(true);
});
// Hover aims in tap mode, so a mouse previews the same way a thumb does —
// and now reads the same comparison, since the tooltip's two-city line
// follows the aim. This tested `sheet.mode`, which the sheet object has
// never carried: the field is `via`, so the guard was permanently true and
// the behaviour has never actually shipped.
$('citySheet').addEventListener('pointermove', e => {
    if (!sheet || sheet.via !== 'tap' || e.pointerType === 'touch') return;
    aimAtPoint(e.clientX, e.clientY);
});
$('sheetScrim').addEventListener('click', () => closeSheet(false));

// --- The hints -----------------------------------------------------
// Three gestures carry the app and two of them were invisible. The day
// drag is the main way around the forecast and nothing on the screen said
// so; the hour pull hides eight of the twenty-four hours behind a gutter
// drawn as nothing. The slot that names the third one was already here,
// spending itself on a single line about the city list and then going
// quiet forever.
//
// So it names all three instead, one per launch, and each retires itself
// the first time its own gesture is used. A hint for something already
// learned is chrome on every glance, which is why there is no fourth
// state and no way to bring them back.
const LS_HINTS = 'mr-hints-seen';
const HINTS = [
    { key: 'sheet', text: 'swipe up for cities', live: () => sheetLive() },
    { key: 'days', text: 'pull the grid sideways for more days', live: () => elasticLive() },
    { key: 'hours', text: 'pull the hours for more of the day', live: () => hourPeekLive() },
    // The switch is also the app's comparison tool and nothing ever said
    // so. Keeping the swipe held previews each city on the grid at its true
    // colours, and releasing on the row you started on takes nothing —
    // which is the whole of "let me just check over there" and reads, with
    // no cue, as a gesture you got away with rather than one you used.
    // Last in the list, because the two reveals above it are how you get
    // around the forecast at all and this is what you do once you can.
    { key: 'peek', text: 'swipe up to peek, release to stay', live: () => sheetLive() }
];
// Read once and kept. `retireHint` runs from the day elastic's own
// move handler and from `setHourOffState`, both once per frame or notch
// inside a move handler, and
// a synchronous localStorage read plus a JSON.parse per notch is not
// something a drag should be paying for. The Set is the truth from here
// on; storage is only written to.
let hintsSeen = null;
const readHints = () => {
    if (hintsSeen) return hintsSeen;
    try { hintsSeen = new Set(JSON.parse(localStorage.getItem(LS_HINTS) || '[]')); }
    catch { hintsSeen = new Set(); }
    return hintsSeen;
};
// Which hint this launch shows: the first one still unseen whose gesture
// is actually available right now. A gesture with nowhere to go (one saved
// city, no past days) is not worth naming, and would spend its one showing
// on a suggestion that does nothing.
// Chosen on the first paint of the session and then left alone. Re-running
// the choice on every repaint promoted the next hint the instant the
// current one retired, so performing a gesture summoned the next
// suggestion: three hints in one session, each arriving as a reward for
// having just done something. One launch, one hint.
let hintKey = null, hintPicked = false;
const retireHint = key => {
    const seen = readHints();
    if (seen.has(key)) return;
    seen.add(key);
    try { localStorage.setItem(LS_HINTS, JSON.stringify([...seen])); } catch { /* private mode */ }
    if (hintKey !== key) return;
    hintKey = null;
    hintLive = false;
    syncCaption();
};
// The sheet keeps its own name for this, since it is called from the two
// places that open the sheet.
const hideSwipeHint = () => retireHint('sheet');
const renderSwipeHint = () => {
    if (hintPicked) { syncCaption(); return; }
    // Not before there is a forecast. Whether a gesture leads anywhere is
    // a question about the data, and asked too early the answers are wrong
    // in both directions: paging looks dead because no days have been
    // parsed yet, while the hour pull looks alive because it only ever
    // consults a setting. Picking then spent the session's one hint on the
    // third choice while the second was still loading.
    if (!state.data.length) { syncCaption(); return; }
    const seen = readHints();
    const pick = HINTS.find(h => !seen.has(h.key) && h.live());
    hintPicked = true;
    hintKey = pick ? pick.key : null;
    hintLive = !!pick;
    if (pick) $('swipeHint').textContent = pick.text;
    syncCaption();
};

// --- The flick answer ----------------------------------------------
// The day axis is a DRAG. It is one-to-one under the finger for its whole
// length, and it has no velocity anywhere in it: nothing is thrown, nothing
// coasts, and a fast swipe that leaves the screen after 80ms opens three
// days and shuts them again before they can be read. That is correct — the
// elastic is a thing you hold, not a page you turn — but it is invisible,
// and a phone has taught everyone that a sideways flick on a calendar is
// how you get to next week. Someone who flicks gets a twitch and no days,
// twice, and then stops trying.
//
// So the app answers, in the one line it already has for saying how a
// gesture works, at the one moment the question is actually being asked:
// the release that just gave them nothing. Not a first-run hint — a first
// run is before anyone has tried anything — and not a new surface. It says
// the thing the flick got wrong, which is not WHERE to drag but HOW LONG
// to keep hold of it.
//
// It is said through `setStatus`, transient, like every other reply to
// something just done: the app has one state channel and this is a
// message, not a fourth occupant of the caption slot. That also settles the
// two collisions for free — a transient status outranks the key, so a
// finger going back onto the grid cannot cover it, and it clears itself
// back down to the resting line without anything having to remember what
// was there before.
//
// Three times, ever, and never again once a stretch has actually been
// locked open: at that point the gesture has been used properly and the
// app has nothing left to explain.
const LS_FLICKS = 'mr-flicks';
// A release sooner than this after the pull was claimed, having travelled
// at least this far, was thrown rather than dragged. Both are needed: the
// time alone catches a small deliberate peek, and the distance alone
// catches every drag there is.
const FLICK_MS = 260;
const FLICK_PX = 24;
const FLICK_SAYS = 3;
const FLICK_TEXT = 'keep hold of the drag — the days follow your finger';
// Counted in memory and written through, the way the hints are: storage can
// refuse (private mode), and a count that comes back zero every time would
// turn a three-times-ever line into one that answers every flick forever.
let flicksSaid = null;
const readFlicks = () => {
    if (flicksSaid == null) {
        try { flicksSaid = +localStorage.getItem(LS_FLICKS) || 0; } catch { flicksSaid = 0; }
    }
    return flicksSaid;
};
const writeFlicks = n => {
    flicksSaid = n;
    try { localStorage.setItem(LS_FLICKS, String(n)); } catch { /* private mode */ }
};
const sayFlick = () => {
    const n = readFlicks();
    if (n >= FLICK_SAYS) return;
    writeFlicks(n + 1);
    setStatus(FLICK_TEXT, '', { transient: true });
};
// Understood, demonstrably: they held a drag past the end of the axis and
// locked it there. Nothing more to say, this session or any other.
const retireFlickSay = () => { if (readFlicks() < FLICK_SAYS) writeFlicks(FLICK_SAYS); };

// --- The two reveals: more hours, more days -----------------------
// Both swipe axes were already taken: horizontal switches the view,
// vertical switches the city. So "pull for more hours" lands exactly on
// the city gesture and "pull for more days" lands on the view gesture,
// and there is no free axis to move either onto.
//
// Both are separated by ORIGIN instead: a reveal is armed only by a drag
// that STARTS on its own rail (#hourRail, the time-label gutter;
// the time-label gutter), and a drag that starts anywhere on the
// grid field is a view or city swipe exactly as before. That makes the
// two collision-free by construction, with no velocity threshold
// anywhere and no second gesture recognizer competing with the one in
// the handler above. An earlier design had the hour peek as a
// velocity-gated drag on the grid body; the rail was chosen over it
// instead, which also removes the last tuned threshold that design
// had left, the class of thing that got the hold gesture reverted.
//
// Each rail reuses the same movement math as the swipe above: a drag is
// nothing at all until it has travelled REVEAL_SLOP, and only then does
// it claim the gesture. Below the slop nothing renders and nothing is
// preventDefault-ed, so a stray touch on a rail still behaves like an
// ordinary touch on the page.
// Shared movement constants. DWELL is the share of any notch or step
// spent parked before it starts moving: the linger that makes a drag
// aimable rather than twitchy. It is used by the page notches, the hour
// peek's notches, and nothing else now that both list gestures are gone.
const DWELL = 0.5;
// A rewind is faster than a completion, but not instant: a blend
// abandoned at 15px would otherwise snap back inside a single frame.
const REWIND_MIN_MS = 120;
const REVEAL_SLOP = 10;   // px before a rail drag is a reveal at all
const REVEAL_IDLE_MS = 4000; // the hour peek's own way home, for the
                             // inputs that have no release to read
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
// rails, reusing the same wave engine every transition runs on
// (`waveTo`, scrubbed by `scrubReveal` below) instead of the instant
// per-notch repaint. Diagnosis: the rails' swipe INPUT was already
// smooth and tuned (dwell, sensitivity); the OUTPUT was a hard cut
// every notch, which is what read as jittery next to the gradual
// colour swap. Everything this pass touches is tagged EXPERIMENTAL. Grep
// for it to find every spot: this block, the two `colsFor`/
// `stateSetter` lines in each `railDrag(...)` call below, the
// `railScrubLive` branch inside `railDrag`, `mapRailNotches`'
// return shape (an object now, read by that branch), and the
// `setHourOffState` split above (`setHourOff` still does exactly
// what it always did, just built from that split). Reverting means
// undoing all of those, not only this block. The day axis left this
// scheme entirely.
// Known limitation: the day-label row and hour-rail times do not
// themselves animate mid-drag (only the coloured grid does), so
// they can lag a frame or two behind the blend until it settles.
// Off entirely under reduced motion, where there is nothing to
// blend and the shipped instant behaviour already degrades cleanly.
const railScrubLive = () => !reduceMotion();

// Builds the grid for a given hour offset without touching the live
// `hourOff`, the same trick `sheetColsFor` uses: swap the state just
// long enough to call buildCols(), then restore it. Cached per drag,
// since a single drag can cross many notches.
//
// The day axis had one of these too. It is gone: the elastic does not
// swap one grid for another as it moves, it changes the width of the
// columns already on screen, so there is no second grid to blend toward.
const hourColsFor = (offset, cache) => {
    const { min, max } = hourPeekRange();
    const key = Math.max(min, Math.min(max, offset));
    if (cache.has(key)) return cache.get(key);
    const ref = refCols();
    const keep = hourOff;
    let built;
    try { hourOff = key; built = fitCols(buildCols(), ref); }
    finally { hourOff = keep; }
    cache.set(key, built);
    return built;
};

// Hand the playhead to the finger: `p` is 0..1 along the wave's own
// timeline rather than a duration, so the blend IS the drag. `p` is
// measured within the CURRENT notch (0 through mapRailNotches' own
// dwell, ramping to 1 across the rest), so the blend pair only
// retargets when a full notch is crossed, not on every frame.
// The destination only ever changes at the origin, because the rail
// re-locks direction inside its dwell, so the sweep is rebuilt from
// zero rather than retargeted: `waveTo`'s queued reversal is a PACED
// behaviour and would rewind on its own clock underneath a finger
// that is already back where it started.
const scrubReveal = (cols, dir, p, axis) => {
    const grid = $('grid');
    if (wave && wave.scrub && (cols !== wave.to || dir !== wave.dir)) {
        wave.t = 0; wave.to = wave.from; wave.pending = null;
    }
    waveTo(grid, cols, dir, { axis, hold: true });
    if (!wave) return;
    wave.scrub = true;
    wave.rewind = false;
    if (waveRaf) { cancelFrame(waveRaf); waveRaf = null; }
    wave.t = Math.max(0, Math.min(wave.total, p * wave.total));
    waveFrame();
};

// The last notch's blend either completes
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
// `tooltipOpen` is declared with the tooltip itself, further up.
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
    // The gesture has been used, so its hint has done its job. Only a pull
    // AWAY from rest counts: the way home is not a discovery.
    if (v) retireHint('hours');
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
// The shared way home, for both axes.
//
// It used to be a rAF tween that called `repaint()` on every frame. That
// is a full `innerHTML` rebuild of 112 blocks, the model behind them and
// every SVG mark on them, roughly fourteen times over for one 220ms
// movement, and it invalidated focus and any open tooltip's element
// reference each time. It also rounded the offset to a whole notch per
// frame, so what it actually drew was a handful of hard cuts rather than
// a movement.
//
// This is the drag's own path with an eased clock in place of the finger:
// the offsets stay whole (a block holds exactly one hour, never a blend of
// two), and what moves continuously is the crossfade between the
// two notches either side of the playhead. The chrome that names the
// window travels with it, and the grid is rebuilt once, at the end.
const homeTween = ({ from, axis, gen, genOf, setOffset, colsFor, done }) => {
    const sgn = Math.sign(from);
    const dist = Math.abs(from);
    // A longer way home takes longer, but sublinearly: seven days back
    // should not take seven times as long as one.
    const dur = REVEAL_HOME_MS * Math.min(2.2, Math.sqrt(dist));
    const scrub = railScrubLive() && !!colsFor;
    const cache = new Map();
    const t0 = performance.now();
    // Seeded at the notch the FIRST tick will be in, not at the one the
    // tween starts from: the first tick always has p > 0, so `dist` would
    // read as a notch crossing before anything had moved.
    let lastK = Math.max(0, dist - 1), lastOffset = from;
    const finish = () => {
        setOffset(0);
        renderOffsetChrome();
        repaint();
        if (done) done();
    };
    const tick = now => {
        if (gen !== genOf()) return;  // superseded by a new drag/press/reset
        const p = Math.min(1, (now - t0) / dur);
        if (p >= 1) { finish(); return; }
        // Continuous position, `from` sliding to 0 on a cubic ease-out.
        const mag = dist * Math.pow(1 - p, 3);
        const k = Math.floor(mag);
        // How far past notch k the window still sits, measured AWAY from
        // home; `1 - frac` is therefore progress toward notch k.
        const frac = mag - k;
        // The committed offset flips at the halfway point of each notch,
        // the same place the drag's own Math.round puts it.
        const offset = sgn * Math.round(mag);
        if (offset !== lastOffset) { lastOffset = offset; setOffset(offset); renderOffsetChrome(); }
        if (scrub) {
            // A whole notch crossed: promote what the wave was blending
            // toward into its new starting point, exactly as the drag does.
            if (k !== lastK) { if (wave && wave.scrub) { wave.from = wave.to; wave.t = 0; } lastK = k; }
            scrubReveal(colsFor(sgn * k, cache), sgn, 1 - frac, axis);
        }
        scheduleFrame(tick);
    };
    scheduleFrame(tick);
};

const springHours = () => {
    clearTimeout(revealTimer);
    pendingRevealFn = null;
    if (!hourOff) return;
    const from = hourOff, gen = ++hourHomeGen;
    if (reduceMotion()) { hourOff = 0; repaint(); return; }
    homeTween({
        from,
        axis: 'y',
        gen,
        genOf: () => hourHomeGen,
        setOffset: n => { hourOff = n; },
        colsFor: (offset, cache) => hourColsFor(offset, cache),
        // The peek comes home to a grid the tween has already rebuilt,
        // so the arrival is armed and fired together. The reduced-motion
        // shortcut above returns before the tween, which is right:
        // nothing should fire there.
        done: () => { armArrival(); flushArrival(); }
    });
};

// The day axis had a latched drawer here: a paged window, a ⌂ chip that
// meant "off today", and a four-second idle timer that took the screen
// back on its own. All three are gone, and gone rather than disabled —
// the elastic replaces the model, not the tuning. The chip survives
// only as the locked state's way out, and it is drawn by
// `applyDayWidths` because the state it reports is the elastic's.

// --- Rail drag ----------------------------------------------------
// The hour rail's own drag. It was shared by both axes; the day axis is
// the elastic now and has its own handler, so this has one caller.
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
        // block above `setHourOffState` for what
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
            // This path bypasses `renderOffsetChrome`, so the carets
            // are refreshed here or they keep pointing past the clamp.
            showReachMarks(legendHeld);
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
        // `springHours`, runs, rather than calling it against a grid
        // still mid-blend.
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
// A wheel has no release, so the day elastic's peek is held for this
// long after the last notch and then eases home, which is the nearest a
// wheel has to letting go. Short enough that it is plainly a peek.
const WHEEL_HOLD_MS = 1000;
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
// The day axis was a railDrag bound to #dayRail, then a paging handler
// on the grid. It is the elastic now, and it lives with the gesture that
// owns it, up by `chart`.

railWheel($('hourRail'), {
    axis: 'y',
    enabled: hourPeekLive,
    // A wheel has no release to spring back from, so the peek goes home
    // on the same idle timer the keyboard route uses. It still cannot
    // latch: there is no input that leaves it open.
    step: dir => { setHourOff(hourOff + dir); armRevealIdle(springHours); }
});
// ⌂ exists only while the stretch is locked, and it means home.
$('dayHome').addEventListener('click', () => elasticHome());

// A tap in dead space releases a locked stretch. Three regions are
// deliberately excluded, and for the same reason each time: the tap
// there is part of using the stretch, not part of leaving it.
//
//   .chart / .day-row   revealed days stay tappable, and a tap that
//                       closed the thing you were reading would make the
//                       reveal useless for the question it answers.
//   .control-row        the city name and the view words. Switching city
//                       or view under an open stretch is what the lock
//                       now survives, so the tap that does it must not
//                       also be the tap that closes it.
//   .city-sheet         the switcher opened FROM the control row; the
//   .sheet-scrim        row it lands on is a city change like any other,
//                       and dismissing it on the scrim is documented as
//                       taking nothing, which has to include the lock.
document.addEventListener('pointerdown', e => {
    if (dayMode !== 'locked') return;
    if (e.target?.closest?.('.day-row, .chart, .control-row, .city-sheet, .sheet-scrim')) return;
    elasticHome();
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

// --- Keyboard route into the city list ---------------------------
// A key press has no drag underneath it and there is no rail left to
// roll, so a step is what it says it is: commit the neighbouring
// favourite and let the grid's own wave carry the change. The sheet is
// for aiming; the arrows are for stepping, and a keyboard user who
// wants the list can open the sheet with Enter on the city name and
// walk it with the same arrows.
//
// Down is NEXT, up is PREVIOUS. The old rule was the other way round
// because the rail rolled with the finger and a swipe up reached the next
// favourite. There is no rail now: the sheet is a plain list, dragging up
// moves toward rows HIGHER in it, and the arrows have to agree with both
// the list and the plain listbox convention.
const keyStepCity = dir => {
    // Walks the sheet's own order, so ↑ is the city you were last on, the
    // same one a one-row swipe reaches.
    const list = sheetPlaces();
    const cur = list.findIndex(c => placeKey(c) === placeKey(state.place));
    const place = list[cityClamp(cur + dir)];
    // Honesty guard: with no second city, or already at an end of the
    // list, the target clamps back to the city on screen, so nothing
    // commits and nothing is drawn.
    //
    // ↓ is at an end by construction: the current city is the bottom row,
    // so from a closed sheet there is never a row below it and ↓ does
    // nothing. That is the clamp working, not a dead key — the list is
    // destinations ordered by cost and you are standing on the cheapest
    // one. ↓ IS live with the sheet open, where the aim can be anywhere
    // in the list and `sheetKey` walks it in both directions.
    if (!place || placeKey(place) === placeKey(state.place)) return;
    // The sweep opposes the list step, so the incoming city arrives from
    // the side the list is moving toward.
    changeCity(place, true, { type: 'wave', axis: 'y', dir: -dir });
};

// Arrow keys walk the sheet while it is open, so the aim, the preview
// and the readout are the same ones a thumb gets.
const sheetKey = e => {
    if (!sheet) return false;
    // With the menu up, the sheet still owns the keys: the arrows must not
    // fall through and start stepping the city behind it.
    if (!$('settings').classList.contains('hidden')) {
        return ['ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key);
    }
    // Same for search. The sheet that search keeps around is a list to step
    // back to, not a thing being aimed, and its default aim is a real city
    // whenever the current one is unstarred — so Enter here would have
    // committed a city nobody chose. Swallow the keys rather than acting on
    // them: search owns them, and the field usually has focus anyway.
    if (sheetMode === 'search') return ['ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key);
    const last = sheetPlaces().length;   // the search row; +1 is the menu
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setAim(Math.max(0, Math.min(last + 1, sheet.aim + d)));
        // An arrow is a choice, the same as a thumb crossing a row or a
        // tap on one, so Enter after it commits. Without this the commit
        // gate above would read the sheet as never aimed at.
        sheet.moved = true;
        return true;
    }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeSheet(true); return true; }
    return false;
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
        // The sheet is the next layer down. One Escape steps back out of a
        // mode; the next dismisses the sheet, taking nothing.
        if (!$('citySheet').hidden) {
            if (sheetMode !== 'places' && sheetLive()) {
                if (sheetMode === 'search') closeSearch(); else setSheetMode('places');
                return;
            }
            sheet = null;
            hideSheetChrome();
            waveRelease();
            return;
        }
        closeSearch();
        hideTooltip();
        if (dayN || dayMode !== 'home') elasticHome();
        if (hourOff) springHours();
        return;
    }
    if ((e.target.tagName || '') === 'INPUT') return; // don't hijack typing
    // An open sheet owns the arrows: it is the thing being aimed.
    if (sheetKey(e)) return;
    // Shift+arrows are the keyboard route into the two reveals, so a
    // keyboard user reaches the same data a drag does (and a drag has no
    // keyboard equivalent). Shift+↑/↓ peeks hours, and springs home on
    // the idle timer, since a key press has no release to spring back
    // from.
    //
    // Shift+←/→ nudges the day elastic by a whole day, held rather than
    // sprung: a keyboard has no hand to take away, so the peek stays
    // where it was put. Shift+End / Shift+Home lock it open and let it
    // go — the keyboard's version of the overpull, which is a threshold
    // and therefore has nothing a key can mean. Escape and ⌂ are home
    // from anywhere.
    if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const horiz = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        if (horiz && !elasticLive()) return;
        const r = hourPeekRange();
        if (!horiz && r.min === r.max) return;
        e.preventDefault();
        if (horiz) nudgeElastic(e.key === 'ArrowRight' ? 1 : -1);
        else {
            setHourOff(hourOff + (e.key === 'ArrowDown' ? 1 : -1));
            armRevealIdle(springHours);
        }
        return;
    }
    if (e.shiftKey && (e.key === 'End' || e.key === 'Home')) {
        if (!elasticLive()) return;
        e.preventDefault();
        if (e.key === 'Home') { elasticHome(); return; }
        // Shift+End takes the end it is already leaning toward, and
        // forward when it is leaning nowhere.
        const side = Math.sign(dayN) || 1;
        const cap = reachOn(side);
        if (!cap) return;
        if (dayMode === 'locked' && Math.abs(dayN) >= cap - 0.5) { elasticHome(); return; }
        dayMode = 'locked';
        retireHint('days');
        springTo(side * cap, 0, LOCK_SETTLE_MS, easeInOut);
        return;
    }
    // ↑/↓ step the location through ★ favorites (see keyStepCity above);
    // ←/→ cycle views, which the control row's buttons also do. ↓ is NEXT,
    // matching the order the sheet lists them in.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!sheetLive()) return;
        e.preventDefault();
        keyStepCity(e.key === 'ArrowDown' ? 1 : -1);
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
$('geoBtn').addEventListener('click', () => {
    // A commit, like picking a result: the sheet goes rather than stepping
    // back to the list.
    sheet = null;
    hideSheetChrome();
    useMyLocation();
});

$('searchResults').addEventListener('click', e => {
    const pin = e.target.closest('.pin');
    if (pin) { // ★ promotes into the pinned tier; the panel stays open
        const { tier, ...place } = state.suggestions[+pin.dataset.i];
        if (pinCity(place)) renderSuggestions($('searchInput').value);
        // Cap reached: a hint rather than a silent no-op, in the list's own
        // vocabulary rather than the storage layer's.
        else flashFavHint(`Pinned cities are limited to ${MAX_FAVORITES}. Unpin one to add another.`);
        return;
    }
    const unpin = e.target.closest('.unpin');
    if (unpin) { // ✕ demotes into the transient tier; it is not a delete
        const { tier, ...place } = state.suggestions[+unpin.dataset.i];
        unpinCity(place);
        renderSuggestions($('searchInput').value);
        return;
    }
    const row = e.target.closest('.search-result');
    if (row) {
        const { tier, ...place } = state.suggestions[+row.dataset.i];
        // A pick we already have fresh cache for swipes up into view (the
        // same wave as the ↑ arrow); an uncached place keeps skeleton → reveal.
        const entry = loadForecast(place);
        const cached = entry?.payload && !forecastExpired(entry);
        // A pick is a commit, so the sheet goes with it rather than stepping
        // back to the list the search was opened from.
        sheet = null;
        hideSheetChrome();
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
    if (e.target.closest('.city-sheet')) return;
    if (!$('citySheet').hidden) return;   // the scrim and Escape own dismissal
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

// Connection state flows through the one status line. Going
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
// The view underline is measured from real button geometry, so
// it has to be re-measured whenever that geometry can change: a rotation,
// a resize, or the webfont landing after first paint.
addEventListener('resize', () => renderViewBar());
addEventListener('orientationchange', () => renderViewBar());
document.fonts?.ready?.then(() => renderViewBar());
// The columns' widths are measured from the frame, so they have
// to be re-measured for the same reasons.
//
// Widths go out immediately, because a resize is a live drag and the
// grid has to track it. The FIELDS follow on a debounce: the overlay
// declares its own box so it reads correctly throughout the drag without
// any help, and rebuilding sixty times a second while someone drags a
// window corner is the one thing the elastic's whole design is arranged
// to avoid. `settleFields` then re-bakes exact geometry once the size
// has stopped moving — and does nothing at all if it came back to where
// it started.
let fieldSettleTimer = null;
const onFrameResize = () => {
    measureGap();
    applyDayWidths();
    // The tooltip's size cache is keyed on content, which holds everywhere
    // but here: the width cap is min(240px, 100vw - 16px), so the same
    // words measure differently after a rotation. Drop it.
    invalidateTip();
    clearTimeout(fieldSettleTimer);
    fieldSettleTimer = setTimeout(settleFields, 180);
};
addEventListener('resize', onFrameResize);
addEventListener('orientationchange', onFrameResize);
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
$('geoBtn').innerHTML = MR_ICON.locate;
$('locationCaret').innerHTML = MR_ICON.caret;
$('installDismiss').innerHTML = MR_ICON.close;
// Every modal's close button (changelog, hourly-data, and any future
// one registered via registerModal) shares this same glyph.
document.querySelectorAll('.modal-close').forEach(btn => { btn.innerHTML = MR_ICON.close; });
if (matchMedia('(pointer: fine)').matches) $('location').title = 'Change city';
renderSwipeHint();

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
    // Startup is just "paint the cache for state.place, then
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
// Cache lifecycle sweep, once per startup, off the critical
// path so it never delays the first paint.
setTimeout(sweepForecasts, 4000);

// Service worker: when a genuinely newer version is waiting, surface
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
