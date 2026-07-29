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
// Weather PWA/Maybe Rain Temperature.md (5y ERA5, four cities).
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
    const sp = 14 - (14 - 5.2) * t, r = 0.8 + 0.8 * t;
    const ang = (windLean(h) * 0.5).toFixed(1);
    const id = 'mrsn' + (lnId++);
    const dot = (cx, cy) => `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="rgba(255,255,255,0.92)"/>`;
    const pat = `<pattern id="${id}" width="${sp.toFixed(2)}" height="${(sp * 2).toFixed(2)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})">${dot(sp / 2, sp / 2)}${dot(sp * 0.05, sp * 1.5)}</pattern>`;
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
