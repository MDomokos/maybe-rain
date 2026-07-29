// --- Process Open-Meteo payload (real hours only) -----------------
const processData = payload => {
    state.tz = payload.timezone || state.tz;
    state.utcOffset = payload.utc_offset_seconds || 0; // for city-local sky-event day windows
    const { time, temperature_2m, apparent_temperature, relative_humidity_2m, weather_code, cloud_cover, precipitation, rain, showers, snowfall, precipitation_probability, uv_index, wind_speed_10m, wind_direction_10m, wind_gusts_10m } = payload.hourly;

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
    // DR-6: days fully in the past drop out here, so an old cached
    // payload renders as a shorter week (principle 4), never as a
    // past day relabeled current.
    const today = cityNow().date;
    state.data = []; state.days = [];
    for (const date of Object.keys(byDate).sort()) {
        if (date < today) continue;
        state.data.push(byDate[date]);
        state.days.push({ text: weekdayOf(date), isToday: date === today, date });
    }
};
