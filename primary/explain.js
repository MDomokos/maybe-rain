// explain.js: the three view explainers. Not in the shell; app.js injects this
// and explain.css the first time one is opened, and sw.js warms both into the
// versioned cache after activation.
//
// Every colour, threshold and mark comes from the app through `MR`, so an
// explainer cannot describe a palette the grid is not painting. Opened directly
// (the drafts in scripts/explain-preview/) there is no export and the modules load as plain
// scripts, so the fallback below reads their global lexical bindings instead.
const MR = window.MR || {
    skyBaseRGB, skyRGB, skySample, skyLegend, precipOverlay, conditionFor,
    bandRGB, windRGB, textOn, windOctant, mrIcon, MR_ICON,
    LN, SKY, TEMP_BANDS, COMPASS, FROST_POSSIBLE, TEMP_DANGER_COLD, TEMP_DANGER_HOT
};

// A demo hour with the fields shared/forecast.js fills, so the renderer takes
// the path it takes on real data. `nf` is the day/night blend; 1 is midnight.
const exHour = o => {
    const h = Object.assign({ code: 0, cloud: 0, mm: 0, liquid: null, snow: 0, pop: 0,
                              temp: 12, feels: 12, wind: 6, windDir: 270, uv: 0,
                              vis: 20000, sw: null, terr: null, sunSec: null, nf: 0 }, o);
    if (h.liquid == null) h.liquid = h.snow > 0 ? 0 : h.mm;
    h.condition = MR.conditionFor(h.code, h.cloud).condition;
    return h;
};
const exBlk = (h, w, ht, extra) => {
    const rgb = MR.skyBaseRGB(h, h.nf);
    return `<span class="blk" style="width:${w}px;height:${ht}px;background:rgb(${rgb});`
         + `color:${MR.textOn(rgb)}">${MR.precipOverlay(h, rgb, w, ht)}${extra || ''}</span>`;
};
const exFlat = (rgb, w, ht, inner) =>
    `<span class="blk mid" style="width:${w}px;height:${ht}px;background:rgb(${rgb});`
  + `color:${MR.textOn(rgb)}">${inner || ''}</span>`;
const exGlyph = keys => `<span class="gl">${keys.map(MR.mrIcon).join('')}</span>`;
// The grid's own arrow markup and rotation rule.
const exArrow = dir => `<span class="wind-arrow" style="position:static;`
    + `transform:rotate(${MR.windOctant(dir) * 45 + 180}deg)">${MR.MR_ICON.wind}</span>`;
const exCell = (inner, cap) => `<div class="ex">${inner}<div class="exc">${cap}</div></div>`;

// --- what each board holds ------------------------------------------------
// Four cells wide everywhere, so a cell is the same size on every board.
const exWet = o => exHour(Object.assign({ cloud: 95, wind: 20, windDir: 270, pop: 80 }, o));
const EX_BOARDS = {
    // Every condition a block is painted for: four dry skies, night, three wet.
    sky: () => [
        [exHour({ code: 0, cloud: 5 }), 'clear'],
        [exHour({ code: 2, cloud: 55 }), 'partly'],
        [exHour({ code: 3, cloud: 95 }), 'overcast'],
        [exHour({ code: 45, cloud: 85, vis: 500 }), 'fog'],
        [exHour({ code: 0, cloud: 5, nf: 1 }), 'night'],
        [exWet({ code: 63, mm: 3 }), 'rain'],
        [exWet({ code: 73, mm: 0.2, snow: 2 }), 'snow'],
        [exWet({ code: 95, mm: 6 }), 'storm']
    ],
    amount: () => [
        [exWet({ code: 51, mm: 0.15 }), `under <em>${MR.LN.floor}</em>`],
        [exWet({ code: 53, mm: 0.6 }),  `<em>${MR.LN.floor}–${MR.LN.light}</em>`],
        [exWet({ code: 61, mm: 3 }),    `<em>${MR.LN.light}–${MR.LN.cap}</em>`],
        [exWet({ code: 65, mm: 24 }),   `<em>${MR.LN.warn}+</em> mm`, ['rainwarn']]
    ],
    chance: () => [
        [exWet({ code: 61, mm: 1.5, pop: 10 }),  '<em>10</em>'],
        [exWet({ code: 61, mm: 1.5, pop: 40 }),  '<em>40</em>'],
        [exWet({ code: 61, mm: 1.5, pop: 80 }),  '<em>80</em>'],
        [exWet({ code: 61, mm: 1.5, pop: 100 }), '<em>100</em>%']
    ],
    // What falls on the top row, which way it leans on the bottom.
    kindlean: () => [
        [exWet({ code: 61, mm: 2.5 }), 'rain'],
        [exWet({ code: 73, mm: 0.18, snow: 1.8 }), 'snow'],
        [exWet({ code: 71, mm: 2.2, snow: 1.4 }), 'sleet'],
        [exWet({ code: 96, mm: 3 }), 'hail'],
        [exWet({ code: 61, mm: 2, wind: 3, windDir: 0 }), 'calm'],
        [exWet({ code: 61, mm: 2, wind: 20, windDir: 270 }), 'west'],
        [exWet({ code: 61, mm: 2, wind: 44, windDir: 270 }), 'gale, west'],
        [exWet({ code: 61, mm: 2, wind: 44, windDir: 90 }), 'gale, east']
    ]
};

// --- how the block colour is built ---------------------------------------
// Four cumulative stages, each a live call into the model. skySample forces the
// measured path with a dry clear code, so stage one carries no gold and no
// tint, and the step between two stages is the factor named between them.
// Values chosen so every stage moves visibly; the tint clamps at 8 mm, which is
// also the most the rain step can say.
const CH_KT = 0.62, CH_SUN = 0.7, CH_MM = 8, CH_POP = 95;
const chainSteps = () => {
    const wet = exHour({ code: 65, cloud: 95, mm: CH_MM, pop: CH_POP,
                         sw: CH_KT * 1000, terr: 1000, sunSec: CH_SUN * 3600 });
    return [
        [MR.skySample(CH_KT, 0),       'clearness', `Kt ${CH_KT}`],
        [MR.skySample(CH_KT, CH_SUN),  '+ sun',     `${Math.round(CH_SUN * 100)}% sunshine`],
        [MR.skyRGB(wet, 0),            '+ rain',    `${CH_MM} mm at ${CH_POP}%`],
        [MR.skyRGB(wet, 1),            'night',     'after sunset']
    ];
};
// One factor swept, the other three held still.
const sweepRows = () => {
    const dull = { sw: 450, terr: 1000, sunSec: 720 };
    const clear = { code: 1, cloud: 20, sw: 620, terr: 1000, sunSec: 3060 };
    return [
        ['clearness', [0.05, 0.20, 0.38, 0.58, 0.78].map(k => MR.skySample(k, 0)), 'storm', 'clear'],
        ['sunshine',  [0, 0.25, 0.5, 0.75, 1].map(v => MR.skySample(CH_KT, v)), 'none', 'full'],
        ['rain',      [0, 0.5, 2, 6, 14].map(mm => MR.skyRGB(
                          exHour(Object.assign({ code: mm > 0 ? 63 : 3, cloud: 90, mm, pop: 90 }, dull)), 0)),
                      'dry', '14 mm'],
        ['night',     [0, 0.25, 0.5, 0.75, 1].map(nf => MR.skyRGB(exHour(clear), nf)), 'noon', 'midnight']
    ];
};

// --- the bodies -----------------------------------------------------------
const EX_BODIES = {
    rain: () => `
<p class="intro">A whole week of weather in one glance, hour by hour.
<b>Pull sideways</b> for the days behind and the days ahead.</p>

<div class="sec"><span class="label"><b>01</b> The colour is <em>the sky</em></span>
  <div class="board" data-board="sky"></div>
</div>

<div class="sec"><span class="label"><b>02</b> Four things <em>build that colour</em></span>
  <div class="chain" data-chain="1"></div>
  <p class="note">A block starts as a grey picked by how much sunlight got
  through the cloud, warms toward gold with the sunshine, is pulled toward navy
  by the rain, and dims to a warm dark after sunset, and nothing else moves it.</p>
  <div class="sweep" data-sweep="1"></div>
</div>

<div class="sec"><span class="label"><b>03</b> Length is <em>how much</em></span>
  <div class="board" data-board="amount"></div>
</div>

<div class="sec"><span class="label"><b>04</b> Width is <em>how likely</em></span>
  <div class="board" data-board="chance"></div>
</div>

<div class="sec"><span class="label"><b>05</b> <em>What falls, and which way</em></span>
  <div class="board" data-board="kindlean"></div>
</div>

<div class="sec"><span class="label"><b>06</b> A corner glyph is <em>a hazard</em></span>
  <div class="glyphs" data-glyphs="haz"></div>
</div>`,

    temp: () => `
<p class="intro">The same week, coloured by <b>how it feels</b> outside. Wind chill
and humidity are already in the colour.</p>

<div class="sec"><span class="label"><b>01</b> Eight bands, <em>the same everywhere</em></span>
  <div class="board" data-board="bands"></div>
  <p class="note">The edges are fixed degrees, so a colour means the same thing in
  January as in July, and in every city.</p>
</div>

<div class="sec"><span class="label"><b>02</b> An edge or a glyph is <em>a warning</em></span>
  <div class="board" data-board="ice"></div>
  <div class="glyphs" data-glyphs="temp"></div>
</div>`,

    wind: () => `
<p class="intro">The same week, coloured by <b>wind speed</b>.</p>

<div class="sec"><span class="label"><b>01</b> The colour is <em>the speed</em></span>
  <div class="board" data-board="speed"></div>
  <p class="note">Grey is calm, teal a breeze, green fresh, gold strong, red a gale.</p>
</div>

<div class="sec"><span class="label"><b>02</b> The arrow is <em>where it is going</em></span>
  <div class="board" data-board="rose"></div>
  <p class="note">Forecasts name where wind comes <b>from</b>; the arrow points the
  way it blows, so a block reads like a weather map.</p>
</div>`
};

// --- painting -------------------------------------------------------------
const EX_COLS = 4, EX_RATIO = 0.84;
const EX_GLYPHS = {
    haz: () => [['storm', 'storm'], ['fog', 'fog'], ['freeze', 'freezing rain'],
                ['rainwarn', `over ${MR.LN.warn} mm`]],
    temp: () => [['danger', 'frostbite or heat stress'], ['heat', 'hot'], ['uv', 'strong UV']]
};
const EX_WIND_TICKS = [0, 10, 20, 30, 40, 50, 60, 75];
// The frost contour, on index.html's own gradients.
const FROST_HAZE = 'rgba(146,224,255,0.9)', FROST_DASH = 'rgba(152,221,255,0.92)';
const frostStyle = solid => solid
    ? `background:linear-gradient(to bottom, ${FROST_HAZE}, transparent) left top/100% 9px no-repeat,`
      + `linear-gradient(to top, ${FROST_HAZE}, transparent) left bottom/100% 9px no-repeat`
    : `background:repeating-linear-gradient(to right, ${FROST_DASH} 0 6px, transparent 6px 11px) left top/100% 2px no-repeat,`
      + `repeating-linear-gradient(to right, ${FROST_DASH} 0 6px, transparent 6px 11px) left bottom/100% 2px no-repeat`;

// Cell size is measured, not guessed: the precipitation field lays out in
// pixels, so it needs the size the block came out at, and again when it moves.
const paintExplain = root => {
    root.querySelectorAll('.board').forEach(board => {
        // A hidden board has no width, and blocks drawn against zero stay the
        // wrong size. The resize handler repaints once there is one to measure.
        if (!board.clientWidth) return;
        const gap = parseFloat(getComputedStyle(board).columnGap) || 6;
        const w = Math.floor((board.clientWidth - gap * (EX_COLS - 1)) / EX_COLS);
        const h = Math.round(w * EX_RATIO);
        const name = board.dataset.board;
        let html = '';
        if (EX_BOARDS[name]) {
            html = EX_BOARDS[name]().map(([hr, cap, gl]) =>
                exCell(exBlk(hr, w, h, gl ? exGlyph(gl) : ''), cap)).join('');
        } else if (name === 'bands') {
            html = MR.TEMP_BANDS.map((b, i) => {
                const lo = i === 0 ? null : MR.TEMP_BANDS[i - 1].max;
                const range = lo == null ? `under ${b.max}°`
                    : !isFinite(b.max) ? `${lo}° +` : `${lo} to ${b.max}°`;
                return exCell(exFlat(b.rgb, w, h), `<em>${b.name}</em><br>${range}`);
            }).join('');
        } else if (name === 'ice') {
            html = exCell(exFlat(MR.bandRGB(-4), w, h, `<span class="frost" style="${frostStyle(true)}"></span>`),
                          'below <em>0°</em>')
                 + exCell(exFlat(MR.bandRGB(1), w, h, `<span class="frost" style="${frostStyle(false)}"></span>`),
                          `<em>0–${MR.FROST_POSSIBLE}°</em>`)
                 + exCell(exFlat(MR.bandRGB(-24), w, h, exGlyph(['danger'])), `<em>${MR.TEMP_DANGER_COLD}°</em> or below`)
                 + exCell(exFlat(MR.bandRGB(40), w, h, exGlyph(['danger'])), `<em>${MR.TEMP_DANGER_HOT}°</em> or above`);
        } else if (name === 'speed') {
            html = EX_WIND_TICKS.map((v, i) =>
                exCell(exFlat(MR.windRGB(v), w, h), `<em>${v}</em>${i === EX_WIND_TICKS.length - 1 ? ' km/h' : ''}`)).join('');
        } else if (name === 'rose') {
            html = MR.COMPASS.map((n, i) =>
                exCell(exFlat(MR.windRGB(34), w, h, exArrow(i * 45)), `from <em>${n}</em>`)).join('');
        }
        board.innerHTML = html;
    });
    root.querySelectorAll('.chain').forEach(c => {
        c.innerHTML = chainSteps().map(([rgb, name, val], i) =>
            (i ? '<span class="arrow">→</span>' : '')
          + `<div class="step"><div class="sn">${name}</div>`
          + `<span class="blk" style="width:100%;height:46px;background:rgb(${rgb})"></span>`
          + `<div class="sv">${val}</div></div>`).join('');
    });
    root.querySelectorAll('.sweep').forEach(sw => {
        sw.innerHTML = sweepRows().map(([name, ramp, lo, hi]) =>
            `<div class="sl">${name}</div>`
          + `<div class="sr">${ramp.map(c => `<i style="background:rgb(${c})"></i>`).join('')}</div>`
          + `<div class="se"><span>${lo}</span><span>${hi}</span></div>`).join('');
    });
    root.querySelectorAll('.glyphs').forEach(g => {
        const set = EX_GLYPHS[g.dataset.glyphs];
        g.innerHTML = set ? set().map(([k, l]) => `<span>${MR.mrIcon(k)}${l}</span>`).join('') : '';
    });
};

// --- the sheet ------------------------------------------------------------
// Carries the city sheet's own shell classes (.sheet-scrim, .city-sheet, the
// sheet-in/out animations and the reduced-motion rules that stop them);
// explain.css only sets what differs. Built once and kept.
let exScrim = null, exSheet = null, exBody = null, exView = null, exLast = null;
const exBuild = () => {
    if (exSheet) return;
    exScrim = document.createElement('div');
    exScrim.className = 'sheet-scrim ex-scrim';
    exScrim.hidden = true;
    exSheet = document.createElement('div');
    exSheet.className = 'city-sheet ex-sheet';
    exSheet.hidden = true;
    exSheet.tabIndex = -1;
    exSheet.setAttribute('role', 'dialog');
    exSheet.setAttribute('aria-modal', 'true');
    exSheet.setAttribute('aria-label', 'How to read this view');
    exSheet.innerHTML = '<div class="ex-body"></div>'
        + '<div class="ex-actions"><span class="ex-tabs">'
        + ['rain', 'temp', 'wind'].map(v =>
            `<button type="button" data-ex="${v}">${v[0].toUpperCase()}${v.slice(1)}</button>`).join('')
        + '</span><button type="button" class="ex-done">Done</button></div>';
    document.body.append(exScrim, exSheet);
    exBody = exSheet.querySelector('.ex-body');
    exScrim.addEventListener('click', explainClose);
    exSheet.querySelector('.ex-done').addEventListener('click', explainClose);
    exSheet.querySelector('.ex-tabs').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b) exRender(b.dataset.ex);
    });
    // A board drawn for one width is wrong at another.
    let frame = 0;
    addEventListener('resize', () => {
        if (exSheet.hidden) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => paintExplain(exBody));
    });
};
const exRender = view => {
    exView = view;
    exBody.innerHTML = EX_BODIES[view]();
    exBody.scrollTop = 0;
    paintExplain(exBody);
    exSheet.querySelectorAll('.ex-tabs button').forEach(b =>
        b.classList.toggle('on', b.dataset.ex === view));
};
const explainOpen = view => {
    exBuild();
    exLast = document.activeElement;
    // Shown before it is filled: a hidden element has no width, and rendering
    // first drew every block at zero.
    exScrim.hidden = exSheet.hidden = false;
    exRender(EX_BODIES[view] ? view : 'rain');
    exScrim.classList.add('sheet-in');
    exSheet.classList.add('sheet-in');
    setTimeout(() => {
        exScrim.classList.remove('sheet-in');
        exSheet.classList.remove('sheet-in');
    }, 160);
    exSheet.focus();
};
const explainClose = () => {
    if (!exSheet || exSheet.hidden) return;
    exScrim.classList.add('sheet-out');
    exSheet.classList.add('sheet-out');
    setTimeout(() => {
        exScrim.hidden = exSheet.hidden = true;
        exScrim.classList.remove('sheet-out');
        exSheet.classList.remove('sheet-out');
        if (exLast && exLast.isConnected) exLast.focus();
    }, 150);
};
addEventListener('keydown', e => {
    if (e.key === 'Escape' && exSheet && !exSheet.hidden) { e.stopPropagation(); explainClose(); }
}, true);

// The surface app.js calls. `isOpen` lets a second tap close instead of reopen.
window.mrExplain = {
    open: explainOpen,
    close: explainClose,
    isOpen: () => !!exSheet && !exSheet.hidden,
    view: () => exView,
    // For the drafts in scripts/explain-preview/, which render a body flat. Unused in the app.
    body: v => EX_BODIES[v](),
    paint: paintExplain
};
