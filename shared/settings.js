// --- Preferences (the app's only menu) ---------------------------
// settings + view are initialised below, after loadJSON is defined.
let settings, view;

const VIEWS = ['rain', 'temp', 'wind'];
const enabledViews = () => VIEWS.filter(v => settings.views[v]);
{
    const saved = loadJSON(LS_SETTINGS) || {};
    settings = {
        unit: 'C', clock: '24', allHours: false, heatWarn: 35, uvWarn: 8,
        windUnit: 'kmh', legend: true, sunLines: true, dayNotify: true, ...saved,
        // deep-merged so pre-wind saved settings still get defaults
        views: { rain: true, temp: true, wind: true, ...(saved.views || {}) }
    };
}
{
    const saved = loadJSON(LS_VIEW);
    view = VIEWS.includes(saved) && settings.views[saved]
        ? saved : (enabledViews()[0] || 'rain');
}
