// --- WMO weather code → CONDITIONS key + exact label ------------
const WMO = {
    0: ['sunny', 'Clear sky'], 1: ['sunny', 'Mainly clear'],
    2: ['partly-cloudy', 'Partly cloudy'],
    // 3 (overcast) resolved via cloud cover below
    // fog folds into the lightest grey; its ≡ glyph marks the hazard
    45: ['partly-cloudy', 'Fog'], 48: ['partly-cloudy', 'Rime fog'],
    51: ['light-rain', 'Light drizzle'], 53: ['light-rain', 'Drizzle'], 55: ['light-rain', 'Dense drizzle'],
    56: ['light-rain', 'Freezing drizzle'], 57: ['light-rain', 'Freezing drizzle'],
    61: ['light-rain', 'Light rain'], 63: ['moderate-rain', 'Rain'], 65: ['heavy-rain', 'Heavy rain'],
    66: ['moderate-rain', 'Freezing rain'], 67: ['heavy-rain', 'Freezing rain'],
    71: ['snow', 'Light snow'], 73: ['snow', 'Snow'], 75: ['snow', 'Heavy snow'], 77: ['snow', 'Snow grains'],
    80: ['light-rain', 'Light showers'], 81: ['moderate-rain', 'Showers'], 82: ['heavy-rain', 'Heavy showers'],
    85: ['snow', 'Snow showers'], 86: ['snow', 'Snow showers'],
    95: ['thunderstorm', 'Thunderstorm'], 96: ['thunderstorm', 'Thunderstorm, hail'], 99: ['thunderstorm', 'Thunderstorm, hail']
};
const conditionFor = (code, clouds) => {
    if (code === 3) return clouds > 90
        ? { condition: 'overcast', description: 'Overcast', glyph: '' }
        : { condition: 'cloudy', description: 'Cloudy', glyph: '' };
    const [condition, description] = WMO[code] || ['cloudy', `Unknown (${code})`];
    return { condition, description, glyph: HAZARD_GLYPH[code] || '' };
};

// --- City-local date helpers (weekday + date label) -------------
// (cityParts / cityNow, which read the forecast timezone, live just
// below with the shared city formatter.)
// Weekday index (0 = Sun) for a "YYYY-MM-DD" date, read at UTC midnight
// so the calendar day never shifts by local offset. The two label sets
// (the grid's single letters here, the status line's 3-letter stamp
// below) both index into it.
const dowOf = dateStr => new Date(dateStr + 'T00:00:00Z').getUTCDay();
const DAY_ABBR = ['SU', 'M', 'T', 'W', 'TH', 'F', 'S'];
const weekdayOf = dateStr => DAY_ABBR[dowOf(dateStr)];
// The "YYYY-MM-DD" date n days before another, for the past-day trim in
// processData. Read and written at UTC midnight like the two above, so
// it steps whole calendar days. The strings it is compared against are
// Open-Meteo's own city-local dates, which carry no offset.
const dateDaysBefore = (dateStr, n) => {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = dateStr => {
    const d = new Date(dateStr + 'T00:00:00Z');
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
