const displayTemp = c => settings.unit === 'F' ? Math.round(c * 9 / 5 + 32) : c;
// Wind is stored in km/h (Open-Meteo default); converted at render.
const WIND_UNITS = { kmh: ['km/h', 1], mph: ['mph', 0.621371], kn: ['kn', 0.539957] };
const displayWind = k => Math.round(k * WIND_UNITS[settings.windUnit][1]);
const windUnitLabel = () => WIND_UNITS[settings.windUnit][0];
const hourLabel = h => settings.clock === '12'
    ? `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`
    : `${h}:00`;
// Minute-exact variant for sunrise/sunset.
const timeLabel = (h, m) => settings.clock === '12'
    ? `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
    : `${h}:${String(m).padStart(2, '0')}`;
