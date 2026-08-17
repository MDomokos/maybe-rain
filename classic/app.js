// ---------------------------------------------------------------
// Maybe Rain? A single-file weather app.
// Data: Open-Meteo (keyless, true hourly, 7 days, city-local time).
// ---------------------------------------------------------------

const hourRange = () => settings.allHours
    ? { start: 0, end: 23 } : { start: HOUR_START, end: HOUR_END };

// The window rendered: the full week (up to 7 days of real data) across
// the whole hour range. Kept as a function so its callers still read
// { start, end, days } unchanged.
//
// `off` is where the frame starts in state.data. It is always today, so
// the window classic shows is unchanged, but state.data now begins at
// PAST_DAYS before today rather than at today (see shared/forecast.js),
// and a frame anchored at 0 would put last night in the first column.
// Classic has no way to reach a past day and no wish to show one, so it
// steps over them here. state.todayIndex is 0 for any payload that
// predates past_days, which is the old behaviour exactly.
const visibleWindow = () => {
    const { start, end } = hourRange();
    return { start, end, days: 7, off: state.todayIndex || 0 };
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
    // `ti` and `off` are both absolute indices into state.days, which no
    // longer starts at today. In classic `off` IS today's index, so this
    // is only ever true of the first column, but it is written against
    // the frame rather than against 0 so it stays right if that changes.
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
let nextRevealAnim = null; // directional/first hint for the next fresh paint
let gridTimers = [];       // pending blink timeouts, all cancelled on the next paint
let gridBusyUntil = 0;     // timestamp a directional wave finishes settling
let pendingRefresh = null; // a refresh deferred until the wave above settles
const GRID_BLACK_MS = 45, GRID_HOLD_MS = 45, GRID_COLOR_MS = 110;
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
    : `<div class="weather-block${desc.current ? ' current' : ''}" style="background:rgb(${desc.rgb});color:${desc.textColor}" tabindex="0" aria-label="${esc(desc.info)}" data-day="${desc.dayIndex}" data-hour="${desc.hour}" data-info="${esc(desc.info)}">${desc.marks}</div>`;

// Update an existing cell node in place (no DOM teardown, so a blink can
// run old → black → new on the same element).
const applyCell = (node, desc, animated) => {
    if (desc.empty) {
        node.className = 'weather-block empty';
        ['tabindex', 'aria-label', 'data-day', 'data-hour', 'data-info'].forEach(a => node.removeAttribute(a));
        node.style.transition = 'none'; node.style.background = 'transparent'; node.innerHTML = '';
        return;
    }
    node.className = 'weather-block' + (desc.current ? ' current' : '');
    node.innerHTML = desc.marks;
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', desc.info);
    node.dataset.day = desc.dayIndex;
    node.dataset.hour = desc.hour;
    node.dataset.info = desc.info;
    node.style.color = desc.textColor;
    node.style.transition = animated ? `background-color ${GRID_COLOR_MS}ms linear` : 'none';
    node.style.background = `rgb(${desc.rgb})`;
};

const blinkCell = (node, desc, delay, viaBlack) => {
    gridTimers.push(setTimeout(() => {
        if (!viaBlack) { applyCell(node, desc, true); return; }
        node.style.transition = `background-color ${GRID_BLACK_MS}ms linear`;
        node.style.background = '#000';
        gridTimers.push(setTimeout(() => applyCell(node, desc, true), GRID_HOLD_MS));
    }, delay));
};

const paintGrid = (grid, cols, anim) => {
    const now = performance.now();
    const nCols = cols.length, nRows = cols[0] ? cols[0].length : 0;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animated = !!anim && !reduce;

    // A refresh that lands while a directional wave is still settling waits
    // for it to finish, so the wave never gets clipped mid-sweep. Any newer
    // navigation supersedes the queued refresh below.
    if (animated && anim.type === 'refresh' && now < gridBusyUntil) {
        if (pendingRefresh) clearTimeout(pendingRefresh);
        pendingRefresh = setTimeout(() => { pendingRefresh = null; paintGrid(grid, cols, anim); }, gridBusyUntil - now + 16);
        return;
    }

    // Any other paint supersedes: drop a queued refresh and cancel every
    // in-flight blink so rapid navigation can't leave half-finished cells.
    if (pendingRefresh) { clearTimeout(pendingRefresh); pendingRefresh = null; }
    gridTimers.forEach(clearTimeout); gridTimers.length = 0;
    gridBusyUntil = 0;

    // No animation (or reduced motion): rebuild the grid instantly.
    if (!animated) {
        grid.innerHTML = cols.map(cells =>
            `<div class="day-column">${cells.map(buildCell).join('')}</div>`).join('');
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
    }

    let maxDelay = 0;
    cols.forEach((cells, c) => {
        const colNode = kids[c];
        cells.forEach((desc, r) => {
            const node = colNode.children[r];
            // Skeleton cells fill via !important; freeze their grey as an
            // inline colour and drop the class so the blink transition takes.
            if (node.classList.contains('skeleton')) {
                node.classList.remove('skeleton');
                node.style.animation = 'none';
                node.style.background = '#1c1c1c';
            }
            const delay = cellDelay(anim, c, r, nCols, nRows, desc);
            if (delay < 0 || desc.empty) applyCell(node, desc, false);
            else { blinkCell(node, desc, delay, true); if (delay > maxDelay) maxDelay = delay; }
        });
    });
    // A directional wave/reveal marks the grid busy until its last cell has
    // fully blinked in, so a refresh can defer to that moment.
    if (anim.type === 'wave' || anim.type === 'reveal') {
        gridBusyUntil = performance.now() + maxDelay + GRID_BLACK_MS + GRID_HOLD_MS + GRID_COLOR_MS;
    }
};

const updateDisplay = (anim = null) => {
    const { start, end, days, off } = visibleWindow();
    const rows = end - start + 1;
    const shownDays = state.data.slice(off, off + days);   // today-first, up to 7
    const dayMeta = state.days.slice(off, off + days);

    $('days').innerHTML = dayMeta.map(day =>
        `<div class="day-label ${day.isToday ? 'today' : ''}">${day.text}</div>`
    ).join('');

    // Min/max over the displayed hour window as a one-line "18/9"
    // pair, in the chosen unit (° implied; see .temp-item CSS).
    $('temps').className = `temp-row${settings.unit === 'F' ? ' unit-f' : ''}`;
    $('temps').innerHTML = shownDays.map(dayData => {
        const t = dayData.filter(h => h.hour >= start && h.hour <= end).map(h => h.temp);
        const fmt = v => t.length ? String(displayTemp(v)) : '–';
        return `<div class="temp-item"><span class="temp-max">${fmt(Math.max(...t))}</span><span class="temp-sep">/</span><span class="temp-min">${fmt(Math.min(...t))}</span></div>`;
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

    // The rain view is the sky base (skyBaseRGB, which classic pins to
    // DR-14's conditionRGB via SKY_MODEL) plus the streak
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

    const cols = shownDays.map((dayData, dayIndex) => {
        const isToday = dayMeta[dayIndex].isToday;
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
                    : skyBaseRGB(h, nightFactor(hour, sun));
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
            const popText = h.pop != null ? ` · ${h.pop}% rain` : '';
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
            const ch = state.changed?.[`${dayMeta[dayIndex].date}|${h.hour}`];
            const movedInView = ch && (view === 'temp' ? ch.temp : view === 'wind' ? ch.wind : ch.pop);
            const chText = changeLines(ch).map(l => ` · ${l}`).join('');
            // DR-17: name the comfort band in the temperature view so the
            // colour is spoken, not just seen.
            const feelsVal = h.feels != null ? h.feels : h.temp;
            const comfortText = view === 'temp' && feelsVal != null
                ? ` · ${TEMP_BANDS[bandIndex(feelsVal)].name.toLowerCase()}` : '';
            const info = `${dayMeta[dayIndex].date ? dateLabel(dayMeta[dayIndex].date) + ', ' : ''}${hourLabel(h.hour)} - ${h.description}, ${displayTemp(h.temp)}°${settings.unit}${comfortText}${popText}${mmText}${snowText}${windText}${hazText}${sunText}${skyText}${chText}`;
            // Marks: the precipitation overlay first (under the glyphs)
            // + the frost contour (temp view) + centred wind arrow (wind
            // view) + bottom-right hazard glyph + bottom-left sky glyph.
            // Any may be empty.
            //
            // Which renderer `precipOverlay` is depends on which file this
            // variant names in its index.html. Classic carries
            // shared/precip-pattern.js: rain lines + snow lattice + hail
            // rings, any subset, lines + lattice together being sleet. The
            // signature takes the block's pixel size for the mark field in
            // shared/precip-field.js; a pattern tiles to whatever box it is
            // given, so classic has nothing to pass and does not.
            const marks = (rainView ? precipOverlay(h, rgb) : '')
                + frost
                + arrow
                + (hazGlyph ? `<span class="block-mark">${hazGlyph}</span>` : '')
                + (sky ? `<span class="block-mark sky">${mrIcon(sky.glyph)}</span>` : '');
            // Absolute index into state.days, so the tooltip reads the
            // right day back out now that the frame starts at `off`
            // rather than at 0.
            cells.push({ rgb, textColor: textOn(rgb), marks, info, current: isCurrent, dayIndex: off + dayIndex, hour: h.hour, moved: !!movedInView });
        }
        return cells;
    });
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
    //
    // Built in shared/colors.js, not here, so the key is sampled from
    // whichever sky model is painting the grid (DR-38). Classic pins
    // SKY_MODEL='wmo', so this returns the same strip it always did.
    return skyLegend();
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
const renderViewToggle = () => {
    document.querySelectorAll('#viewToggle .seg button').forEach(b => {
        b.style.display = settings.views[b.dataset.view] ? '' : 'none';
        b.classList.toggle('active', b.dataset.view === view);
    });
    $('viewToggle').style.display = enabledViews().length > 1 ? '' : 'none';
};
const setView = (v, anim) => {
    const prev = view;
    view = v;
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
    updateDisplay(a);
};

// Re-render everything that depends on a preference.
const applyPrefs = () => {
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
// from the cached payload (which now carries a spare 8th day, so the
// dropped day is replaced in the same frame), then revalidates from
// the network. Self-arming, so it also picks up a timezone that moved
// with a city switch.
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
// UI contract (see shared/README.md): the shared fetch layer calls this
// after a payload lands, to re-arm whatever city-local clocks this variant
// runs against the new timezone. Classic has no hour tick (its current-hour
// marker is only refreshed by a repaint), so the rollover is the whole job.
const armClocks = () => { scheduleDayRollover(); };

// --- Tooltip: shared by grid blocks and legend cells --------------
const TIP_SEL = '.weather-block[data-info], .legend-swatch';
const showTooltip = el => {
    const tooltip = $('tooltip');
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
        const when = `<div class="tip-when"><span class="d">${day.isToday ? 'Today' : day.text} ${dateLabel(day.date)}</span><span class="t">${range}</span></div>`;

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
        const rainBits = [];
        let snowBit = '';
        if (h.pop != null) rainBits.push(`${h.pop}%`);
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
};
// Re-render an open block tooltip after the grid repaints. The mouse
// hasn't moved (no mouseover fires), so swapping city with the keyboard
// would otherwise leave the old city's tooltip on screen. Re-target the
// block at the same grid position and re-show it from fresh state.
const refreshActiveTooltip = () => {
    if (!activeBlock || $('tooltip').style.opacity !== '1') return;
    const el = $('grid').querySelector(
        `.weather-block[data-day="${activeBlock.day}"][data-hour="${activeBlock.hour}"]`);
    if (el) showTooltip(el); else hideTooltip();
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
// Shared navigation steps so swipe and arrow-key gestures stay in
// lockstep. dir +1 = next (↓ / → / swipe down / swipe right);
// dir -1 = previous (↑ / ← / swipe up / swipe left).
// Cycles ★ favorites only (recents are not part of the quick-swap set).
const stepCity = dir => {
    if (!favorites.length) return;
    const n = favorites.length;
    const cur = favorites.findIndex(c => placeKey(c) === placeKey(state.place));
    const base = cur < 0 ? (dir > 0 ? -1 : 0) : cur;
    const c = favorites[(base + dir + n) % n];
    // stable order (no MRU reorder) so it cycles the whole list
    // Vertical wave: next (↓) fills top→bottom, previous (↑) bottom→top.
    if (c && placeKey(c) !== placeKey(state.place)) changeCity(c, false, { type: 'wave', axis: 'y', dir: Math.sign(dir) });
};
const stepView = dir => {
    const enabled = enabledViews();
    if (enabled.length < 2) return;
    const i = enabled.indexOf(view);
    // Horizontal wave: the new view enters from the side it sits on, so
    // next (→ in the toolbar) fills right→left and previous fills left→right.
    setView(enabled[(i + dir + enabled.length) % enabled.length], { type: 'wave', axis: 'x', dir: -Math.sign(dir) });
};

// One-finger swipe on the grid: horizontal cycles views (swipe
// left = next, carousel-style), vertical steps ★ favorites (up =
// previous, down = next, matching ↑/↓). The toggle buttons remain
// the visible state indicator. Guarded (>60px, one axis clearly
// dominant, single finger) so taps and sloppy scrolls never flip.
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
let swipeStart = null;
chart.addEventListener('touchstart', e => {
    swipeStart = e.touches.length === 1
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
chart.addEventListener('touchend', e => {
    if (!swipeStart || e.touches.length) { if (e.touches.length) swipeStart = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.x, dy = t.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
        stepView(dx < 0 ? 1 : -1);        // swipe left = next view, right = previous
    } else if (Math.abs(dy) > 60 && Math.abs(dy) > 2 * Math.abs(dx)) {
        stepCity(dy < 0 ? -1 : 1);        // swipe up = previous city, down = next
    }
    // else: under the swipe threshold, a plain tap. Nothing to do
    // here; the trailing synthetic click opens/pins the tooltip.
});

// Leaving the app (tab hidden, screen locked) shouldn't leave a
// stray unpinned tooltip on screen for whenever the user returns;
// a genuine pin (tap or click) is meant to persist through exactly
// that "step away and come back" case, so it's left alone.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    const t = $('tooltip');
    if (t.style.opacity === '1' && tappedBlock == null) hideTooltip();
});

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
        return;
    }
    if ((e.target.tagName || '') === 'INPUT') return; // don't hijack typing
    // ↑/↓ step the location through ★ favorites (same as a
    // vertical swipe); ←/→ cycle views (same as a horizontal swipe).
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!favorites.length) return;
        e.preventDefault();
        stepCity(e.key === 'ArrowDown' ? 1 : -1);
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
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.loading) fetchWeather();
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
// Arm the local-midnight re-slice. The cached paint above already set
// state.utcOffset for a returning user; first-visit arms again inside
// changeCity once the guessed city resolves, and every fetch re-arms
// with the payload's timezone.
scheduleDayRollover();
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
