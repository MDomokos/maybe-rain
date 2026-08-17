// shared/precip-field.js: the precipitation overlay as a field of marks.
//
// PRIMARY ONLY. Classic carries shared/precip-pattern.js, the DR-12/15/16
// pattern renderer, frozen. Both files define the same entry point:
//
//     precipOverlay(h, base, W, H) -> HTML string
//
// W and H are the block's pixel size, because unlike a pattern a field of
// discrete marks has to know how big the box is before it can decide where
// a mark begins and where it ends.
//
// Loads AFTER colors.js: it reads lnBlue and lnLum from there.
//
// Why it exists. The shipped overlay is an infinite hatch pattern clipped
// by a box, and a box has no ends: the pattern deliberately overshoots its
// tile so the tiling never shows a join, stroke-linecap is never set, and
// so every end in the grid is a default butt cut by an edge. Everything
// else follows. Ends look severed because they are; the drizzle band can
// only vary count, because a pattern has nothing else to vary; and the
// frozen family had to invent a second drawing language, because the first
// one could not make a short mark.
//
// A field of discrete marks answers all of that at once, and costs nothing
// at render time: every mark in a block shares one colour and one weight,
// so they emit as one <path> with many subpaths — the same single DOM node
// the pattern was.
//
// Config locked 2026-07-24 (Maybe Rain Precipitation + Climatology), with
// the mark field's own constants from Maybe Rain Line Refinements.
const LN = { cap: 8, floor: 0.3, popFloor: 8, warn: 20,
             maxAngle: 55, windSat: 40,
             // Rain, snow and hail are marks ON one lattice, never
             // overlays stacked on top of each other, so the spacings
             // cannot disagree and a pellet sits exactly where a raindrop
             // would have. Snow takes its water-equivalent share of the
             // sites, hail a fixed one, rain the rest, all spread by the
             // ordered dither.
             //
             // As snow takes over the lattice OPENS OUT rather than
             // tightening, and the flake shrinks with it: a block of
             // falling snow should read lighter than the same block of
             // rain at both ends of the amount scale, and the shipped
             // lattice produced a solid polka wall at the top of it.
             snowSpace: 1.65, snowDot: 0.70,
             // Hail is a category with no quantity anywhere in Open-Meteo,
             // so it takes a fixed share and never a ramp. A pellet is the
             // same weight as the rain it falls with — it was drawn at
             // max(1.5x weight, 2.2px), the heaviest ink on the screen —
             // and is told apart by being short, white and on its own
             // sites rather than by being fat.
             hailShare: 0.3,
             // Mist. DR-12 reserved texture for precipitation and DR-31
             // gives hazards to glyphs, so humidity, air quality, pressure
             // and CAPE stay out: none of them fall out of the sky. Low
             // visibility is a property of the falling water itself, and
             // it answers "is it murky out", which nothing else does.
             //
             // Horizontal runs: the one direction nothing else in the
             // system uses, so it composes with drizzle rather than
             // replacing it.
             mistVis: 2000, mistSp: 4.5, mistSw: 1.0, mistLen: 7, mistLenHi: 12,
             mistGap: 5, mistAlpha: 0.14, mistAlphaHi: 0.44,
             // The lattice barely moves: 6.4 px at the light end, 4.7 at
             // the heavy one. Amount is no longer spent on COUNT, so the
             // drizzle end stops being drawn with three lines.
             spLo: 6.4, spHi: 4.7,
             // The light band is 0.3 to 1 mm — the jacket question — and
             // it lives in its own short range with a deliberate GAP
             // before real rain begins. One continuous ramp put 0.4 mm at
             // 37% of the maximum length, so a drizzle hour was already
             // most of the way to looking like rain: the thing the three
             // dash bands existed to prevent, and what retiring them
             // quietly cost. The category boundary is now a jump in size.
             light: 1,
             lenTrace: 2.2, lenLo: 3.0, lenLight: 6.5, lenMain: 12.5, lenHi: 26,
             // Weight steps with it, more gently, and has a floor. The
             // ramp used to start at 0.9 px, which is under one device
             // pixel on a 1x screen, so the lightest marks in the system
             // were drawing sub-pixel smudges.
             swFloor: 1.5, swLo: 1.5, swLight: 1.8, swMain: 2.0, swHi: 2.6,
             gapTrace: 5.4, gapLo: 3.4, gapHi: 3.0,
             gamma: 0.55, lightGamma: 0.8,
             alpha: 0.62, alphaLight: 0.74, alphaTrace: 0.5,
             // The chance channel: how far across the block the committed
             // marks reach. A floor and a gamma, because at 12% the bare
             // reading is about 5 px of a 46 px block and no texture
             // survives 5 px at any size.
             popFill: 0.06, popGamma: 0.62,
             // Past the committed edge, on the TRACE TIER ONLY, the same
             // marks continue at reduced strength out to 1.9x the chance:
             // "possibly a bit more than this". Scoped twice on purpose.
             // Ghosting the whole block was too much ink everywhere, and
             // the cells that needed help were only ever the near-empty
             // ones; reaching the whole cell read as a second fill rather
             // than as the block's own uncertainty.
             //
             // Opacity alone cannot make a ghost read as a ghost on every
             // sky: the same fraction that whispers on gold reads as a
             // second mark on slate, where a pale blue on a dark base is
             // already high-contrast. So the alpha is cut again on dark
             // bases and the mark is drawn SHORTER as well as fainter — a
             // size difference holds up wherever an opacity difference
             // does not.
             ghostSpan: 1.9, ghostAlpha: 0.30, ghostDark: 0.5,
             ghostScale: 0.62, ghostWeight: 0.78,
             // An hour at 0 mm with a real chance is the commonest trace
             // case, not a rare one: the deterministic run says nothing
             // and the ensemble says 40%. It draws NOTHING at full
             // strength — the whole field is the ghost — so it can never
             // be confused with a drizzle hour, which always carries at
             // least one committed mark.
             //
             // It gets its own lighter set, because it has no committed
             // mark beside it to be read against. What it sits beside is
             // the next block along, which may be a coloured rain hour, so
             // an opacity that looked like a whisper in context read as an
             // ordinary drizzle line on its own. Its alpha is absolute
             // rather than a fraction of the trace alpha, which would land
             // near 0.07 and vanish.
             nilMax: 0.05, nilAlpha: 0.17, nilDark: 0.62,
             nilScale: 0.50, nilWeight: 0.58,
             // The field's own two: how far a mark is held off the block's
             // edge, and how much of a mark has to survive the clip to be
             // worth drawing. The cull floor is 0 on purpose — a mark cut
             // by the block or by the chance edge is drawn short with a
             // round end rather than dropped, so the field reaches the
             // edges instead of floating inside a margin.
             inset: 0.4, minKeep: 0,
             // Five leans, not a fan: two steps each side of vertical,
             // evenly spaced to the cap, with a deadband below which the
             // hour simply falls straight down.
             leanSteps: 2, leanCap: 26, leanDead: 6 };
// A fallback block, used only when the frame cannot be measured (first
// paint, a hidden tab). 46 x 40 is the reference block every constant in
// this file was tuned against.
const LN_BLOCK = { W: 46, H: 40 };
// Wind lean: signed E-W component of travel (wind blows toward dir+180),
// linear to 55deg at a 40 km/h component. Positive SVG rotation =
// drifting east. No wind data = vertical fall.
const windLean = h => {
    if (h.wind == null || h.windDir == null) return 0;
    const u = h.wind * Math.sin((h.windDir + 180) * Math.PI / 180);
    return LN.maxAngle * Math.max(-1, Math.min(1, u / LN.windSat));
};
// The lean the field draws: five angles, 0 and +/-13 and +/-26.
//
// The busyness was never the lean, it was that the lean was continuous.
// Two neighbouring hours whose wind differs by 3 km/h got visibly
// different angles, and the eye read the difference as meaning, so a
// windy afternoon came out as a fan of slightly different slopes instead
// of one weather. Quantising makes every hour in the same airflow share
// an angle: the block of grid leans, not each block in it.
//
// The 26deg cap is the p90 of the 5-year wet-hour wind record, which is
// where DR-12's original fixed 28deg came from, so the resting look is
// the one the mockups proved. Under the deadband the hour is drawn
// vertical, because calm should read as calm rather than as a slight
// preference.
const quantLean = h => {
    const a = windLean(h);
    if (Math.abs(a) < LN.leanDead) return 0;
    const n = LN.leanSteps, cap = LN.leanCap;
    const k = Math.min(n, Math.max(1, Math.round((Math.abs(a) - LN.leanDead) / ((cap - LN.leanDead) / n))));
    return Math.sign(a) * k * (cap / n);
};
// Hail is a WMO category, not a quantity: 96 and 99 are the only codes
// that carry it, and per the 2026-07-27 hazard ruleset they only mean hail
// in Central Europe at all.
const HAIL_CODES = new Set([96, 99]);

// --- the ordered dither ---------------------------------------------
// Every per-site choice in the field reads this and nothing reads a
// random number. Thresholding an ordered dither is the standard way to
// spread a fraction evenly across a grid: taking the sites whose rank
// falls under a share gives that share as evenly as a lattice allows,
// so a half-snow hour alternates cleanly instead of doubling two sites
// up and leaving a hole. A hash would scatter; the point is that the
// grid stays a grid.
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const bayer = (c, r) => (BAYER[((r % 4) + 4) % 4][((c % 4) + 4) % 4] + 0.5) / 16;

// --- clipping --------------------------------------------------------
// Liang-Barsky, segment against an axis-aligned rect. This is what lets a
// mark end where the block does: the segment is shortened analytically and
// then round-capped, rather than drawn long and cut by an edge.
const clipSeg = (x0, y0, x1, y1, xmin, ymin, xmax, ymax) => {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const p = [-dx, dx, -dy, dy], q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; }
        else {
            const r = q[i] / p[i];
            if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
            else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
    }
    return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
};

// --- the lattice -----------------------------------------------------
// One rotated lattice per block. Columns run across the fall direction at
// `sp`; sites run along it at `len + gap`, every other column staggered by
// half a period so the rows never line up into a visible band. The lattice
// is perfectly even: nothing here is jittered, because the first pass that
// was read as chaos rather than as weather.
//
// Each site answers:
//   [x1, y1, x2, y2, rank, alt, rank2, cx, cy, drawable]
// where x1..y2 is the CLIPPED segment, `rank` and `rank2` are two ordered
// dither values, `alt` is the checkerboard parity, cx/cy is the site's own
// centre BEFORE clipping, and `drawable` says whether the segment survived
// the clip at all.
//
// The centre matters more than it looks. A point mark placed at the end of
// a clipped streak lands on the block boundary whenever the streak crosses
// it, which piled every flake along the bottom edge and left a bare band at
// the top. Point marks read on the site instead, and a site is kept when
// its centre is within the box plus the mark's own radius, so the field
// reaches every edge with partial marks rather than stopping short.
const markField = (W, H, angle, o) => {
    const a = angle * Math.PI / 180;
    const dx = Math.sin(a), dy = Math.cos(a);   // fall direction
    const px = Math.cos(a), py = -Math.sin(a);  // perpendicular
    const pad = o.sw / 2 + LN.inset;
    const xmin = pad, ymin = pad;
    const xmax = Math.max(pad, o.fillW - pad), ymax = Math.max(pad, H - pad);
    const R = Math.hypot(W, H) / 2 + o.len + 4;
    const period = o.len + o.gap;
    const keep = Math.min(o.len * 0.55, LN.minKeep);
    const edge = o.edge || 0;
    const segs = [];
    let col = 0;
    for (let v = -R; v <= R; v += o.sp, col++) {
        const stagger = (col % 2) ? period / 2 : 0;
        let row = 0;
        for (let u = -R + stagger; u <= R; u += period, row++) {
            const rank = bayer(col, row), alt = (col + row) & 1, rank2 = bayer(col + 1, row + 2);
            const x1 = W / 2 + v * px + u * dx, y1 = H / 2 + v * py + u * dy;
            const x2 = x1 + o.len * dx, y2 = y1 + o.len * dy;
            const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
            const cl = clipSeg(x1, y1, x2, y2, xmin, ymin, xmax, ymax);
            let ok = false, seg = [x1, y1, x2, y2];
            if (cl) {
                const L = Math.hypot(cl[2] - cl[0], cl[3] - cl[1]);
                if (L >= keep) { ok = true; seg = cl; }
            }
            const near = cx >= xmin - edge && cx <= xmax + edge && cy >= ymin - edge && cy <= ymax + edge;
            if (!ok && !near) continue;
            segs.push([seg[0], seg[1], seg[2], seg[3], rank, alt, rank2, cx, cy, ok]);
        }
    }
    return segs;
};

// --- the primitives --------------------------------------------------
// Every figure in the system is built from these two, so the lattice, the
// lean and the clipping are shared and only the drawn shape changes.
const subStraight = ([x1, y1, x2, y2]) =>
    `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
const subDotAt = (cx, cy, r) =>
    `M${(cx - r).toFixed(2)} ${cy.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0Z`;

// Build the path data for a set of clipped segments. Stroked figures go in
// .stroke, filled ones in .fill; a figure may use both.
//
// Three figures, and the band a mark falls in picks which:
//
//   grain     below 0.3 mm. Short ticks whose length varies over the
//             ordered cycle. The trace tier is not the drizzle tier: the
//             amount there is essentially zero and only the chance is real
//             (DR-16), so it takes a pure texture rather than a shape that
//             claims a size. It is also the figure that survives a narrow
//             sliver, which is what a low-chance hour leaves.
//   broken    0.3 to 1 mm. Each site is a dot, a short tick or a full
//             dash, chosen on the ordered cycle. Irregularity IS the
//             texture, which is what a drizzle hour actually looks like.
//   straight  above 1 mm. A plain run that simply grows.
//
// No curves anywhere. The wave family read well blown up and shouted at
// grid scale: a wavy mark carries more ink than a straight one of the same
// length and reads bigger still, so a field of them over-states a drizzle
// hour however it is tuned.
const marksToPath = (segs, figure, m) => {
    const drawable = segs.filter(s => s[9]);
    if (figure === 'grain') {
        // Length over an ordered 4x4 cycle, not at random, so the field
        // keeps a rhythm instead of scattering.
        return {
            stroke: drawable.map(s => {
                const f = 0.55 + 0.7 * s[6];
                return subStraight([s[0], s[1], s[0] + (s[2] - s[0]) * f, s[1] + (s[3] - s[1]) * f]);
            }).join(''),
            fill: ''
        };
    }
    if (figure === 'broken') {
        const r = m.sw * 0.64;
        const stroke = [], fill = [];
        drawable.forEach(s => {
            const k = s[6];
            if (k < 0.34) {
                // The dot belongs on the site, which is where a raindrop
                // would have been. A site near an edge can have its centre
                // just outside the box even though part of its mark is
                // inside, so the centre is held to the mark: interior
                // sites never move, and an edge dot stays on the block
                // rather than half off it.
                const cx = Math.min(Math.max(s[7], Math.min(s[0], s[2])), Math.max(s[0], s[2]));
                const cy = Math.min(Math.max(s[8], Math.min(s[1], s[3])), Math.max(s[1], s[3]));
                fill.push(subDotAt(cx, cy, r));
            }
            else if (k < 0.67) stroke.push(subStraight([s[0], s[1], (s[0] + s[2]) / 2, (s[1] + s[3]) / 2]));
            else stroke.push(subStraight(s));
        });
        return { stroke: stroke.join(''), fill: fill.join('') };
    }
    return { stroke: drawable.map(subStraight).join(''), fill: '' };
};
// Which figure an hour draws. The boundaries are the ramp's own, so the
// figure changes exactly where the size does and nowhere else.
const figureFor = m => m.trace ? 'grain' : m.light ? 'broken' : 'straight';

// --- the amount ramp -------------------------------------------------
// How much rain is the mark's LENGTH and weight, not the count of marks.
//
// DR-12 spent intensity on spacing: 15 px at the light end down to 4.7 at
// the heavy one. The arithmetic of that is what broke the drizzle band. At
// the drizzle end a 46 px block held three lines and the trace tier held
// two — while 61 to 67% of all wet hours are under 0.5 mm. The modal rain
// hour was drawn with the least ink in the system.
//
// So the lattice barely moves and the mark carries the amount instead.
// Drizzle is a fine mist of short round-capped ticks covering the whole
// fill; a downpour is few, long, thick, near-solid runs. Ink still rises
// with mm, and coverage no longer collapses at the bottom.
//
// The ramp is two segments with a gap between them rather than one curve,
// because the light band is a different question from the heavy one: "is
// it worth a coat" against "how hard is it raining". A single ramp put
// 0.4 mm at 37% of the maximum length, which is most of the way to looking
// like rain. This also retires the three dash bands: length IS the band
// now, continuously within each segment and stepped between them.
//
// It takes millimetres and nothing else. A snowy hour rides the same ramp
// on the total water it is carrying, because the lattice under all three
// phases is one lattice and a mixed hour has to be sized once.
const amountFor = mm => {
    if (mm < LN.floor) {
        // The trace tier. The amount is below the 0.3 mm floor (often ~0),
        // but the chance is real: amount is the deterministic run and
        // chance is the ensemble (P > 0.1 mm), so a high chance with ~0 mm
        // is a likely light sprinkle the amount misses.
        return { sp: LN.spLo, sw: Math.max(LN.swLo, LN.swFloor), alpha: LN.alphaTrace,
                 len: LN.lenTrace, gap: LN.gapTrace, trace: true, light: true };
    }
    const clamp01 = x => Math.max(0, Math.min(1, x));
    if (mm < LN.light) {
        // The jacket band. Its own short, narrow range, and a little more
        // opacity than the rest, because length still carries the amount
        // and a thicker light mark does not over-state the hour the way a
        // longer one would.
        const t = Math.pow(clamp01((mm - LN.floor) / (LN.light - LN.floor)), LN.lightGamma);
        return { sp: LN.spLo,
                 sw: Math.max(LN.swLo + (LN.swLight - LN.swLo) * t, LN.swFloor),
                 alpha: LN.alphaLight,
                 len: LN.lenLo + (LN.lenLight - LN.lenLo) * t,
                 gap: LN.gapLo, trace: false, light: true };
    }
    const t = Math.pow(clamp01((Math.min(mm, LN.cap) - LN.light) / (LN.cap - LN.light)), LN.gamma);
    return { sp: LN.spLo + (LN.spHi - LN.spLo) * t,
             sw: Math.max(LN.swMain + (LN.swHi - LN.swMain) * t, LN.swFloor),
             alpha: LN.alpha,
             len: LN.lenMain + (LN.lenHi - LN.lenMain) * t,
             gap: LN.gapLo + (LN.gapHi - LN.gapLo) * t, trace: false, light: false };
};

// --- the block -------------------------------------------------------
// The chance channel is DR-12's: the marks reach `pop` per cent of the way
// across the block, anchored left, nothing below 8%. Unlike the pattern
// version the fill edge is not a CSS width on the wrapper but a rect the
// marks are clipped to, so a mark the edge crosses is drawn short with a
// round end instead of being cut in half.
//
// The committed band takes a floor and a gamma, because a bare 12% is
// about 5 px of a 46 px block and no texture survives 5 px.
const chanceBand = h => h.pop == null ? 1
    : LN.popFill + (1 - LN.popFill) * Math.pow(Math.min(100, h.pop) / 100, LN.popGamma);
// Emit one path per strength. Marks may be shortened toward their own
// start and drawn at a lighter weight, which is how a ghost is told from
// a committed mark by size as well as by opacity.
const emitMarks = (segs, figure, m, c, alpha, scale, weight) => {
    if (!segs.length) return '';
    const use = scale === 1 ? segs : segs.map(s =>
        [s[0], s[1], s[0] + (s[2] - s[0]) * scale, s[1] + (s[3] - s[1]) * scale,
         s[4], s[5], s[6], s[7], s[8], s[9]]);
    const sw = m.sw * weight;
    const p = marksToPath(use, figure, { ...m, sw });
    const col = `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
    return (p.stroke ? `<path d="${p.stroke}" stroke="${col}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` : '')
        + (p.fill ? `<path d="${p.fill}" fill="${col}"/>` : '');
};

// --- the block -------------------------------------------------------
// One lattice, three kinds of mark. Rain, snow and hail are marks ON it,
// never overlays stacked on top of each other: nothing is overlaid on
// anything, so the spacings cannot disagree and a pellet sits exactly
// where a raindrop would have. The alignment problem disappears rather
// than being tuned away.
//
// Sleet falls out for free. A flake gets a tail only while the hour is
// mixed, so a pure snow hour is pure dots — the identity DR-12 gave snow
// — a mixed hour reads as a mix, and pure rain is streaks.
const precipFieldSVG = (h, base, W, H) => {
    // The liquid part (rain + showers) and the frozen part. 1 cm of
    // snowfall is about 1 mm of water, which is what lets the two share a
    // ramp. Old cached payloads lack the rain/showers split: fall back to
    // total mm, except on snow-coded hours, where the total IS the snow
    // and counting it twice would draw rain that is not falling.
    const snow = h.snow > 0 ? h.snow : 0;
    // An hour whose amount is not known at all draws nothing. It is not
    // the same as an hour forecast at zero, and the 0 mm field says
    // "nothing is forecast", which would be a claim this hour cannot
    // make (principle 4: an absence is drawn as an absence).
    if (h.mm == null && h.liquid == null && snow === 0) return '';
    const liquid = Math.max(0, h.liquid ?? (COND[h.condition].group === 'snow' ? 0 : (h.mm ?? 0)));
    const total = liquid + snow;
    if (h.pop != null && h.pop < LN.popFloor) return '';
    // DR-16: the trace tier is liquid-only. Below the floor the amount is
    // noise and the chance is the whole story, and a chance of snow is not
    // a story this texture can tell.
    if (total < LN.floor && (COND[h.condition].group === 'snow'
        || h.pop == null || h.pop < LN.popFloor)) return '';

    const m = amountFor(total);
    const c = lnBlue(base), dark = lnLum(base) <= 135;
    const band = chanceBand(h);
    // The ghost is the trace tier's alone. Above it the block already has
    // committed marks to read, and the chance is not the only real fact.
    const ghosted = m.trace && h.pop != null;
    // An hour whose amount is literally zero draws entirely in the ghost.
    const nil = ghosted && total <= LN.nilMax;
    // The reach over-reports on purpose, and that is the accepted trade.
    // Drawing a 0 mm hour to its bare chance was tried and reverted: it is
    // more honest about extent and it puts the block straight back to the
    // one-thin-line problem the whole light band exists to fix.
    // Over-reporting a possibility is the better error. The cost is
    // recorded rather than hidden: above about 30% chance the reach
    // saturates at the block width, so the top of the chance scale
    // resolves less than the bottom.
    const reach = ghosted ? Math.min(1, band * LN.ghostSpan) : band;

    // Role shares, known BEFORE the lattice is laid, because that is what
    // the lattice's step depends on: a flake is a dot, and dots want a
    // shorter step than streaks, or a heavy snow hour ends up with fewer
    // marks than a light one.
    const snowShare = total > 0 ? snow / total : 0;
    const hailShare = HAIL_CODES.has(h.code) ? LN.hailShare : 0;
    const mixed = snow > 0 && liquid > 0;
    // As snow takes over the lattice opens out, and goes isotropic with
    // it: the along-fall step is pulled toward the perpendicular one, so
    // flakes sit on an even field instead of inheriting the long step a
    // streak needs. Amount then rides the dot radius, exactly as the
    // shipped snow lattice had it.
    const sp = m.sp * (1 + (LN.snowSpace - 1) * snowShare);
    const len = m.len + (sp * 0.55 - m.len) * snowShare;
    const gap = Math.max(1.2, m.gap + (sp * 0.45 - m.gap) * snowShare);
    // A site whose streak falls outside the box can still own a visible
    // point mark, so when there are point marks to place the lattice keeps
    // sites a mark's radius beyond the edge.
    const point = snowShare > 0 || hailShare > 0;
    const segs = markField(W, H, quantLean(h),
        { sp, len, gap, sw: m.sw, fillW: reach * W, edge: point ? m.sw * 1.6 : 0 });
    if (!segs.length) return '';

    // Snow and rain in the same block always draw straight (owner call).
    // The flakes are already a second kind of mark on the lattice; a
    // broken rain mark beside them gives the eye three figures to separate
    // in 46 px, and the mix stops reading as a mix.
    const figure = mixed ? 'straight' : figureFor(m);
    const bandW = band * W;
    // Roles by ordered dither, never a hash: a 30% hail hour puts pellets
    // on an even scatter of sites instead of doubling two up and leaving a
    // hole, and a half-snow hour alternates cleanly.
    const rain = [], ghost = [], flakes = [], pellets = [];
    segs.forEach(s => {
        const r = s[4];
        if (r < hailShare) pellets.push(s);
        else if (r < hailShare + snowShare * (1 - hailShare)) flakes.push(s);
        else if (s[9]) ((nil || (ghosted && s[7] > bandW)) ? ghost : rain).push(s);
    });

    // A point mark is placed when its SITE is on the block, within the
    // mark's own radius of it, so the field reaches every edge with
    // partial marks rather than stopping short. A site further out than
    // that can still have a drawable streak — the segment is long and the
    // centre is its middle — but it is not a lattice position any more,
    // and a flake drawn there would be entirely outside the block.
    const onBlock = (s, r) =>
        s[7] >= -r && s[7] <= reach * W + r && s[8] >= -r && s[8] <= H + r;
    const mm = { ...m, sp, len, gap };
    const gA = nil ? LN.nilAlpha * (dark ? LN.nilDark : 1)
                   : m.alpha * LN.ghostAlpha * (dark ? LN.ghostDark : 1);
    let out = emitMarks(rain, figure, mm, c, m.alpha, 1, 1)
        + emitMarks(ghost, figure, mm, c, gA,
            nil ? LN.nilScale : LN.ghostScale, nil ? LN.nilWeight : LN.ghostWeight);

    // Snow: a flake on the site, with a tail only while the hour is mixed.
    // White, on DR-12's argument that frozen precipitation keeps a constant
    // identity no sky can dilute.
    if (flakes.length) {
        const a = quantLean(h) * Math.PI / 180, fx = Math.sin(a), fy = Math.cos(a);
        const r = m.sw * LN.snowDot, tail = len * 0.5 * (1 - snowShare);
        let dots = '', tails = '';
        flakes.forEach(s => {
            if (!onBlock(s, r)) return;
            dots += subDotAt(s[7], s[8], r);
            // The tail is drawn back FROM the flake rather than forward
            // from the streak's start, so tail and dot share one anchor,
            // and it is clipped like every other stroke in the file.
            if (tail > 0.6) {
                const t = clipSeg(s[7] - fx * tail, s[8] - fy * tail,
                                  s[7] - fx * r * 0.8, s[8] - fy * r * 0.8,
                                  0, 0, reach * W, H);
                if (t) tails += subStraight(t);
            }
        });
        if (tails) out += `<path d="${tails}" stroke="rgba(${c[0]},${c[1]},${c[2]},${m.alpha})" stroke-width="${m.sw.toFixed(2)}" stroke-linecap="round" fill="none"/>`;
        if (dots) out += `<path d="${dots}" fill="rgba(255,255,255,0.92)"/>`;
    }
    // Hail: a short heavy white stub on the site, leaning with the rain.
    // Stub, not dot, so it is never snow; the open rings it replaces were
    // the only outline shape in a system made of round caps and filled
    // dots, and per the 2026-07-27 hazard ruleset WMO 96/99 only mean hail
    // in Central Europe, so the ring asserted a fact the data does not
    // hold elsewhere.
    if (pellets.length) {
        const a = quantLean(h) * Math.PI / 180, fx = Math.sin(a), fy = Math.cos(a);
        const e = Math.min(len * 0.45, m.sw * 1.15);
        let d = '';
        pellets.forEach(s => {
            if (!onBlock(s, e)) return;
            const p = clipSeg(s[7] - fx * e, s[8] - fy * e, s[7] + fx * e, s[8] + fy * e,
                              0, 0, reach * W, H);
            if (p) d += subStraight(p);
        });
        if (d) out += `<path d="${d}" stroke="rgba(255,255,255,0.95)" stroke-width="${m.sw.toFixed(2)}" stroke-linecap="round" fill="none"/>`;
    }
    if (!out) return '';
    return `<span class="rain-ov"><svg xmlns="http://www.w3.org/2000/svg">${out}</svg></span>`;
};

// Mist / low visibility. Short horizontal runs on the same lattice
// machinery, laid across the block rather than down it, so a murky
// drizzle hour draws both and neither reads as the other. Its own
// overlay, because it is not precipitation falling and does not belong
// on the precipitation lattice.
//
// It is checked before it is drawn: `vis` is null on any payload cached
// before the field was asked for, and on a provider that does not carry
// it (DR-37 had to learn the same lesson).
const mistSVG = (h, base, W, H) => {
    if (h.vis == null || h.vis > LN.mistVis) return '';
    const t = Math.max(0, Math.min(1, 1 - h.vis / LN.mistVis));
    const c = lnLum(base) > 135 ? [70, 78, 88] : [226, 232, 238];
    const segs = markField(W, H, 90, {
        sp: LN.mistSp, sw: LN.mistSw, gap: LN.mistGap,
        len: LN.mistLen + (LN.mistLenHi - LN.mistLen) * t, fillW: W
    });
    const d = segs.filter(s => s[9]).map(subStraight).join('');
    if (!d) return '';
    const a = (LN.mistAlpha + (LN.mistAlphaHi - LN.mistAlpha) * t).toFixed(3);
    return `<span class="rain-ov"><svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="rgba(${c[0]},${c[1]},${c[2]},${a})" stroke-width="${LN.mistSw.toFixed(2)}" stroke-linecap="round" fill="none"/></svg></span>`;
};

// The overlay for one block, or ''. Same signature as the pattern
// renderer's, so the call site does not know which one it got.
const precipOverlay = (h, base, W, H) => {
    const w = W > 0 ? W : LN_BLOCK.W, hh = H > 0 ? H : LN_BLOCK.H;
    return precipFieldSVG(h, base, w, hh) + mistSVG(h, base, w, hh);
};
