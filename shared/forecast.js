// --- Process Open-Meteo payload (real hours only) -----------------
const processData = payload => {
    state.tz = payload.timezone || state.tz;
    state.utcOffset = payload.utc_offset_seconds || 0; // for city-local sky-event day windows
    const { time, temperature_2m, apparent_temperature, relative_humidity_2m, weather_code, cloud_cover, precipitation, rain, showers, snowfall, precipitation_probability, visibility, uv_index, wind_speed_10m, wind_direction_10m, wind_gusts_10m } = payload.hourly;

    // Daily sunrise/sunset (local ISO strings) → per-date {h, m}.
    state.sun = {};
    const daily = payload.daily;
    if (daily?.time) {
        const hm = s => s ? { h: +s.slice(11, 13), m: +s.slice(14, 16) } : null;
        daily.time.forEach((date, i) => {
            state.sun[date] = { rise: hm(daily.sunrise?.[i]), set: hm(daily.sunset?.[i]) };
        });
    }

    // Group by city-local date (Open-Meteo returns local ISO strings).
    // All hours are kept in state (temps in °C); the displayed
    // hour window and unit are applied at render time, so settings
    // changes never need a refetch.
    const byDate = {};
    for (let i = 0; i < time.length; i++) {
        if (temperature_2m[i] == null || weather_code[i] == null) continue; // honesty: skip missing
        const date = time[i].slice(0, 10);
        const h = {
            hour: +time[i].slice(11, 13),
            temp: Math.round(temperature_2m[i]),
            feels: apparent_temperature?.[i] != null ? Math.round(apparent_temperature[i]) : null, // tooltip
            humidity: relative_humidity_2m?.[i] ?? null, // %, tooltip
            pop: precipitation_probability?.[i] ?? null, // null = unknown, never faked
            mm: precipitation?.[i] ?? null,           // mm/h total; warning, tooltip
            // Liquid vs frozen split for the rain-view overlays: lines
            // draw from the liquid part, the white lattice from
            // snowfall. Old cached payloads lack the split (null).
            liquid: (rain?.[i] != null || showers?.[i] != null)
                ? +(((rain?.[i] ?? 0) + (showers?.[i] ?? 0)).toFixed(2)) : null,
            snow: snowfall?.[i] ?? null,              // cm/h
            // Metres. Null on a payload cached before the field was
            // asked for, which is why the texture checks before drawing.
            vis: visibility?.[i] ?? null,
            code: weather_code[i],                    // raw WMO code (hail rings on 96/99)
            cloud: cloud_cover?.[i] ?? null,          // %, for the lines-mode sky base
            uv: uv_index?.[i] ?? null,
            wind: wind_speed_10m?.[i] ?? null,        // km/h; converted at render
            windDir: wind_direction_10m?.[i] ?? null, // bearing the wind comes from
            gust: wind_gusts_10m?.[i] ?? null,        // km/h
            ...conditionFor(weather_code[i], cloud_cover?.[i] ?? 0)
        };
        // (♨ heat / ☀ UV glyphs are applied at render time, so the
        // user's thresholds take effect without a refetch.)
        (byDate[date] = byDate[date] || []).push(h);
    }

    // Only days that actually have data; no fabricated columns.
    //
    // Past days are kept, back to PAST_DAYS before today, so the drawer
    // can be stepped behind today. They used to be dropped here under
    // DR-6, which required that a past day never appear relabeled as
    // current. That requirement still holds; it is now met by labeling
    // instead of by deletion. Every day carries its own date and its own
    // isToday, state.todayIndex records which one is today, and the frame
    // is positioned from that index instead of from 0, so a past day
    // paints as a past day.
    //
    // The trim is measured against today, not against the payload. A
    // payload fetched three days ago still contains three past days, so
    // without the trim the reach behind today would vary with the age of
    // the cache. Trimming here gives a stale payload and a fresh one the
    // same window. A payload with fewer past days than PAST_DAYS still
    // renders short, per principle 4, and is never padded.
    //
    // Past days are kept only when today is in the payload at all. A
    // payload whose newest day is already behind (an entry stale enough
    // that forecastExpired would purge it, or a response that arrived
    // that way) has nothing current to anchor them to, and two dim
    // columns with no today beside them read as a forecast rather than
    // as the absence of one. In that case the old rule stands and the
    // grid renders empty, which the no-data status line then explains.
    const today = cityNow().date;
    const hasToday = !!byDate[today];
    const earliest = hasToday ? dateDaysBefore(today, PAST_DAYS) : today;
    state.data = []; state.days = [];
    state.todayIndex = 0;
    for (const date of Object.keys(byDate).sort()) {
        if (date < earliest) continue;
        if (date === today) state.todayIndex = state.data.length;
        state.data.push(byDate[date]);
        state.days.push({
            text: weekdayOf(date), isToday: date === today, date,
            past: date < today
        });
    }
};
