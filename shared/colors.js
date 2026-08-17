// --- Temperature & wind view scales -------------------------------
// One piecewise-linear interpolator over [value, rgb] stops.
const scaleRGB = (stops, t) => {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
        const [t1, c1] = stops[i - 1], [t2, c2] = stops[i];
        if (t <= t2) {
            const f = (t - t1) / (t2 - t1);
            return c1.map((c, j) => Math.round(c + (c2[j] - c) * f));
        }
    }
    return stops[stops.length - 1][1];
};
// DR-17 temperature view: colour by apparent temperature (feels-like,
// Open-Meteo's apparent_temperature) into eight absolute human comfort
// bands, the same edges in every city, so the grid orients across cities
// and weeks instead of self-scaling. Comfort-diverging palette: palest at
// Comfortable, deepening both ways so darkness reads as distance from
// comfortable. Each band carries one prep cue. Danger stays an escalation
// glyph (dangerGlyph), not a band, so a normal Minneapolis winter or
// Florida summer never cries wolf. Edges, colours and cues are locked in
// Maybe Rain/Design/Maybe Rain Temperature.md (5y ERA5, four cities).
const TEMP_BANDS = [
    { max: -8,       rgb: [58, 45, 107],   name: 'Bitter',   cue: 'bundle up - gloves and hat, skip the run' },
    { max: 0,        rgb: [70, 110, 196],  name: 'Freezing', cue: 'below freezing - coat, watch for ice' },
    { max: 8,        rgb: [110, 160, 220], name: 'Cold',     cue: 'warm coat; layers to bike' },
    { max: 13,       rgb: [176, 205, 232], name: 'Cool',     cue: 'light jacket or windbreaker' },
    { max: 22,       rgb: [234, 231, 220], name: 'Comfort',  cue: 'wear whatever - great for a walk or ride' },
    { max: 27,       rgb: [240, 199, 117], name: 'Warm',     cue: 't-shirt and shorts' },
    { max: 32,       rgb: [232, 150, 63],  name: 'Hot',      cue: 'hydrate, shade, you will sweat' },
    { max: Infinity, rgb: [194, 59, 50],   name: 'Very hot', cue: 'extra water, limit midday sun' }
];
// Band for a feels-like °C (lower edge inclusive: -8 is Freezing, 0 is
// Cold). scaleRGB stays for the wind view; temperature no longer ramps.
const bandIndex = feels => {
    const i = TEMP_BANDS.findIndex(b => feels < b.max);
    return i < 0 ? TEMP_BANDS.length - 1 : i;
};
// Snap to the band colour, then shade within the band toward the
// neighbouring band by TEMP_BLEND of the gap (mockup mode 5): the cooler
// half deepens, the warmer half lightens, so the daily trend reads while
// the band step stays visible. 0 would be pure discrete, 0.5 continuous;
// 0.30 keeps band identity with enough gradient to see the swing. The
// outer half of the two end bands keeps deepening toward black, so a -25 °
// cell already looks worse than a -10 ° one before the glyph confirms it.
const TEMP_BLEND = 0.30;
const bandRGB = feels => {
    const i = bandIndex(feels), b = TEMP_BANDS[i];
    const loRaw = i === 0 ? -Infinity : TEMP_BANDS[i - 1].max;
    const lo = isFinite(loRaw) ? loRaw : b.max - 12;
    const hi = isFinite(b.max) ? b.max : lo + 12;
    const p = Math.max(0, Math.min(1, (feels - lo) / (hi - lo)));
    const s = (p - 0.5) * 2; // -1 at the cold edge, +1 at the warm edge
    const target = s < 0
        ? (i > 0 ? TEMP_BANDS[i - 1].rgb : [0, 0, 0])
        : (i < TEMP_BANDS.length - 1 ? TEMP_BANDS[i + 1].rgb : [0, 0, 0]);
    const f = Math.abs(s) * TEMP_BLEND;
    return b.rgb.map((c, j) => Math.round(c + (target[j] - c) * f));
};
// DR-17: danger is an escalation glyph, not a band (rain-parity with the
// heavy-rain warning). On feels-like: frostbite at <= -20 (about 430 h/yr
// in Minneapolis, near-never elsewhere), heat-stress at >= 38 (the real
// heat-index line; ERA5 smooths the tail, live models fire it). The
// first-pass -10 / 32 edges cried wolf on the record and were dropped.
const TEMP_DANGER_COLD = -20, TEMP_DANGER_HOT = 38;
// DR-17 possible-frost buffer: frost and black ice form at reported air
// temps a couple of degrees above zero (surfaces radiate below the 2 m
// air on clear calm nights; advisories fire there, not at 0 °), and the
// buffer also honours the forecast's own uncertainty. Solid line at true
// 0 °, dashed possible-frost at the +2 ° edge, so the marker only appears
// below +2 °.
const FROST_POSSIBLE = 2;
// Wind: calm grey → breeze teal → fresh green → strong gold → gale
// red, anchored in km/h (≈ Beaufort 0 / 3 / 5 / 7 / 9+).
const WIND_STOPS = [[0, [58, 58, 58]], [12, [72, 143, 138]], [29, [80, 200, 120]], [50, [255, 215, 0]], [75, [229, 72, 77]]];
const windRGB = v => scaleRGB(WIND_STOPS, v);
// Open-Meteo reports the bearing the wind comes from; the wind-view
// arrow (MR_ICON.wind, base points up) is rotated to point where it
// blows to: wind from N (octant 0) points down, so rotation is
// octant × 45° + 180°. 8 octants.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const windOctant = d => Math.round(d / 45) % 8;

// --- Conditions: defined in one place -----------------------------
// Ordered scales: gold sun; 3-step grey for cloud cover (fog folds
// into the lightest grey, marked by its ≡ glyph); 3-step blue for
// rain intensity; violet storm; white snow. Grid colors, legend
// strip, and tooltip labels all derive from this array; condition
// data is defined only here, not in CSS or HTML.
const CONDITIONS = [
    { key: 'sunny',         color: '#FFD700', label: 'Sunny',         group: 'sun' },
    { key: 'partly-cloudy', color: '#B0B0B0', label: 'Partly cloudy', group: 'cloud' },
    { key: 'cloudy',        color: '#757575', label: 'Cloudy',        group: 'cloud' },
    { key: 'overcast',      color: '#454545', label: 'Overcast',      group: 'cloud' },
    { key: 'light-rain',    color: '#87CEEB', label: 'Light rain',    group: 'rain' },
    { key: 'moderate-rain', color: '#4169E1', label: 'Rain',          group: 'rain' },
    { key: 'heavy-rain',    color: '#191970', label: 'Heavy rain',    group: 'rain' },
    { key: 'thunderstorm',  color: '#7B2FBE', label: 'Storm',         group: 'storm' },
    { key: 'snow',          color: '#F0F8FF', label: 'Snow',          group: 'snow' }
];
const COND = Object.fromEntries(CONDITIONS.map(c => [c.key, c]));
const PRECIP = new Set(['rain', 'storm', 'snow']); // probability fade applies

// --- Default grid palette: the sky, by WMO code (Maybe Rain Sky
// Palette Explorer) --------------------------------------------------
// Every block is a picture of the sky. Each of the 28 WMO codes maps
// to one of eight sky levels, each with a fixed day colour and a
// warm-neutral night colour: night dims and desaturates the sky rather
// than recolouring it, so no night is blue and blue reads only as rain.
// Three modifiers then run per hour:
//   1. rain codes get a slight blue tint, so the block reads "wet"
//      even before the streak overlay (DR-12/DR-13) is drawn on top,
//   2. cloud cover spreads the brightness around the swatch (clear
//      hours lift, overcast hours ease down), so neighbouring hours
//      read as visibly different without the grid trending dark,
//   3. nightFactor blends each hour between its day and night colour
//      across a twilight window, so the grid eases into night over the
//      sunset/sunrise hour instead of flipping palette in one row.
const SKY_DAY = {
    clear:    [255, 207,  51],
    mclear:   [230, 220, 170],
    partly:   [205, 209, 214],
    cloudy:   [163, 168, 174],
    overcast: [120, 126, 133],
    fog:      [172, 176, 180],
    storm:    [ 70,  26, 120],
    snow:     [240, 248, 255]
};
// A1 (warm dim): dimmed, desaturated versions of the day sky. The
// bright end keeps a faint warmth (a clear night reads as dusk-gold at
// rest, not blue), the greys stay neutral, and brightness falls as the
// sky thickens. Nothing here is blue except a residual violet on storm,
// so the blue rain tint/streaks are the only blue after dark.
const SKY_NIGHT = {
    clear:    [ 88,  76,  54],
    mclear:   [ 80,  74,  62],
    partly:   [ 68,  70,  74],
    cloudy:   [ 58,  60,  64],
    overcast: [ 50,  52,  56],
    fog:      [ 62,  64,  68],
    storm:    [ 40,  28,  52],
    snow:     [150, 156, 168]
};
// WMO code → sky level. Rain / drizzle / freezing precip fall from an
// overcast sky; ordinary showers (80/81) from a brighter broken sky;
// violent showers (82) from overcast; snow codes take the grey they
// fall from (see skyLevelFor, the white lattice is the snow); thunder
// is the violet. Code 3 splits by cover (below), like DR-12. The snow
// level below is kept for reference but the base uses the grey.
const SKY_LEVEL = {
    0: 'clear', 1: 'mclear', 2: 'partly',
    45: 'fog', 48: 'fog',
    51: 'overcast', 53: 'overcast', 55: 'overcast',
    56: 'overcast', 57: 'overcast',
    61: 'overcast', 63: 'overcast', 65: 'overcast',
    66: 'overcast', 67: 'overcast',
    71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
    80: 'cloudy', 81: 'cloudy', 82: 'overcast',
    85: 'snow', 86: 'snow',
    95: 'storm', 96: 'storm', 99: 'storm'
};
// Liquid-precip codes lean the base slightly blue; snow, storm and dry
// skies stay untinted.
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
const RAIN_TINT = [27, 45, 140];   // blue anchor for the wet-sky nudge
const RAIN_TINT_W = 0.12;          // how far toward it (slight)
// Cloud cover spreads each block's brightness around its swatch, so
// neighbouring hours read as visibly different without the grid
// trending dark: overcast eases down a little, clear lifts more.
const CLOUD_DARKEN = 0.06;         // 100% cloud sits this far below the swatch
const CLOUD_LIGHTEN = 0.14;        // 0% cloud sits this far above it
// Snow codes take the grey sky the snow falls from, not a white block:
// the white dot lattice (DR-12) is the snow, and it needs a grey base
// to read. ~97% of snow hours are overcast (Climatology note).
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const skyLevelFor = (code, cloud) => {
    if (code === 3) return (cloud ?? 0) > 90 ? 'overcast' : 'cloudy';
    if (SNOW_CODES.has(code)) {
        const cl = cloud ?? 100;
        return cl > 90 ? 'overcast' : cl > 60 ? 'cloudy' : cl > 25 ? 'partly' : 'clear';
    }
    return SKY_LEVEL[code] || 'cloudy';
};
const mix3 = (a, b, t) => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t);
const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));
const clamp01 = v => Math.max(0, Math.min(1, v));
// A block's "nightness" for the day→night palette blend: 0 in full day,
// 1 in full night, easing linearly across a ±TWILIGHT window either
// side of the day's sunrise/sunset so the grid never flips palette in a
// single row. No sun data (polar edge, missing) → treated as full day.
const TWILIGHT = 1; // hours of half-transition each side of the event
const nightFactor = (hour, sun) => {
    if (!sun || !sun.rise || !sun.set) return 0;
    const rise = sun.rise.h + sun.rise.m / 60;
    const set = sun.set.h + sun.set.m / 60;
    const evening = clamp01((hour - (set - TWILIGHT)) / (2 * TWILIGHT));  // 0→1 across sunset
    const morning = clamp01(((rise + TWILIGHT) - hour) / (2 * TWILIGHT)); // 1→0 across sunrise
    return Math.max(evening, morning);
};
// The default-view colour for one hour: sky level → tint → cloud dim.
// nf (0..1) blends the level's day and night colour, so twilight hours
// sit part-way between instead of snapping over at the sunset row.
const conditionRGB = (h, nf) => {
    const level = skyLevelFor(h.code, h.cloud);
    let c = mix3(SKY_DAY[level], SKY_NIGHT[level], nf);
    if (RAIN_CODES.has(h.code)) c = mix3(c, RAIN_TINT, RAIN_TINT_W);
    const cl = h.cloud;
    const f = cl == null ? 1
        : 1 + CLOUD_LIGHTEN * (1 - cl / 100) - CLOUD_DARKEN * (cl / 100);
    return c.map(v => clamp255(v * f));
};

// --- Sky model B: the sky as seen overhead (DR-38) -----------------
// Everything above this line is model A (DR-14) and is frozen: classic
// selects it, and research/test-lines.mjs pins its exact output.
//
// Model A asks the weather code which of eight colours to use. Model B
// asks two questions with two different answers, and gives each its own
// channel:
//
//   value  = the clearness index Kt, how much light reaches the ground
//   chroma = the sunshine fraction, whether the sun's disc was visible
//
// Brightness belongs to Kt alone. The sun tint is built at the neutral's
// own value, so tinting can never change how bright a block is; mixing
// toward a fixed gold instead collapses every sunlit hour onto one
// yellow no matter how bright the sky actually was.
//
// The rule that keeps the palette clean: chroma is shed BEFORE value
// moves or hue shifts. The gold means "the sun is on you", and once it
// is raining or storming that is no longer the story. Darkening a
// saturated gold gives brown; mixing one toward navy gives tan. Both are
// the same failure as a straight gold-to-grey ramp, which passes through
// olive for the same reason.
//
// Constants tuned by eye against live data (Maybe Rain Live Palette
// Comparison, 2026-08-13) and re-checked numerically: monotonic in Kt,
// zero muddy results across 157k condition combinations, worst streak
// contrast 3.5:1 against DR-13's 3.0 floor.
const SKY = {
    gold: 1.00,          // how gold a fully sunlit hour goes
    sunContrast: 1.80,   // S-curve on the sunshine axis; 1 = linear
    goldGate: 0.37,      // Kt below which sunshine buys no gold at all
    overcastLift: 1.06,  // dry overcast reads as bright cloud, not grey
    stormFloor: 1.20,    // scales the darkest anchor
    stormCap: 0.35,      // a storm hour may not render brighter than this
    rainBlue: 0.40,      // navy tint weight at full amount x chance
    desatLead: 1.6       // chroma is shed this much faster than value falls
};
// Neutral value ramp on Kt. The sunny end (0.50-0.78) is spread out on
// purpose: brilliant clear and hazy sun are both "sunny" and look very
// different, so Kt needs room to move between them. Anchors are the
// published clearness bands: clear ~0.70-0.78, thin cloud ~0.5-0.6,
// broken ~0.35-0.45, overcast stratus ~0.16-0.24, rain ~0.10-0.14,
// deep storm ~0.04-0.08.
const SKY_RAMP = [
    [0.00, [44, 48, 56].map(v => v * SKY.stormFloor)],
    [0.10, [74, 80, 88]],
    [0.16, [112, 119, 127]],
    [0.24, [150, 157, 165].map(v => v * SKY.overcastLift)],
    [0.35, [180, 187, 194]],
    [0.50, [210, 216, 221]],
    [0.62, [234, 238, 242]],
    [0.78, [252, 253, 255]]
];
const SUN_GOLD = [255, 201, 46];
const NIGHT_CLEAR = [84, 72, 50], NIGHT_THICK = [30, 32, 38];
const STORM_CODES = new Set([95, 96, 99]);
const FOG_CODES = new Set([45, 48]);

const skyLum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
// Luminance-preserving desaturation, with a slight cool cast so a sky
// that loses its sun reads as overcast rather than as flat grey.
const coolGrey = c => {
    const l = skyLum(c), t = [l * 0.95, l * 0.99, l * 1.06], tl = skyLum(t);
    return tl === 0 ? [0, 0, 0] : t.map(v => v * (l / tl));
};
const desat = (c, t) => mix3(c, coolGrey(c), clamp01(t));
// Symmetric contrast curve, fixed at 0, 0.5 and 1. Sharpens "sun out"
// versus "sun behind cloud" into a category without reintroducing a
// threshold at some arbitrary cloud percentage. k = 1 is exactly linear.
const sunCurve = (s, k) => {
    if (k === 1) return s;
    const a = Math.pow(s, k), b = Math.pow(1 - s, k);
    return (a + b) === 0 ? s : a / (a + b);
};
const neutralSky = kt => {
    const k = clamp01(kt / 0.78) * 0.78;
    for (let i = 1; i < SKY_RAMP.length; i++) {
        if (k <= SKY_RAMP[i][0] || i === SKY_RAMP.length - 1) {
            const [k0, c0] = SKY_RAMP[i - 1], [k1, c1] = SKY_RAMP[i];
            return mix3(c0, c1, clamp01((k - k0) / (k1 - k0)));
        }
    }
};
// Kt and sunshine come from the payload when it carries them, and are
// estimated from cloud cover and the weather code when it does not. The
// estimator is not a nicety: radiation coverage varies by model and
// region, and every payload cached before this shipped lacks the fields.
// It is also the whole of step 1 of the rollout, which adds no API
// fields at all.
//
// For a dry hour Open-Meteo derives weather_code by thresholding
// cloud_cover and nothing else, so the code caps the band and the cover
// positions the hour inside it. That is the best cloud-only
// reconstruction available; what it cannot do is separate a bright thin
// overcast from a dark thick lid, which is exactly what the measured
// ratio adds.
const KT_NIGHT_FLOOR = 20; // W/m2 top-of-atmosphere; below this Kt is noise
const ktFor = h => {
    if (h.sw != null && h.terr != null && h.terr > KT_NIGHT_FLOOR)
        return clamp01(h.sw / h.terr);
    if (STORM_CODES.has(h.code)) return 0.05;
    if (FOG_CODES.has(h.code)) return 0.14;
    if (SNOW_CODES.has(h.code)) return 0.12;
    if (RAIN_CODES.has(h.code))
        return (h.mm ?? 0) >= 2 ? 0.09 : (h.mm ?? 0) >= 0.3 ? 0.13 : 0.17;
    const c = h.code;
    const ceil = c === 0 ? 0.76 : c === 1 ? 0.58 : c === 2 ? 0.40 : 0.22;
    const floor = c === 0 ? 0.68 : c === 1 ? 0.44 : c === 2 ? 0.26 : 0.16;
    const lo = c === 0 ? 0 : c === 1 ? 20 : c === 2 ? 50 : 80;
    const span = c === 0 ? 20 : c === 1 ? 30 : c === 2 ? 30 : 20;
    return ceil + (floor - ceil) * clamp01(((h.cloud ?? 0) - lo) / span);
};
const sunFor = h => {
    if (h.sunSec != null) return clamp01(h.sunSec / 3600);
    if (STORM_CODES.has(h.code) || FOG_CODES.has(h.code)
        || SNOW_CODES.has(h.code) || RAIN_CODES.has(h.code)) return 0;
    return Math.pow(clamp01(1 - (h.cloud ?? 0) / 100 / 0.80), 0.8);
};
// The model-B colour for one hour. nf is the same day/night blend
// factor model A uses, so twilight behaviour is unchanged.
const skyRGB = (h, nf) => {
    const kt = ktFor(h), n = neutralSky(kt);
    const V = Math.max(n[0], n[1], n[2]);
    const goldAtV = SUN_GOLD.map(v => v * (V / 255));
    const gate = clamp01((kt - SKY.goldGate) / 0.25);
    const s = sunCurve(sunFor(h), SKY.sunContrast);
    const day = mix3(n, goldAtV, s * SKY.gold * gate);
    const night = mix3(NIGHT_THICK, NIGHT_CLEAR, clamp01(kt / 0.78));
    let c = mix3(day, night, nf);
    // Storms do not override the colour: the base stays physical and the
    // hazard rides the glyph (DR-31). The cap exists only so a distant or
    // high-based cell in an otherwise bright sky cannot read as a nice
    // day. Chroma is shed first, or capping a golden sky yields brown.
    if (STORM_CODES.has(h.code) && SKY.stormCap < 1) {
        const maxL = SKY.stormCap * 255, l = skyLum(c);
        if (l > maxL) {
            c = desat(c, (1 - maxL / l) * SKY.desatLead);
            const l2 = skyLum(c);
            if (l2 > maxL) c = c.map(v => v * (maxL / l2));
        }
    }
    // Rain: drop the sun-gold, then tint. Scaled by amount x chance, so a
    // likely soaking tints far more than a possible sprinkle (model A
    // applies a flat 12% to both).
    if (RAIN_CODES.has(h.code) || (STORM_CODES.has(h.code) && h.mm > 0)) {
        const t = Math.pow(Math.min(h.mm ?? 0, 8) / 8, 0.5);
        const w = SKY.rainBlue * t * clamp01((h.pop ?? 100) / 100);
        if (w > 0) c = mix3(desat(c, w * SKY.desatLead), RAIN_TINT, w);
    }
    return c.map(clamp255);
};
// A model-B swatch at a chosen clearness and sunshine, for the legend.
// Forces the measured path so Kt is exact, and uses a dry clear code so
// no rain or storm branch fires.
const skySample = (kt, sun) =>
    skyRGB({ code: 0, cloud: 0, mm: 0, pop: 0, sw: kt * 1000, terr: 1000, sunSec: sun * 3600 }, 0);

// --- The one dispatch point ---------------------------------------
// SKY_MODEL comes from the variant's config.js, which loads ahead of
// shared/ for exactly this reason (the same inversion api.js relies on
// for FORECAST_DAYS). 'radiance' is DR-38; 'wmo' is DR-14, kept
// runnable in classic as the reference implementation.
const skyBaseRGB = SKY_MODEL === 'radiance' ? skyRGB : conditionRGB;

// The rain-view legend strip, derived from whichever model is active, so
// the key can never teach a palette the grid is not painting. Both
// variants' legendSteps() call this rather than building the strip
// themselves. The wmo branch reproduces the pre-DR-38 strip exactly.
// lnBlue picks the hatch blue by the swatch's own luminance, which is
// the same rule the streaks follow on the grid.
const skyLegend = () => {
    // The radiance anchors are chosen so the strip reads as one ramp in
    // the order the model actually works: chroma drains first (gold ->
    // pale gold -> white, as the sun goes in) and only then does value
    // fall (white -> grey -> slate, as the cloud thickens). Sampling on
    // Kt alone would put a pale hazy swatch brighter than the gold one,
    // since a saturated gold is intrinsically darker than near-white.
    const s = SKY_MODEL === 'radiance'
        ? { sun: skySample(0.74, 1), thin: skySample(0.52, 0.8), cloud: skySample(0.36, 0.15),
            over: skySample(0.22, 0), storm: skySample(0.05, 0) }
        : { sun: SKY_DAY.clear, thin: SKY_DAY.partly, cloud: SKY_DAY.cloudy,
            over: SKY_DAY.overcast, storm: SKY_DAY.storm };
    const b = lnBlue(s.cloud);
    const hatch = `repeating-linear-gradient(118deg, rgba(${b[0]},${b[1]},${b[2]},0.85) 0 1.6px, transparent 1.6px 8px), rgb(${s.cloud})`;
    const dots = `radial-gradient(rgba(255,255,255,0.92) 1px, rgba(0,0,0,0) 1.4px) 0 0 / 7px 7px, rgb(${s.over})`;
    return [
        { bg: `rgb(${s.sun})`, label: 'sun' },
        { bg: `rgb(${s.thin})`, label: '' },
        { bg: `rgb(${s.cloud})`, label: 'cloud' },
        { bg: `rgb(${s.over})`, label: '' },
        { bg: hatch, label: 'rain' },
        { bg: dots, label: 'snow' },
        { bg: `rgb(${s.storm})`, label: 'storm' }
    ];
};

// Hazard markers: redundant non-color icons for hazards only, never
// ordinary data. Vocabulary of five (DR-10): storm (lightning, incl.
// hail), fog, and freeze (freezing rain/drizzle) are weather-coded
// below; heat (extreme heat) and uv (very-high UV) are threshold
// hazards applied at render time by value, not code. Every applicable
// one shows, packed into the block corner (rarely more than two).
// Values are MR_ICON keys; the render turns them into inline SVGs.
const HAZARD_GLYPH = {
    95: 'storm', 96: 'storm', 99: 'storm',            // thunderstorm / hail
    45: 'fog', 48: 'fog',                             // fog, visibility hazard
    56: 'freeze', 57: 'freeze', 66: 'freeze', 67: 'freeze' // freezing precipitation
};
// A legend cell carries an icon only when every code mapping to it has
// the same one (storm on the thunderstorm cell); exceptional hazards
// (fog, freezing rain) mark blocks, not legend cells. Returns the
// shared MR_ICON key, or ''.
const glyphFor = key => {
    const glyphs = Object.entries(WMO)
        .filter(([, [k]]) => k === key)
        .map(([code]) => HAZARD_GLYPH[code] || '');
    return glyphs.length && glyphs.every(g => g && g === glyphs[0]) ? glyphs[0] : '';
};

// Blocks/legend cells get an inline background + a black or white
// glyph color picked by luminance.
const hexRGB = hex => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
};
const textOn = rgb =>
    (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.55 ? '#000' : '#fff';

// --- Rain probability fade ---------------------------------------
// Precipitation blocks fade toward a dark navy (not black) as the
// probability drops, so a 30%-chance shower stays clearly blue and
// is not mistaken for the cloudy greys. Solid hue = certain rain.
const NAVY = [13, 32, 77];
const fadeRGB = (hex, pop) => {
    const w = 0.35 + 0.65 * Math.max(0, Math.min(100, pop)) / 100;
    return hexRGB(hex).map((c, i) => Math.round(NAVY[i] + (c - NAVY[i]) * w));
};

// --- Rain view: sky base + rain-streak overlay (DR-12/DR-13/DR-14) --
// The block colour is the sky (conditionRGB above: the WMO sky palette,
// rain-tinted, cloud-spread, night after local sunset), and rain lives
// entirely in a streak overlay drawn on top. Chance = left-to-right
// fill extent (nothing below 8%); intensity = one density/weight ramp
// (gamma 0.4, capped at 8 mm) under texture bands: below 0.3 mm a faint
// trace tick when the chance clears 8% (a likely light sprinkle the
// amount misses, since chance is the ensemble and amount the
// deterministic run), then ticks to 1, broken runs to 2, solid above;
// line colour = a luminance-tuned blue (DR-13), so "blue = rain" reads.
// No base escalation (owner call): heavy rain saturates the density and
// adds a warning mark above 20 mm, and a genuine storm is already the
// violet by weather code, so the base holds the sky. Lines lean with
// the wind: angle = 55deg x clamp(E-W wind component / 40 km/h),
// calibrated on 5y wet-hour data (p50 ~11deg, p90 ~21-28deg, saturation
// only at 5-year extremes). The frozen family: snow = constant white
// dot lattice from snowfall cm/h (no floor, cap 2 cm/h, half wind lean)
// on the cloud-derived grey; lines + lattice together on a mixed hour
// IS sleet; hail (WMO 96/99, category only) = sparse open rings, full
// width. Fog and freezing rain stay corner glyphs; uncertainty hatch is
// earmarked and owns no texture.
// Config locked 2026-07-24 (Maybe Rain Precipitation + Climatology).
const LN = { sp0: 15, sp1: 4.7, sw0: 0.85, sw1: 2.6, gamma: 0.4, cap: 8,
             floor: 0.3, b1: 1, tlen: 3.7, tgap: 5.1, b2: 2, blen: 14, bgap: 6,
             shade: 0.5, alpha: 0.6, popFloor: 8, warn: 20,
             traceSp: 16, traceLen: 2.5, traceGap: 7, traceSw: 0.7, traceAlpha: 0.55,
             maxAngle: 55, windSat: 40,
             snowCap: 2 }; // cm/h; the 5y Budapest max (Climatology note)
const lnLum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const lnMix = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
// Hail rings borrow a neutral adaptive shade of the base (frozen, not
// rain, so not blue): darken a bright base, lighten a dark one.
const lnShade = b => lnLum(b) > 135 ? lnMix(b, [0, 0, 0], LN.shade) : lnMix(b, [255, 255, 255], LN.shade);
// DR-13: rain lines are blue, contrast-tuned to the background by
// luminance band. Deep steel-blue on light skies (gold, the light
// greys), pale steel-blue on the dark ones (dark greys, storm violet,
// the night palette), so the streaks stay legible everywhere and read
// as "blue = rain". Line colour carries no data; density does.
const LN_BLUE_HI = [20, 54, 110];   // deep, on bright bases (lum > 135)
const LN_BLUE_LO = [206, 228, 247]; // pale, on dark bases
const lnBlue = base => lnLum(base) > 135 ? LN_BLUE_HI : LN_BLUE_LO;
// Wind lean: signed E-W component of travel (wind blows toward
// dir+180), linear to 55deg at a 40 km/h component. Positive SVG
// rotation = drifting east. No wind data = vertical fall.
const windLean = h => {
    if (h.wind == null || h.windDir == null) return 0;
    const u = h.wind * Math.sin((h.windDir + 180) * Math.PI / 180);
    return LN.maxAngle * Math.max(-1, Math.min(1, u / LN.windSat));
};
let lnId = 0; // unique per-render pattern ids
// The streak overlay for one block, or ''. The wrapper span is the
// chance channel (width = pop%, anchored left, bare front edge); the
// SVG pattern is the intensity channel. Chance unknown = full width
// (the amount is a real forecast; the chance channel is just absent).
const rainLinesSVG = (h, base) => {
    // Lines draw from the liquid part only (rain + showers); the
    // white lattice carries the frozen part. Old cached payloads
    // lack the split: fall back to total mm, except on snow-coded
    // hours where drawing rain lines would misrepresent.
    const liquid = h.liquid ?? (COND[h.condition].group === 'snow' ? null : h.mm);
    if (liquid == null) return '';
    const c = lnBlue(base); // DR-13: blue, tuned to the base luminance
    const ang = windLean(h).toFixed(1);
    const id = 'mrln' + (lnId++);
    let pat, wp;
    if (liquid < LN.floor) {
        // Trace tier: the amount is below the 0.3 mm floor (often ~0),
        // but the chance is real. Amount is the deterministic run;
        // chance is the ensemble (P > 0.1 mm), so a high chance with
        // ~0 mm is a likely light sprinkle the amount misses (Open-
        // Meteo). Draw the chance as the fill, with the faintest,
        // sparsest tick, below the drizzle band, so it stops vanishing.
        // Chance-driven: it needs a real pop to fire, and it is liquid
        // rain only, so a snow-coded hour draws nothing here (its
        // precipitation is the white lattice, not a rain trace).
        if (COND[h.condition].group === 'snow') return '';
        if (h.pop == null || h.pop < LN.popFloor) return '';
        const col = `rgba(${c[0]},${c[1]},${c[2]},${LN.traceAlpha})`;
        const per = (LN.traceLen + LN.traceGap).toFixed(2);
        const x = (LN.traceSp / 2).toFixed(2);
        pat = `<pattern id="${id}" width="${LN.traceSp.toFixed(2)}" height="${per}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})"><line x1="${x}" y1="-${per}" x2="${x}" y2="${(2 * (LN.traceLen + LN.traceGap)).toFixed(2)}" stroke="${col}" stroke-width="${LN.traceSw}" stroke-dasharray="${LN.traceLen} ${LN.traceGap}"/></pattern>`;
        wp = Math.min(100, h.pop);
    } else {
        if (h.pop != null && h.pop < LN.popFloor) return '';
        const t = Math.pow(Math.min(liquid, LN.cap) / LN.cap, LN.gamma);
        const sp = LN.sp0 + (LN.sp1 - LN.sp0) * t;
        const sw = LN.sw0 + (LN.sw1 - LN.sw0) * t;
        const col = `rgba(${c[0]},${c[1]},${c[2]},${LN.alpha})`;
        let dl = 0, dg = 0; // dash pattern: ticks, then broken runs, then solid
        if (liquid < LN.b1) { dl = LN.tlen; dg = LN.tgap; }
        else if (liquid < LN.b2) { dl = LN.blen; dg = LN.bgap; }
        if (dl > 0) { // two columns, dash phase staggered so breaks never align
            const per = dl + dg;
            const line = (x, off) =>
                `<line x1="${x.toFixed(2)}" y1="${(-per).toFixed(2)}" x2="${x.toFixed(2)}" y2="${(2 * per).toFixed(2)}" stroke="${col}" stroke-width="${sw.toFixed(2)}" stroke-dasharray="${dl} ${dg}" stroke-dashoffset="${off.toFixed(2)}"/>`;
            pat = `<pattern id="${id}" width="${(sp * 2).toFixed(2)}" height="${per.toFixed(2)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})">${line(sp / 2, 0)}${line(sp * 1.5, per / 2)}</pattern>`;
        } else {
            pat = `<pattern id="${id}" width="${sp.toFixed(2)}" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})"><line x1="${(sp / 2).toFixed(2)}" y1="-2" x2="${(sp / 2).toFixed(2)}" y2="16" stroke="${col}" stroke-width="${sw.toFixed(2)}"/></pattern>`;
        }
        wp = h.pop == null ? 100 : Math.min(100, h.pop);
    }
    return `<span class="rain-ov" style="width:${wp}%"><svg xmlns="http://www.w3.org/2000/svg"><defs>${pat}</defs><rect width="100%" height="100%" fill="url(#${id})"/></svg></span>`;
};
// Snow: a staggered lattice of constant-white dots (snow is white,
// and it lands on the overcast grey in ~97% of snow hours, per the
// Climatology note). No amount floor: any snowfall draws. Density
// and dot size ramp on cm/h (same gamma, cap 2 cm/h = the 5y max);
// fill = chance as for rain; wind lean at half strength (flakes
// drift, lines fall). A rainy-and-snowy hour stacks both overlays:
// that IS the sleet encoding, no extra vocabulary.
const snowLatticeSVG = h => {
    if (h.snow == null || h.snow <= 0) return '';
    if (h.pop != null && h.pop < LN.popFloor) return '';
    const t = Math.pow(Math.min(h.snow, LN.snowCap) / LN.snowCap, LN.gamma);
    // The tile is square with the two dots on its diagonal, so every dot
    // clears the tile edge by 0.5sp — always more than r — and the grid
    // draws whole circles. The first version tiled sp x 2sp with the
    // second dot at 0.05sp, hard against the edge, so the pattern cut it
    // and every other flake in the grid was a half moon. sp is divided by
    // root 2 because a square tile holds the same two dots over twice the
    // area, which would otherwise halve the density.
    const sp = (14 - (14 - 5.2) * t) / Math.SQRT2, r = 0.8 + 0.8 * t;
    const ang = (windLean(h) * 0.5).toFixed(1);
    const id = 'mrsn' + (lnId++);
    const dot = (cx, cy) => `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="rgba(255,255,255,0.92)"/>`;
    const pat = `<pattern id="${id}" width="${(sp * 2).toFixed(2)}" height="${(sp * 2).toFixed(2)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})">${dot(sp * 0.5, sp * 0.5)}${dot(sp * 1.5, sp * 1.5)}</pattern>`;
    const wp = h.pop == null ? 100 : Math.min(100, h.pop);
    return `<span class="rain-ov" style="width:${wp}%"><svg xmlns="http://www.w3.org/2000/svg"><defs>${pat}</defs><rect width="100%" height="100%" fill="url(#${id})"/></svg></span>`;
};
// Hail (WMO 96/99): sparse open rings, full width. A category with
// no quantity anywhere in Open-Meteo, so a fixed texture, never a
// ramp. Rings (open, larger, adaptive shade) vs snow dots (filled,
// small, white) keeps the frozen family related but unconfusable;
// storm violet and lightning ride the same block.
const HAIL_CODES = new Set([96, 99]);
const hailRingsSVG = (h, base) => {
    if (!HAIL_CODES.has(h.code)) return '';
    const c = lnShade(base);
    const id = 'mrhl' + (lnId++);
    const ring = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="2.2" fill="none" stroke="rgba(${c[0]},${c[1]},${c[2]},0.9)" stroke-width="0.9"/>`;
    const pat = `<pattern id="${id}" width="18" height="18" patternUnits="userSpaceOnUse">${ring(4.5, 4.5)}${ring(13.5, 13.5)}</pattern>`;
    return `<span class="rain-ov"><svg xmlns="http://www.w3.org/2000/svg"><defs>${pat}</defs><rect width="100%" height="100%" fill="url(#${id})"/></svg></span>`;
};
