// --- localStorage persistence ------------------------------------
const placeKey = p => `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
const loadJSON = key => {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const saveJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full/blocked: non-fatal */ }
};

// --- Per-place forecast cache -------------------------------------
// One entry per place, keyed by placeKey. An entry leaves the cache
// three ways only, never by wall-clock age: superseded (a fetch
// overwrites it), orphaned (its place leaves favorites ∪ recents ∪
// the place on screen, so no UI path reaches it), or fully expired
// (its last forecast hour is in the past, place-local, so nothing
// honest can be rendered). Old-but-labeled data answers something;
// a purged cache answers nothing.
const forecastCacheKey = p => `${LS_FORECAST}:${placeKey(p)}`;
const loadForecast = p => loadJSON(forecastCacheKey(p));
// Every write stamps the horizon the payload was fetched with, so there
// is one place to keep it honest rather than four call sites.
const saveForecast = (p, entry) =>
    saveJSON(forecastCacheKey(p), { ...entry, days: FORECAST_DAYS, pastDays: PAST_DAYS });
// Fully expired: the payload's hourly times are place-local ISO
// strings and it carries utc_offset_seconds, so "is the last hour in
// the past?" is a string compare against place-local now. For a
// 7-day payload this fires ~7 days after fetch.
// An entry also carries the horizon it was fetched with, because that is
// the one thing about a cached payload that can go out of date without
// the payload itself being wrong. When the drawer's reach grows, every
// cached entry is still perfectly good data covering a shorter span, and
// the freshness window would otherwise hold it for another 10 minutes
// while the drawer sat clamped at whatever the old payload happened to
// reach. So a short horizon is not a cache miss (the entry still paints
// instantly, principle 6) but it does force the revalidation through,
// regardless of freshness. Recorded rather than measured from the payload
// on purpose: measuring would re-fire every day as the payload ages past
// its own horizon, where this fires exactly once per place, on the first
// load after the reach changed. Entries written before this existed have
// no `days` and read as 0, which is correct, they predate it.
//
// `pastDays` is the same check on the other end of the horizon. Entries
// written before the drawer could reach behind today hold no past hours
// and read as 0, so the first load after this shipped revalidates once
// per place instead of leaving the drawer clamped at a reach the user
// can see is wrong. Both ends are checked because an entry from the
// previous build is long forward and short backward, and that is the
// case that must not be held for the rest of the freshness window.
const staleHorizon = entry =>
    (entry?.days || 0) < FORECAST_DAYS || (entry?.pastDays || 0) < PAST_DAYS;
const forecastExpired = entry => {
    const t = entry?.payload?.hourly?.time;
    if (!t?.length) return true;
    const offset = entry.payload.utc_offset_seconds || 0;
    const localNow = new Date(Date.now() + offset * 1000).toISOString().slice(0, 16);
    return t[t.length - 1] < localNow;
};
// Sweep: drop every entry that is orphaned or fully expired. The
// keep-set includes the current place even when it is in neither
// list (a timezone guess or favorite cycling arrives with
// remember=false), since it is on screen and its cache serves the
// next open. Called at startup (off the critical path) and at the
// membership-removal points: ✕ dismiss, MRU eviction, unfavorite.
const sweepForecasts = () => {
    const keep = new Set([...favorites, ...savedCities, state.place].map(placeKey));
    const prefix = `${LS_FORECAST}:`;
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith(prefix)) continue;
            if (!keep.has(k.slice(prefix.length)) || forecastExpired(loadJSON(k))) {
                localStorage.removeItem(k);
            }
        }
    } catch { /* blocked storage: non-fatal */ }
};
// Change history is keyed by model run, not by poll. Two
// payloads count as the same run when the hourly arrays that drive
// the grid are identical; string equality on ~9 KB is microseconds,
// so no hash function (principle 5: less code).
//
// `precipitation` is in the list for the past days. When a payload is
// identical by this measure the new one is DISCARDED and the cached one
// kept (see fetchWeather), so anything left out of it can go stale in
// the cache indefinitely. For forecast hours that was harmless, since
// amount and probability move together. For a past hour it is not:
// probability is the retained forecast and does not move once the hour
// has happened, the weather code is coarse enough that a revised total
// can stay inside the same code, and temperature settles early. So a
// revision that only sharpens how much fell overnight, which is the one
// number a past day exists to answer, could otherwise report as no
// change and be thrown away. Costs one more array in a stringify that
// already walks four, and does not defeat the no-change skip: amounts
// are quantized to 0.1 mm and identical across polls of the same run.
const hourlySnapshot = p => JSON.stringify([
    p.hourly.time, p.hourly.temperature_2m, p.hourly.weather_code,
    p.hourly.precipitation_probability, p.hourly.precipitation,
    p.hourly.wind_speed_10m
]);
// Cells present in both payloads whose delta crosses a per-view
// threshold, as "date|hour" → {pop|temp|wind: [was, now]}.
const diffHourly = (oldP, newP) => {
    const o = oldP.hourly, n = newP.hourly;
    const at = new Map(o.time.map((t, i) => [t, i]));
    const moved = (a, b, min) => a != null && b != null && Math.abs(a - b) >= min;
    const out = {};
    for (let i = 0; i < n.time.length; i++) {
        const j = at.get(n.time[i]);
        if (j == null) continue;
        const d = {};
        if (moved(n.precipitation_probability?.[i], o.precipitation_probability?.[j], CHANGE_POP))
            d.pop = [o.precipitation_probability[j], n.precipitation_probability[i]];
        if (moved(n.temperature_2m?.[i], o.temperature_2m?.[j], CHANGE_TEMP))
            d.temp = [o.temperature_2m[j], n.temperature_2m[i]];
        if (moved(n.wind_speed_10m?.[i], o.wind_speed_10m?.[j], CHANGE_WIND))
            d.wind = [o.wind_speed_10m[j], n.wind_speed_10m[i]];
        if (d.pop || d.temp || d.wind)
            out[`${n.time[i].slice(0, 10)}|${+n.time[i].slice(11, 13)}`] = d;
    }
    return out;
};
// Was/now tooltip lines for a changed cell, in the user's units.
const changeLines = ch => {
    if (!ch) return [];
    const lines = [];
    if (ch.pop) lines.push(`rain ${ch.pop[0]}% → ${ch.pop[1]}%`);
    if (ch.temp) lines.push(`${displayTemp(Math.round(ch.temp[0]))}° → ${displayTemp(Math.round(ch.temp[1]))}°`);
    if (ch.wind) lines.push(`wind ${displayWind(ch.wind[0])} → ${displayWind(ch.wind[1])} ${windUnitLabel()}`);
    return lines;
};

// One-time migration: the legacy single mr-forecast slot becomes the
// keyed entry for its own place, then the old key goes.
{
    const legacy = loadJSON(LS_FORECAST);
    if (legacy?.placeKey && legacy.payload) {
        saveJSON(`${LS_FORECAST}:${legacy.placeKey}`,
            { timestamp: legacy.timestamp, payload: legacy.payload });
    }
    if (legacy) { try { localStorage.removeItem(LS_FORECAST); } catch { /* non-fatal */ } }
}
// heatWarn is anchored in °C; uvWarn is a UV index; ♨/☀ thresholds,
// user-settable in the ⚙ menu because regions differ.
