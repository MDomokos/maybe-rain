// shared/precip-field.js: the precipitation overlay as a field of marks.
//
// PRIMARY ONLY. Classic carries shared/precip-pattern.js, the pattern
// renderer, frozen. Both files define the same entry point:
//
//     precipOverlay(h, base, W, H) -> HTML string
//
// W and H are the block's pixel size, because unlike a pattern a field of
// discrete marks has to know how big the box is before it can decide where
// a mark begins and where it ends.
//
// Primary passes a fifth argument, `opts`, which classic does not have and
// does not need. `{ layered: true }` splits the field into fall layers for
// the current hour's arrival animation; anything else, including the
// absent argument every other block calls with, emits the markup this file
// has always emitted, byte for byte.
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
             // Mist. Texture is reserved for precipitation and hazards
             // are given to glyphs, so humidity, air quality, pressure
             // and CAPE stay out: none of them fall out of the sky. Low
             // visibility is a property of the falling water itself, and
             // it answers "is it murky out", which nothing else does.
             //
             // Horizontal runs: the one direction nothing else in the
             // system uses, so it composes with drizzle rather than
             // replacing it.
             //
             // Two thresholds, not one: `fogVis` is fog outright, `mistVis`
             // is the mist boundary, and what separates them is whether the
             // sky code has to agree. See `misty` below.
             fogVis: 1000,
             mistVis: 2000, mistSp: 4.5, mistSw: 1.0, mistLen: 7, mistLenHi: 12,
             mistGap: 5, mistAlpha: 0.14, mistAlphaHi: 0.44,
             // The lattice: 7.6 px at the light end, 4.7 at the heavy
             // one. Amount is not spent on COUNT — that is what drew a
             // drizzle hour with three lines — but it is not spent on
             // nothing either. At 6.4 px the light end carried nearly
             // twice the marks of the pattern renderer it replaced, and
             // a whole day of drizzle, which is most of the days there
             // are, came out visibly busier than the sky it describes.
             // 7.6 keeps about twenty marks in a 46 px block, so the
             // field is still a field and not a few lines.
             spLo: 7.6, spHi: 4.7,
             // The light band is 0.3 to 1 mm — the jacket question — and
             // it lives in its own short range with a deliberate GAP
             // before real rain begins. One continuous ramp put 0.4 mm at
             // 37% of the maximum length, so a drizzle hour was already
             // most of the way to looking like rain: the thing the three
             // dash bands existed to prevent, and what retiring them
             // quietly cost. The category boundary is now a jump in size.
             light: 1,
             lenTrace: 2.2, lenLo: 3.0, lenLight: 6.5, lenMain: 12.5, lenHi: 26,
             // The longest mark is held to this fraction of the block's
             // height. A 26 px mark cannot fit a 15 px block at any lean,
             // so on the smallest phone the top few steps of the amount
             // ramp were all clipped to about the same drawn length and
             // stopped telling each other apart. Every length scales by the
             // same factor, so the ramp keeps its whole range and its shape
             // inside whatever height it is given, and the tier boundaries
             // stay in the same order.
             lenFit: 0.65,
             // Weight steps with the amount, and the floor is 1.1 px.
             //
             // It was 1.5 for a while, on the argument that 0.9 px is
             // under one device pixel on a 1x screen. That argument does
             // not survive contact with the screens the app runs on: at
             // 2x and 3x a 1.1 px stroke is two or three device pixels,
             // and at 1x a sub-pixel stroke antialiases to a faint
             // hairline, which is exactly what the lightest hour in the
             // grid should look like. The floor bought a worry about one
             // screen density and paid for it with weight on all of them
             // — the trace tier alone came out at more than twice the
             // ink of the renderer it replaced.
             // swWarn is the top of a second, gentler segment running from
             // the cap up to the warning. 8 mm and 20 mm used to emit
             // identical markup: a 2.5x range of severe rain with nothing
             // to tell one from the other, and no glyph either, since the
             // glyph test was a strict >. Weight only, because at 26 px the
             // marks already run most of the block and growing them further
             // merges the field into a solid.
             swFloor: 1.1, swLo: 1.1, swLight: 1.1, swMain: 1.4, swHi: 2.6, swWarn: 3.2,
             gapTrace: 5.4, gapLo: 3.4, gapHi: 3.0,
             gamma: 0.55, lightGamma: 0.8,
             // Opacity, and the light band no longer gets extra of it.
             // It was raised to 0.74 to rescue a drizzle mark that was
             // drawing at 0.9 px; now that weight has a sensible floor
             // the mark does not need the help, and the band sat a
             // quarter brighter than the rain above it for no reason a
             // reader could see.
             // The trace tier's opacity is 0.36 rather than 0.30. At 0.30
             // it composited to 1.65:1 against the palest sky it is drawn
             // on, which is under any floor worth naming — the tier is
             // meant to be quiet, not absent, and it is the tier that
             // carries the commonest wet hour there is. 0.36 takes it to
             // 1.83:1 and costs about a fifth more ink on trace hours
             // alone; nothing above the floor moves.
             alpha: 0.55, alphaLight: 0.58, alphaTrace: 0.36,
             // The chance channel: how far across the block the committed
             // marks reach. A floor and a gamma, because at 12% the bare
             // reading is about 5 px of a 46 px block and no texture
             // survives 5 px at any size. The gamma is 0.78 rather than
             // the 0.62 it started at: 0.62 widened every hour on the
             // grid by about a fifth on its way to rescuing the lowest
             // ones, and 0.78 still takes a 12% hour to 11 px.
             popFill: 0.06, popGamma: 0.78,
             // Past the committed edge the same marks continue at reduced
             // strength, out to 1.9x the chance: "possibly a bit more than
             // this". Scoped on purpose — ghosting the whole block was too
             // much ink everywhere, and the cells that needed help were
             // only ever the near-empty ones; reaching the whole cell read
             // as a second fill rather than as the block's own uncertainty.
             //
             // The over-reach FADES with the amount rather than switching
             // off with the tier, and that is the whole point of these
             // four numbers. The ghost used to belong to the trace tier
             // alone, and a tier boundary is a threshold in the AMOUNT
             // channel: crossing the 0.3 mm floor turned the ghost off, so
             // the drawn WIDTH roughly halved because the amount rose by
             // one hundredth of a millimetre. Width is the chance channel.
             // Two hours at the same 40% chance, one either side of the
             // floor, read as 83% and 23%. A tier is allowed to step the
             // figure and the length, which is where the category is meant
             // to be read; it is not allowed to step a different fact.
             //
             // So the span rides the amount: full while the amount is
             // still noise, gone by the time it is a drizzle reading worth
             // believing, and continuous through the floor. The ghost
             // outlives the trace tier by a little because it has to fade
             // out SOMEWHERE, and fading it out inside the tier would take
             // it away while the amount is still under the floor and still
             // says nothing — which is the hour that needs it most.
             //
             // Opacity alone cannot make a ghost read as a ghost on every
             // sky: the same fraction that whispers on gold reads as a
             // second mark on slate, where a pale blue on a dark base is
             // already high-contrast. So the alpha is cut again on dark
             // bases and the mark is drawn SHORTER as well as fainter — a
             // size difference holds up wherever an opacity difference
             // does not.
             //
             // `ghostDark` cuts the ghost again where the pale blue is
             // already high-contrast — true slate — because there a ghost
             // at full fraction reads as a second mark rather than as a
             // doubt. That headroom is not a step, though: it shrinks
             // steadily as the sky brightens toward the switch, and by the
             // time the sky is just below it the pale blue has nothing left
             // to give away. The cut was taking the same half regardless,
             // hardest exactly where the mark could least afford it. It is
             // now proportional to the room there is, reaching its full
             // depth `cutSpan` below the switch and nothing at it.
             ghostSpan: 1.9, ghostSpanEnd: 1.0, ghostFull: 0.2, ghostTo: 0.45,
             ghostAlpha: 0.30, ghostDark: 0.5, cutSpan: 55,
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
             // Legibility, not data. The two blues swap polarity at one
             // luminance, and however well that crossing is placed there
             // is still a narrow band of sky where a light mark and a dark
             // mark are both near their worst. Pigment alone cannot lift
             // it: even pure white against pure black tops out at 2.6:1
             // there, and a mark that has to read as blue sits below that.
             //
             // So the marks are painted a little more strongly on exactly
             // those skies and nowhere else. It is the same kind of
             // correction the blue switch already is — the sky changing
             // how the mark is drawn so the mark keeps saying the same
             // thing — and it is deliberately NOT a global lift, because
             // the field was quietened on purpose and a week of drizzle
             // that came back brighter everywhere would undo that for the
             // sake of a band most hours never sit in.
             //
             // A ramp rather than a band test, because opacity blends
             // safely where colour does not: every value between the two
             // is a real opacity, so there is no midpoint that is worse
             // than both ends.
             valleyLift: 0.15, valleyLo: 96, valleyMid: 119, valleyHi: 152,
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
// where the original fixed 28deg came from, so the resting look is
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
// that carry it, and they only mean hail in Central Europe at all.
const HAIL_CODES = new Set([96, 99]);

// --- the fall layers -------------------------------------------------
// Opt-in only, through `opts.layered`, and only the current hour asks for
// it. The field is split into three interleaved sets of lattice COLUMNS,
// each emitted in its own group with its own start offset and its own
// ease, so an arriving block reads as rain falling rather than as one
// sheet of marks sliding into place. Three is the fewest that reads as
// out of step; more and neighbouring columns stop differing visibly.
//
// The distances are in LATTICE PERIODS, not pixels, and the animation
// travels back to zero. A whole number of periods means every mark starts
// on a site the lattice already owns, so the fall ends exactly on the
// resting field. Any other distance lands the marks off the lattice and
// the animation finishes on a visible slip.
const FALL_GROUPS = 3;
const FALL_BACK = [3.0, 4.6, 3.8];
const FALL_EASE = ['cubic-bezier(.16,.72,.24,1)',
                   'cubic-bezier(.28,.58,.32,1)',
                   'cubic-bezier(.10,.80,.20,1)'];

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
//   [x1, y1, x2, y2, rank, alt, rank2, cx, cy, drawable, col]
// where x1..y2 is the CLIPPED segment, `rank` and `rank2` are two ordered
// dither values, `alt` is the checkerboard parity, cx/cy is the site's own
// centre BEFORE clipping, `drawable` says whether the segment survived the
// clip at all, and `col` is the lattice column the site sits in. The column
// is what the fall layers partition on: a layer has to be a whole column of
// the lattice or the marks within it would not share a travel direction.
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
            segs.push([seg[0], seg[1], seg[2], seg[3], rank, alt, rank2, cx, cy, ok, col]);
        }
    }
    return segs;
};

// --- the box, declared -----------------------------------------------
// The field is laid out in pixels against a block of a known size, and is
// then displayed in a block that may no longer be that size. Three ways
// that happens: the day elastic squishes every column to pay for the one
// it is revealing and never rebuilds mid-gesture; a repaint taken while
// the elastic is LOCKED bakes the squished width, and going home does not
// rebuild; and a window resize re-runs the widths without rebuilding at
// all. In every case the block moves and the marks do not.
//
// Without a viewBox an SVG has no coordinate mapping — one user unit is
// one CSS pixel, anchored top left — so the field was simply CLIPPED by
// the narrower box. That is not a cosmetic loss. The chance channel IS
// the fill's extent, anchored left, so clipping it into a narrower block
// makes a fixed fill cover MORE of what is visible: at full pull an 80%
// hour reads as certain and a 20% hour reads as 63%. The one channel the
// pull exists to compare across days was the first one the pull spoiled.
//
// Declaring the box fixes it. The extents then track the block at every
// width, so the chance edge sits at its true fraction whatever the
// elastic is doing, and a stale build is corrected by the browser rather
// than by luck. `preserveAspectRatio="none"` because the two axes move
// independently — a pull changes width alone — and a uniform fit would
// answer a width change by shrinking the field vertically too, leaving
// bare space along the bottom.
//
// What a non-uniform map costs is stated rather than hidden: the lean
// flattens as the block narrows (26deg reads about 13deg at full pull)
// and a snow flake squashes to an ellipse. Stroke WEIGHT is exempt, via
// `vector-effect="non-scaling-stroke"` on every stroked path, because
// weight is half the amount channel and a downpour that thinned out as
// you peeked would be the same class of lie this comment is about.
//
// The distortion is meant to be transient, so it is bounded: the grid
// rebuilds on settle and on resize (`settleFields` in primary/app.js),
// which re-bakes exact geometry for anything that persists. What
// stretches is a gesture in flight, and nothing else.
//
// Classic never had this problem. The pattern renderer carries chance as
// a percentage width on the wrapper and fills with a 100%-by-100% rect,
// so it tracks the box for free; the field lost that when it moved the
// fill inside the SVG to get round ends on the chance edge. This is the
// property being restored, not a new one.
const svgOpen = (W, H) => `<svg xmlns="http://www.w3.org/2000/svg"`
    + ` viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" preserveAspectRatio="none">`;
// Every stroked path in this file carries it, so the rule is one string.
const STROKE_FX = ' vector-effect="non-scaling-stroke"';

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
//             amount there is essentially zero and only the chance is
//             real, so it takes a pure texture rather than a shape that
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
// The pattern spent intensity on spacing: 15 px at the light end down
// to 4.7 at the heavy one. The arithmetic of that is what broke the
// drizzle band. At the drizzle end a 46 px block held three lines and the
// trace tier held two — while 61 to 67% of all wet hours are under
// 0.5 mm. The modal rain hour was drawn with the least ink in the system.
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
// `H` is the block's height, and only the length ramp reads it: the
// longest mark has to fit the box or the top of the ramp flattens out
// against it. Omitted, the reference block's height is assumed, which is
// what the callers that only want the tier and the figure pass.
const amountFor = (mm, H) => {
    // One factor for the whole ramp, so the two tier boundaries keep their
    // order and their relative sizes. Never above 1: a tall block does not
    // get longer marks, it just stops clipping them.
    // Only the main segment is fitted. It is the only one a real block
    // is ever too short for: 26 px does not go into 15, while the light
    // band's 6.5 always has. Fitting the tiers below as well was measured
    // and moves their lattice for no gain, which shows up as a step at the
    // 0.3 mm boundary on the shortest block.
    //
    // The floor keeps the jump at 1 mm a jump UP. Squeezing the main
    // segment far enough would otherwise put its shortest mark below the
    // light band's longest, and the category boundary would read backwards.
    const fit = Math.min(1, ((H > 0 ? H : LN_BLOCK.H) * LN.lenFit) / LN.lenHi);
    const mainLo = Math.max(LN.lenLight * 1.2, LN.lenMain * fit);
    const mainHi = Math.max(mainLo * 1.15, LN.lenHi * fit);
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
    // Past the cap, weight alone keeps rising to the warning. Everything
    // else is held, so the block darkens without the marks merging.
    const over = clamp01((Math.min(mm, LN.warn) - LN.cap) / (LN.warn - LN.cap));
    return { sp: LN.spLo + (LN.spHi - LN.spLo) * t,
             sw: Math.max(LN.swMain + (LN.swHi - LN.swMain) * t
                          + (LN.swWarn - LN.swHi) * over, LN.swFloor),
             alpha: LN.alpha,
             len: mainLo + (mainHi - mainLo) * t,
             gap: LN.gapLo + (LN.gapHi - LN.gapLo) * t, trace: false, light: false };
};

// --- the block -------------------------------------------------------
// The chance channel is inherited: the marks reach `pop` per cent of the way
// across the block, anchored left, nothing below 8%. Unlike the pattern
// version the fill edge is not a CSS width on the wrapper but a rect the
// marks are clipped to, so a mark the edge crosses is drawn short with a
// round end instead of being cut in half.
//
// The committed band takes a floor and a gamma, because a bare 12% is
// about 5 px of a 46 px block and no texture survives 5 px.
const chanceBand = h => h.pop == null ? 1
    : LN.popFill + (1 - LN.popFill) * Math.pow(Math.min(100, h.pop) / 100, LN.popGamma);
// How far past the committed edge the ghost reaches, as a multiple of the
// chance. It is a ramp and not a tier test on purpose: a step here would
// be the amount moving the width, and the width is the chance. 1.0 is no
// over-reach at all, so the ghost has retired itself by the time the ramp
// ends and the block goes back to answering with its bare chance.
const ghostSpanFor = mm => LN.ghostSpan + (LN.ghostSpanEnd - LN.ghostSpan)
    * Math.max(0, Math.min(1, (mm - LN.ghostFull) / (LN.ghostTo - LN.ghostFull)));
// How much extra opacity this sky needs. Nothing on the dark skies most
// rain falls under, nothing on bright ones, and the full lift where the
// two blues cross and neither has any room. Peaks at the crossing rather
// than in the middle of the band, because that is where the floor is.
const lnLift = base => {
    const L = lnLum(base);
    const t = L <= LN.valleyMid ? (L - LN.valleyLo) / (LN.valleyMid - LN.valleyLo)
                                : (LN.valleyHi - L) / (LN.valleyHi - LN.valleyMid);
    return LN.valleyLift * Math.max(0, Math.min(1, t));
};
// Emit one path per strength. Marks may be shortened toward their own
// start and drawn at a lighter weight, which is how a ghost is told from
// a committed mark by size as well as by opacity.
// `group` is the fall layer being emitted, or null for the whole field.
// `cls` names the phase on the element. Every phase already differs in
// colour or opacity, but a phase is not the same thing as an opacity: the
// sky can move an alpha, and once it can, reading the alpha back to work
// out which phase drew a mark gives the wrong answer. Naming it costs a
// dozen bytes a block and makes the DOM say what it is.
const emitMarks = (segs, figure, m, c, alpha, scale, weight, group, cls) => {
    const src = group == null ? segs : segs.filter(s => s[10] % FALL_GROUPS === group);
    if (!src.length) return '';
    const use = scale === 1 ? src : src.map(s =>
        [s[0], s[1], s[0] + (s[2] - s[0]) * scale, s[1] + (s[3] - s[1]) * scale,
         s[4], s[5], s[6], s[7], s[8], s[9], s[10]]);
    // The ghost's weight is a FRACTION of the mark's, so it has to be held
    // to the same floor: a ghost of a thin mark lands at 0.64 px, which is
    // not a faint line but an absent one. Length and opacity carry the
    // difference instead, and both of those are still size and strength
    // rather than a single channel doing double duty.
    const sw = Math.max(m.sw * weight, LN.swFloor);
    const p = marksToPath(use, figure, { ...m, sw });
    const col = `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
    return (p.stroke ? `<path d="${p.stroke}" class="${cls}" stroke="${col}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none"${STROKE_FX}/>` : '')
        + (p.fill ? `<path d="${p.fill}" class="${cls}" fill="${col}"/>` : '');
};

// --- the block -------------------------------------------------------
// One lattice, three kinds of mark. Rain, snow and hail are marks ON it,
// never overlays stacked on top of each other: nothing is overlaid on
// anything, so the spacings cannot disagree and a pellet sits exactly
// where a raindrop would have. The alignment problem disappears rather
// than being tuned away.
//
// Sleet falls out for free. A flake gets a tail only while the hour is
// mixed, so a pure snow hour is pure dots — snow's established identity
// — a mixed hour reads as a mix, and pure rain is streaks.
const precipFieldSVG = (h, base, W, H, opts) => {
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
    // The chance floor applies to the CHANCE, not to the block. It used to
    // sit here as an early return, so an hour carrying 0.5 mm at 7% drew an
    // empty block and the same hour at 8% drew normally — and an hour at
    // 20 mm and 7% drew nothing at all. A deterministic amount with a
    // near-zero ensemble chance is contradictory data, but the block was
    // saying "nothing is falling" when what the data says is "the runs
    // disagree". `chanceBand` already has a floor and a gamma of its own,
    // so letting it run gives those hours a narrow committed fill that
    // joins up continuously with the hours just above the floor. An hour
    // with no amount either is still an empty block, from the guard below.
    // The trace tier is liquid-only. Below the floor the amount is
    // noise and the chance is the whole story, and a chance of snow is not
    // a story this texture can tell.
    if (total < LN.floor && (COND[h.condition].group === 'snow'
        || h.pop == null || h.pop < LN.popFloor)) return '';

    // The ramp decides the mark's opacity from the amount; the sky then
    // adds whatever this base needs to stay legible. Folded in here, once,
    // so everything downstream — the committed marks, the ghost derived
    // from them, a snow tail — is lifted by the same amount without any of
    // them having to know the correction exists.
    const m0 = amountFor(total, H);
    const lift = lnLift(base);
    const m = lift ? { ...m0, alpha: Math.min(0.95, m0.alpha + lift) } : m0;
    // How long the arrival takes to settle. It is decided HERE, where the
    // total is already in scope, and written onto the wrapper to inherit
    // down: the total is built from h.liquid, h.mm and the snow depth with
    // a condition-group test, and a second copy of that arithmetic
    // anywhere else would drift away from this one.
    //
    // Snow is slowest because it does not fall so much as arrive; heavy
    // rain is quickest, because a downpour that eases in is not a
    // downpour. The light end takes slightly longer than the middle so a
    // drizzle hour has time to read as drizzle.
    const settle = snow > 0 ? 5.0 : total >= 4 ? 2.4 : total < 1 ? 3.4 : 3.0;
    // `dark` means "the pale blue is the one in use", so it reads the same
    // threshold `lnBlue` switches on rather than a copy of it. The two were
    // the same number until the switch moved; leaving a literal here would
    // have cut the ghost hardest on the very skies the switch had just
    // handed to the deep blue.
    const c = lnBlue(base), dark = lnLum(base) <= LN_BLUE_SW;
    const band = chanceBand(h);
    // The ghost belongs to the amount, not to the tier. It runs a little
    // past the floor so that its reach can fall to nothing on the far
    // side, which is what keeps the drawn width answering the chance and
    // only the chance across the boundary. Well above the floor the block
    // has committed marks to read and the chance is not the only real
    // fact, so there is nothing left to ghost.
    const ghosted = total < LN.ghostTo && h.pop != null;
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
    const reach = ghosted ? Math.min(1, band * ghostSpanFor(total)) : band;

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

    // Snow and rain in the same block always draw straight.
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
    // The nil field carries an absolute alpha rather than a fraction of
    // the mark's, so the sky's correction has to be added to it by hand —
    // it is the faintest thing drawn and the valley is the last place it
    // can afford to be left behind.
    // How much of the dark cut this sky earns: all of it well below the
    // switch, none of it at the switch. One-sided, because above the
    // switch the deep blue is the one in use and the ghost was never cut
    // there.
    const near = Math.max(0, Math.min(1, (LN_BLUE_SW - lnLum(base)) / LN.cutSpan));
    const cut = f => dark ? 1 + (f - 1) * near : 1;
    const gA = nil ? LN.nilAlpha * cut(LN.nilDark) + lift
                   : m.alpha * LN.ghostAlpha * cut(LN.ghostDark);
    // Every phase of the field for ONE fall layer, or for the whole field
    // when `group` is null. Layering is a filter over the same marks and
    // nothing else: the roles, the geometry and the colours are all
    // decided above, so a layered block draws exactly the field an
    // unlayered one would, in three pieces.
    const buildPaths = group => {
        const pick = arr => group == null
            ? arr : arr.filter(s => s[10] % FALL_GROUPS === group);
        let out = emitMarks(rain, figure, mm, c, m.alpha, 1, 1, group, 'pf-rain')
            + emitMarks(ghost, figure, mm, c, gA,
                nil ? LN.nilScale : LN.ghostScale, nil ? LN.nilWeight : LN.ghostWeight,
                group, nil ? 'pf-nil' : 'pf-ghost');

        // Snow: a flake on the site, with a tail only while the hour is
        // mixed. White, because frozen precipitation keeps a constant
        // identity no sky can dilute.
        const gFlakes = pick(flakes);
        if (gFlakes.length) {
            const a = quantLean(h) * Math.PI / 180, fx = Math.sin(a), fy = Math.cos(a);
            const r = m.sw * LN.snowDot, tail = len * 0.5 * (1 - snowShare);
            let dots = '', tails = '';
            gFlakes.forEach(s => {
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
            let snowOut = '';
            if (tails) snowOut += `<path d="${tails}" class="pf-tail" stroke="rgba(${c[0]},${c[1]},${c[2]},${m.alpha})" stroke-width="${m.sw.toFixed(2)}" stroke-linecap="round" fill="none"${STROKE_FX}/>`;
            if (dots) snowOut += `<path d="${dots}" class="pf-flake" fill="rgba(255,255,255,0.92)"/>`;
            // Snow does not fall straight down the way rain does, so it
            // rides a damped wave inside its fall layer. Flake and tail
            // are in the one group: they share an anchor and have to
            // drift together.
            out += snowOut && group != null
                ? `<g class="pf-wave pf-snow">${snowOut}</g>` : snowOut;
        }
        // Hail: a short heavy white stub on the site, leaning with the rain.
        // Stub, not dot, so it is never snow; the open rings it replaces were
        // the only outline shape in a system made of round caps and filled
        // dots, and WMO 96/99 only mean hail in Central Europe, so the ring
        // asserted a fact the data does not hold elsewhere.
        const gPellets = pick(pellets);
        if (gPellets.length) {
            const a = quantLean(h) * Math.PI / 180, fx = Math.sin(a), fy = Math.cos(a);
            const e = Math.min(len * 0.45, m.sw * 1.15);
            let d = '';
            gPellets.forEach(s => {
                if (!onBlock(s, e)) return;
                const p = clipSeg(s[7] - fx * e, s[8] - fy * e, s[7] + fx * e, s[8] + fy * e,
                                  0, 0, reach * W, H);
                if (p) d += subStraight(p);
            });
            if (d) out += `<path d="${d}" class="pf-hail" stroke="rgba(255,255,255,0.95)" stroke-width="${m.sw.toFixed(2)}" stroke-linecap="round" fill="none"${STROKE_FX}/>`;
        }
        return out;
    };

    if (!(opts && opts.layered)) {
        const body = buildPaths(null);
        if (!body) return '';
        return `<span class="rain-ov">${svgOpen(W, H)}${body}</svg></span>`;
    }

    // Each layer is offset back along the fall direction by a whole number
    // of periods, so the marks start on lattice sites and the animation
    // ends on the resting field exactly.
    const fa = quantLean(h) * Math.PI / 180;
    const fdx = Math.sin(fa), fdy = Math.cos(fa);
    const period = mm.len + mm.gap;
    let body = '';
    for (let g = 0; g < FALL_GROUPS; g++) {
        const inner = buildPaths(g);
        if (!inner) continue;
        const tx = (-FALL_BACK[g] * period * fdx).toFixed(2);
        const ty = (-FALL_BACK[g] * period * fdy).toFixed(2);
        body += `<g class="pf-fall" style="--tx:${tx}px;--ty:${ty}px;--pe:${FALL_EASE[g]}">${inner}</g>`;
    }
    if (!body) return '';
    return `<span class="rain-ov" style="--pf-settle:${settle}s">`
         + `${svgOpen(W, H)}${body}</svg></span>`;
};

// Mist / low visibility. Short horizontal runs on the same lattice
// machinery, laid across the block rather than down it, so a murky
// drizzle hour draws both and neither reads as the other. Its own
// overlay, because it is not precipitation falling and does not belong
// on the precipitation lattice.
//
// It is checked before it is drawn: `vis` is null on any payload cached
// before the field was asked for, and on a provider that does not carry
// it, which an earlier optional field had to learn the hard way.

// The WMO codes that say fog outright: the same two the ≡ hazard glyph is
// keyed to (HAZARD_GLYPH in colors.js). Sharing one list is what stops the
// texture and the glyph disagreeing on the same block.
const FOG_CODE = { 45: 1, 48: 1 };

// Visibility alone was the test, at the 2 km mist boundary, and it answered
// the wrong question. Model visibility drops through that band during any
// decent shower — falling water is what it measures — so a plain wet
// afternoon drew a murk texture over a block already covered in rain marks,
// while the block beside it, a shade drier, drew none. It was reporting the
// rain, and the rain was drawn already.
//
// From 1 to 2 km the sky code now has to agree that it is fog. Below 1 km it
// does not: that is fog whatever the code calls it.
const misty = h => h.vis != null && h.vis <= LN.mistVis
    && (h.vis <= LN.fogVis || !!FOG_CODE[h.code]);

const mistSVG = (h, base, W, H, opts) => {
    if (!misty(h)) return '';
    const t = Math.max(0, Math.min(1, 1 - h.vis / LN.mistVis));
    const c = lnLum(base) > 135 ? [70, 78, 88] : [226, 232, 238];
    const len = LN.mistLen + (LN.mistLenHi - LN.mistLen) * t;
    const segs = markField(W, H, 90, {
        sp: LN.mistSp, sw: LN.mistSw, gap: LN.mistGap, len, fillW: W
    });
    const d = segs.filter(s => s[9]).map(subStraight).join('');
    if (!d) return '';
    const a = (LN.mistAlpha + (LN.mistAlphaHi - LN.mistAlpha) * t).toFixed(3);
    const path = `<path d="${d}" class="pf-murk" stroke="rgba(${c[0]},${c[1]},${c[2]},${a})" stroke-width="${LN.mistSw.toFixed(2)}" stroke-linecap="round" fill="none"${STROKE_FX}/>`;
    // One layer, not three: mist is a body of air moving past, not
    // discrete marks falling at their own rates. Its lean is 90deg, so it
    // travels horizontally and the wave that rides on it runs vertically.
    const body = opts && opts.layered
        ? `<g class="pf-mist" style="--tx:${(-3 * (len + LN.mistGap)).toFixed(2)}px">`
          + `<g class="pf-wave">${path}</g></g>`
        : path;
    return `<span class="rain-ov">${svgOpen(W, H)}${body}</svg></span>`;
};

// The overlay for one block, or ''. Same signature as the pattern
// renderer's, so the call site does not know which one it got.
const precipOverlay = (h, base, W, H, opts) => {
    const w = W > 0 ? W : LN_BLOCK.W, hh = H > 0 ? H : LN_BLOCK.H;
    return precipFieldSVG(h, base, w, hh, opts) + mistSVG(h, base, w, hh, opts);
};
