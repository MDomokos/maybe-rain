// --- Fetch forecast (Open-Meteo, no API key) ----------------------
const forecastURL = p =>
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${p.latitude}&longitude=${p.longitude}` +
    // `visibility` is the mist texture's field (DR-41). It rides the same
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
    // column. DR-29 planned to coarsen the far days to a daily aggregate
    // on the grounds that hourly data past day 7 does not exist; DR-34
    // measured that and found it false (Open-Meteo returns an
    // hourly-shaped value out to the ceiling, interpolated past a model's
    // native cadence). The coarsening may still be right, but it is a
    // resolution and confidence question, not a data-availability one,
    // and it waits on the confidence pass with the rest of DR-33/35.
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
    // about last night. See Maybe Rain Climatology for where it fits.
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
const setModelRun = meta => { state.modelRun = parseRun(meta); };
const setLocalRun = (meta, model) =>
    { state.localRun = { ...parseRun(meta), slug: model.slug, label: model.label }; };

// Fetch the model-run metadata. Fired in parallel with the forecast
// (never chained after it) and non-blocking: the grid paints first and
// this fills in the freshness line when it lands. Cached in
// localStorage and only re-fetched once the next run is due, so it
// adds no perceptible load. On any failure the line falls back to
// fetch time (see updateStatus).
const fetchModelMeta = async () => {
    // Until the next update is expected, the cached value is still correct.
    if (state.modelRun && Date.now() < state.modelRun.nextUpdate) return;
    try {
        const r = await fetch(META_URL, {
            cache: 'no-store',
            signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
        });
        if (!r.ok) return;
        const meta = await r.json();
        if (!meta?.last_run_initialisation_time) return;
        setModelRun(meta);
        saveJSON(LS_META, meta);
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
    const cache = loadJSON(LS_META_LOCAL) || {};
    const cached = cache[model.slug];
    if (cached?.last_run_initialisation_time) {
        setLocalRun(cached, model);
        if (Date.now() < state.localRun.nextUpdate) return; // cache still within cadence
    } else if (state.localRun?.slug !== model.slug) {
        state.localRun = null; // don't show the previous region's run while fetching
    }
    try {
        const r = await fetch(localMetaURL(model.slug), {
            cache: 'no-store',
            signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
        });
        if (!r.ok) return;
        const meta = await r.json();
        if (!meta?.last_run_initialisation_time) return;
        // The place may have changed regions mid-fetch, discard if so.
        if (localModelFor(state.place.latitude, state.place.longitude)?.slug !== model.slug) return;
        setLocalRun(meta, model);
        saveJSON(LS_META_LOCAL, { ...(loadJSON(LS_META_LOCAL) || {}), [model.slug]: meta });
        if (!state.loading) updateStatus(); // don't clobber "Loading…"/"Updating…"
    } catch { /* offline / CORS / timeout: fall back to global-only line */ }
};

const fetchWeather = async (force = false) => {
    if (state.loading && !force) return;
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
    if (!force && state.data.length && (Date.now() - state.fetchedAt) < FRESH_TIME
        && !staleHorizon(loadForecast(place))) {
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
        // DR-6 layer 2: compare against the cached payload. Identical
        // (most 30-min polls, the models update ~6-hourly): the fetch
        // was real so freshness advances, but the render is skipped
        // entirely; that removes the render burst from no-change polls
        // and post-switch revalidations. Different: the old current
        // rotates into prev (the last payload that actually differed)
        // and qualifying cells pulse once on the render that follows.
        const entry = loadForecast(place);
        const same = entry?.payload && hourlySnapshot(entry.payload) === hourlySnapshot(payload);
        if (same && state.data.length) {
            saveForecast(place, { ...entry, timestamp: state.fetchedAt });
            setLoading(false);
            updateStatus();
        } else {
            if (entry?.payload && !same) {
                state.changed = diffHourly(entry.payload, payload);
                state.pulsePending = Object.keys(state.changed).length > 0;
                saveForecast(place, {
                    timestamp: state.fetchedAt, payload,
                    prev: { timestamp: entry.timestamp, payload: entry.payload }
                });
            } else {
                // First payload for this place (or a recovered paint):
                // nothing differed, so any existing prev stands.
                saveForecast(place, entry?.prev
                    ? { timestamp: state.fetchedAt, payload, prev: entry.prev }
                    : { timestamp: state.fetchedAt, payload });
            }
            // Fresh data present already (cached paint / background poll):
            // blink only the changed cells. Nothing on screen yet: use the
            // pending directional/first-load reveal from the skeleton.
            const hadData = state.data.length > 0;
            processData(payload);
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
