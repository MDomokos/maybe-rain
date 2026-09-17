// --- Fetch forecast (Open-Meteo, no API key) ----------------------
const forecastURL = p =>
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${p.latitude}&longitude=${p.longitude}` +
    // `visibility` is the mist texture's field. It rides the same
    // request as everything else and costs nothing extra to ask for.
    '&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,precipitation,rain,showers,snowfall,precipitation_probability,visibility,uv_index,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&daily=sunrise,sunset' +
    // FORECAST_DAYS (15) fetched, 7 columns ever displayed at once
    // (visibleWindow). 14 of them are reachable: the shipped week is lead
    // days 0-6 and the day drawer slides that frame out to lead day 13.
    // The 15th is the rollover spare, as above. Open-Meteo's ceiling is
    // forecast_days=16, so this sits one day inside it.
    //
    // Every day is fetched hourly, on the same request and the same
    // fields as the shipped week, so a revealed column is an ordinary
    // column. Coarsening the far days to a daily aggregate was considered
    // on the grounds that hourly data past day 7 does not exist; measuring
    // it found that false (Open-Meteo returns an hourly-shaped value out
    // to the ceiling, interpolated past a model's native cadence). The
    // coarsening may still be right, but it is a resolution and
    // confidence question, not a data-availability one, and it waits on
    // the confidence pass.
    //
    // past_days extends the same request backward. It is a parameter,
    // not a second call, and the hourly fields and the daily
    // sunrise/sunset come back for the past days on the same terms as
    // the forward ones, so a past column is an ordinary column with
    // ordinary tooltips and sun lines.
    //
    // For the recent past Open-Meteo returns the model's own analysis
    // in place of a pure forecast, which is what makes overnight rain
    // totals worth reading. ERA5 via the archive API is the better
    // record but lags about five days, so it cannot answer anything
    // about last night.
    `&timezone=auto&forecast_days=${FORECAST_DAYS}&past_days=${PAST_DAYS}`;

// Parse the metadata payload (Unix seconds) into ms state. The next
// update is computed from the *actual* previous release: the model's
// last run became available at last_run_availability_time, so the next
// run should release about one update interval after that. This gives a
// real expected time rather than a guess.
const parseRun = meta => {
    const init = meta.last_run_initialisation_time * 1000;
    const interval = (meta.update_interval_seconds || 6 * 3600) * 1000;
    // When the current run actually became available on the API.
    const released = meta.last_run_availability_time
        ? meta.last_run_availability_time * 1000
        : init + 4 * 60 * 60 * 1000; // fallback: typical global publish lag
    return { init, interval, nextUpdate: released + interval };
};
// How often this model publishes, in words, for the freshness tooltip.
// Read from the model's own update_interval_seconds rather than written
// down, since the backbone now changes with the place: ICON and GFS are
// 6-hourly, HRRR is hourly.
const runEvery = run => {
    const h = Math.round((run?.interval || 0) / 3600000);
    return h <= 1 ? 'about every hour' : `about every ${h}h`;
};

const setRun = (meta, model) => ({ ...parseRun(meta), slug: model.slug, label: model.label });
const setModelRun = (meta, model) => { state.modelRun = setRun(meta, model); };
const setLocalRun = (meta, model) => { state.localRun = setRun(meta, model); };

// This key used to hold one model's meta object, back when the global
// model was pinned to ICON. It now holds a map keyed by slug, because
// the global model changes with the place. An old flat value has no slug
// key, so it reads as a miss and the first save replaces it outright,
// rather than leaving its fields loose in the map.
const metaCache = key => {
    const c = loadJSON(key);
    return (c && !c.last_run_initialisation_time) ? c : {};
};

// Fetch the model-run metadata. Fired in parallel with the forecast
// (never chained after it) and non-blocking: the grid paints first and
// this fills in the freshness line when it lands. Cached in
// localStorage and only re-fetched once the next run is due, so it
// adds no perceptible load. On any failure the line falls back to
// fetch time (see updateStatus).
//
// The model is chosen by location, the same way the regional one is, so
// a place in the Americas is told GFS's cycle rather than ICON's. Per
// slug cache, since switching cities can switch backbones.
const fetchModelMeta = async () => {
    const model = globalModelFor(state.place.latitude, state.place.longitude);
    // Have this model's run already and it's still current.
    if (state.modelRun?.slug === model.slug && Date.now() < state.modelRun.nextUpdate) return;
    const cached = metaCache(LS_META)[model.slug];
    if (cached?.last_run_initialisation_time) {
        setModelRun(cached, model);
        if (Date.now() < state.modelRun.nextUpdate) return; // cache still within cadence
    } else if (state.modelRun?.slug !== model.slug) {
        state.modelRun = null; // don't show the previous backbone's run while fetching
    }
    try {
        const r = await fetch(metaURL(model.slug), {
            cache: 'no-store',
            signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
        });
        if (!r.ok) return;
        const meta = await r.json();
        if (!meta?.last_run_initialisation_time) return;
        // The place may have crossed into another backbone mid-fetch.
        if (globalModelFor(state.place.latitude, state.place.longitude).slug !== model.slug) return;
        setModelRun(meta, model);
        saveJSON(LS_META, { ...metaCache(LS_META), [model.slug]: meta });
        if (!state.loading) updateStatus(); // don't clobber "Loading…"/"Updating…"
    } catch { /* offline / CORS / timeout: keep fetch-time fallback */ }
};

// Fetch the regional model's run time for the current place, same
// pattern as fetchModelMeta (parallel, non-blocking, cadence-guarded).
// The model is chosen by location; if none covers it, state.localRun is
// cleared so the line shows the global run alone. Per-slug cache, since
// switching cities can switch regions. Called alongside fetchModelMeta
// on every fetch, so it re-evaluates whenever the place changes.
const fetchLocalMeta = async () => {
    const model = localModelFor(state.place.latitude, state.place.longitude);
    if (!model) { state.localRun = null; return; }
    // Have this model's run already and it's still current.
    if (state.localRun?.slug === model.slug && Date.now() < state.localRun.nextUpdate) return;
    const cached = metaCache(LS_META_LOCAL)[model.slug];
    if (cached?.last_run_initialisation_time) {
        setLocalRun(cached, model);
        if (Date.now() < state.localRun.nextUpdate) return; // cache still within cadence
    } else if (state.localRun?.slug !== model.slug) {
        state.localRun = null; // don't show the previous region's run while fetching
    }
    try {
        const r = await fetch(metaURL(model.slug), {
            cache: 'no-store',
            signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
        });
        if (!r.ok) return;
        const meta = await r.json();
        if (!meta?.last_run_initialisation_time) return;
        // The place may have changed regions mid-fetch, discard if so.
        if (localModelFor(state.place.latitude, state.place.longitude)?.slug !== model.slug) return;
        setLocalRun(meta, model);
        saveJSON(LS_META_LOCAL, { ...metaCache(LS_META_LOCAL), [model.slug]: meta });
        if (!state.loading) updateStatus(); // don't clobber "Loading…"/"Updating…"
    } catch { /* offline / CORS / timeout: fall back to global-only line */ }
};

// Two overrides used to share one `force` flag, and they are not the
// same question. `override` says this fetch outranks one already in
// flight, which is what a city switch needs: the request in the air is
// for the place the user just left. `ignoreFresh` says go to the
// network whatever the freshness test thinks, which is what a manual
// tap, a midnight re-slice and coming back online need. A city switch
// asked for both and only wanted the first, so arriving at a city
// fetched a minute ago refetched it.
// The moment the API can first have something new for this place: the
// earlier of the two predictions, because the regional model drives the
// near-term hours and can publish while the global run still stands.
// Null when neither has answered, which is what the ceiling is for.
const nextExpectedRun = () => {
    const t = [state.modelRun?.nextUpdate, state.localRun?.nextUpdate].filter(Boolean);
    return t.length ? Math.min(...t) : null;
};

// DR-51: whether an automatic fetch can return anything. Three rules, in
// order. Nothing inside the floor, because no model publishes twice in
// ten minutes. Everything past the ceiling, whatever the prediction says
// or fails to say. In between, only from the guard onward.
//
// The retry cadence inside the guard window is the floor doing its
// second job: an identical payload still advances the timestamp, so the
// next attempt is ten minutes out, and the one after that, until the run
// lands. The scheduler decides when to ask; this decides the answer.
const dueForRefetch = entry => {
    const age = Date.now() - entry.timestamp;
    if (age < FRESH_TIME) return false;
    if (age >= REFRESH_CEILING) return true;
    const next = nextExpectedRun();
    return next !== null && Date.now() >= next - REFRESH_GUARD;
};

// The settle retry (DR-51). One pending timer, app-wide: a second run
// flip before the first retry fires replaces it rather than stacking,
// and a payload that lands in the meantime clears it.
let settleTimer = null;
const clearSettle = () => { clearTimeout(settleTimer); settleTimer = null; };

const fetchWeather = async ({ override = false, ignoreFresh = false } = {}) => {
    if (state.loading && !override) return;
    // Pin the place this fetch is for. A mid-flight city switch aborts
    // our controller, but if the response already resolved in the gap
    // before the abort lands, the continuation would otherwise read the
    // *new* state.place and save this payload under the wrong city. Pin
    // it, fetch/load/save against the pin, and bail after the awaits if
    // the user has since moved on.
    const place = state.place;
    fetchModelMeta(); // parallel, non-blocking; self-guards on cadence
    fetchLocalMeta(); // regional run time for this place; self-guards too
    // Fresh enough to skip, unless what is cached was fetched over a
    // shorter horizon than the drawer can now reach: that payload is not
    // stale, it is just short, and holding it for the rest of the
    // freshness window would leave the drawer clamped at a reach the user
    // can see is wrong. Fires once per place, on the first load after the
    // reach changed, then never again.
    //
    // Freshness belongs to this place's own payload, not to whatever was
    // fetched last. A switch to a place with no cache leaves the previous
    // city's data and fetch time sitting in state, and reading those would
    // skip the fetch the new city needs. Before the split above this path
    // never ran on a switch, because every switch passed `force`; it does
    // now, so the test names the entry that is actually on screen.
    const entry = loadForecast(place);
    const showingThisPlace = state.data.length && entry && state.fetchedAt === entry.timestamp;
    if (!ignoreFresh && showingThisPlace && !dueForRefetch(entry) && !staleHorizon(entry)) {
        // An override that skips the network still has to retire the fetch
        // it outranks. That request is for the place the user just left, so
        // its own continuation bails on the place pin and never clears the
        // loading flag; without this, one switch to a freshly fetched city
        // would strand the app in "Updating…" for good.
        if (override && state.loading) { state.controller?.abort(); setLoading(false); }
        updateStatus();
        return;
    }
    setLoading(true);
    let timedOut = false;
    let timer;
    try {
        state.controller?.abort();
        state.controller = new AbortController();
        // Abort a connection that stalls: a hung socket would otherwise
        // spin on "Loading forecast…" forever with no way out.
        timer = setTimeout(() => { timedOut = true; state.controller.abort(); }, FETCH_TIMEOUT);
        const response = await fetch(forecastURL(place), { signal: state.controller.signal });
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const payload = await response.json();
        // Superseded by a city switch while we awaited: drop this result
        // so it can't render under, or be saved against, the place now on
        // screen. The newer fetch owns the loading state, so just return.
        if (place !== state.place) return;
        if (!payload.hourly?.time?.length) throw new Error('Invalid data received');

        state.fetchedAt = Date.now();
        state.lastError = '';   // a good fetch clears any held error
        state.online = true;    // it reached the network, so we're online
        // Change detection: compare against the cached payload. Identical
        // (most 30-min polls, the models update ~6-hourly): the fetch
        // was real so freshness advances, but the render is skipped
        // entirely; that removes the render burst from no-change polls
        // and post-switch revalidations. Different: the old current
        // rotates into prev (the last payload that actually differed)
        // and qualifying cells pulse once on the render that follows.
        // Re-read rather than reusing the one above: an await sat between
        // them, and a fetch for this same place could have written in the gap.
        const cached = loadForecast(place);
        const same = cached?.payload && hourlySnapshot(cached.payload) === hourlySnapshot(payload);
        clearSettle();
        if (same && state.data.length) {
            saveForecast(place, { ...cached, timestamp: state.fetchedAt });
            // A run flip that produced no change is the documented gap
            // between the API announcing a run and every server serving
            // it. One more look 10 minutes on, and then nothing: the
            // second identical payload leaves settleRun where it is, so
            // only the next flip can arm another.
            const init = state.modelRun?.init || 0;
            if (init && init !== state.runAtPayload && init !== state.settleRun) {
                state.settleRun = init;
                settleTimer = setTimeout(() => {
                    settleTimer = null;
                    if (!document.hidden && !state.loading) fetchWeather({ ignoreFresh: true });
                }, SETTLE_RETRY);
            }
            setLoading(false);
            updateStatus();
        } else {
            if (cached?.payload && !same) {
                state.changed = diffHourly(cached.payload, payload);
                state.pulsePending = Object.keys(state.changed).length > 0;
                saveForecast(place, {
                    timestamp: state.fetchedAt, payload,
                    prev: { timestamp: cached.timestamp, payload: cached.payload }
                });
            } else {
                // First payload for this place (or a recovered paint):
                // nothing differed, so any existing prev stands.
                saveForecast(place, cached?.prev
                    ? { timestamp: state.fetchedAt, payload, prev: cached.prev }
                    : { timestamp: state.fetchedAt, payload });
            }
            // Fresh data present already (cached paint / background poll):
            // blink only the changed cells. Nothing on screen yet: use the
            // pending directional/first-load reveal from the skeleton.
            const hadData = state.data.length > 0;
            // The run this payload's contents belong to, so a later
            // identical payload can tell a run flip from an ordinary poll.
            state.runAtPayload = state.modelRun?.init || 0;
            processData(payload);
            // Genuinely new data: the guard above returns early when the
            // payload matches the cached one, so a poll that changes
            // nothing never reaches here. Which is exactly the test for
            // "the current hour has something new to say".
            state.arrivePending = true;
            updateDisplay(hadData ? { type: 'refresh' } : (nextRevealAnim || { type: 'reveal' }));
            nextRevealAnim = null;
            setLoading(false);
            // Re-arm the variant's city-local clocks against this payload's
            // timezone (processData refreshed state.utcOffset). Which clocks
            // exist is a variant question: primary arms a midnight rollover
            // and an hour tick, classic only the rollover. So this goes
            // through the UI contract's armClocks rather than naming them.
            armClocks();
        }
    } catch (error) {
        // A supersede abort (a newer fetch replaced this one) stays silent;
        // a timeout abort is a real failure and must surface.
        if (error.name === 'AbortError' && !timedOut) return;
        if (state.data.length) {
            // Stale data already on screen: no banner. If the device is
            // offline, updateStatus names it ("Offline. Showing last
            // forecast"); otherwise the resting line stays outdated.
            if (!navigator.onLine) state.online = false;
            setLoading(false);
            updateStatus();
        } else {
            // Timeout or network failure → friendly "can't reach" wording;
            // API/parse errors keep the generic retry label.
            const unreachable = timedOut || error.name === 'TypeError';
            showError(unreachable ? "Can't reach service. Retry" : undefined);
        }
    } finally {
        clearTimeout(timer);
    }
};
