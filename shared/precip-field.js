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
// Loads AFTER colors.js: it reads lnBlue, lnLum and lnMix from there.
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
const LN = { sp0: 15, sp1: 4.7, sw0: 0.85, sw1: 2.6, gamma: 0.4, cap: 8,
             floor: 0.3, b1: 1, tlen: 3.7, tgap: 5.1, b2: 2, blen: 14, bgap: 6,
             shade: 0.5, alpha: 0.6, popFloor: 8, warn: 20,
             traceSp: 16, traceLen: 2.5, traceGap: 7, traceSw: 0.7, traceAlpha: 0.55,
             maxAngle: 55, windSat: 40,
             snowCap: 2,   // cm/h; the 5y Budapest max (Climatology note)
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
// Hail rings borrow a neutral adaptive shade of the base (frozen, not
// rain, so not blue): darken a bright base, lighten a dark one.
const lnShade = b => lnLum(b) > 135 ? lnMix(b, [0, 0, 0], LN.shade) : lnMix(b, [255, 255, 255], LN.shade);
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
let lnId = 0; // unique per-render pattern ids

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
// A dot on the site's own centre, not on the clipped end. See markField.
const subDot = (s, r) =>
    `M${(s[7] - r).toFixed(2)} ${s[8].toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0Z`;

// Build the path data for a set of clipped segments. Stroked figures go in
// .stroke, filled ones in .fill; a figure may use both.
const marksToPath = (segs, figure, m) => ({
    stroke: segs.filter(s => s[9]).map(subStraight).join(''),
    fill: ''
});

// --- the amount ramp -------------------------------------------------
// Still DR-12's, unchanged: spacing and weight ride one gamma curve on mm
// and the three dash bands set the mark length. The field draws it rather
// than a pattern, so the only thing that is different is that a mark now
// begins and finishes where it means to. What the ramp SAYS changes next.
const amountFor = h => {
    // Marks draw from the liquid part only (rain + showers); the white
    // lattice carries the frozen part. Old cached payloads lack the split:
    // fall back to total mm, except on snow-coded hours where drawing rain
    // marks would misrepresent.
    const mm = h.liquid ?? (COND[h.condition].group === 'snow' ? null : h.mm);
    if (mm == null) return null;
    if (h.pop != null && h.pop < LN.popFloor) return null;
    const trace = mm < LN.floor;
    if (trace) {
        // The amount is below the 0.3 mm floor (often ~0), but the chance
        // is real. Amount is the deterministic run, chance is the ensemble
        // (P > 0.1 mm), so a high chance with ~0 mm is a likely light
        // sprinkle the amount misses. Chance-driven, and liquid rain only.
        if (COND[h.condition].group === 'snow') return null;
        if (h.pop == null || h.pop < LN.popFloor) return null;
        return { sp: LN.traceSp, sw: LN.traceSw, alpha: LN.traceAlpha,
                 len: LN.traceLen, gap: LN.traceGap, trace: true };
    }
    const t = Math.pow(Math.min(mm, LN.cap) / LN.cap, LN.gamma);
    const sp = LN.sp0 + (LN.sp1 - LN.sp0) * t;
    const sw = LN.sw0 + (LN.sw1 - LN.sw0) * t;
    // A solid run is one mark long enough to cross the block whatever the
    // lean, which the clip then cuts to the block's own height.
    let len = 999, gap = 0;
    if (mm < LN.b1) { len = LN.tlen; gap = LN.tgap; }
    else if (mm < LN.b2) { len = LN.blen; gap = LN.bgap; }
    return { sp, sw, alpha: LN.alpha, len, gap, trace: false };
};

// --- the block -------------------------------------------------------
// The chance channel is DR-12's: the marks reach `pop` per cent of the way
// across the block, anchored left, nothing below 8%. Unlike the pattern
// version the fill edge is not a CSS width on the wrapper but a rect the
// marks are clipped to, so a mark the edge crosses is drawn short with a
// round end instead of being cut in half.
const rainFieldSVG = (h, base, W, H) => {
    const m = amountFor(h);
    if (!m) return '';
    const c = lnBlue(base);
    const fillW = (h.pop == null ? 1 : Math.min(100, h.pop) / 100) * W;
    const segs = markField(W, H, quantLean(h), { ...m, fillW });
    const p = marksToPath(segs, 'straight', m);
    if (!p.stroke && !p.fill) return '';
    const col = `rgba(${c[0]},${c[1]},${c[2]},${m.alpha})`;
    const paths = (p.stroke ? `<path d="${p.stroke}" stroke="${col}" stroke-width="${m.sw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` : '')
        + (p.fill ? `<path d="${p.fill}" fill="${col}"/>` : '');
    return `<span class="rain-ov"><svg xmlns="http://www.w3.org/2000/svg">${paths}</svg></span>`;
};

// Snow and hail still ride their own overlays here, unchanged from DR-12
// and DR-15. They join the rain's lattice in a later commit; until they do,
// primary needs its own copy of them, because it no longer loads the
// pattern file they used to live in.
const snowLatticeSVG = h => {
    if (h.snow == null || h.snow <= 0) return '';
    if (h.pop != null && h.pop < LN.popFloor) return '';
    const t = Math.pow(Math.min(h.snow, LN.snowCap) / LN.snowCap, LN.gamma);
    const sp = (14 - (14 - 5.2) * t) / Math.SQRT2, r = 0.8 + 0.8 * t;
    const ang = (windLean(h) * 0.5).toFixed(1);
    const id = 'mrsn' + (lnId++);
    const dot = (cx, cy) => `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="rgba(255,255,255,0.92)"/>`;
    const pat = `<pattern id="${id}" width="${(sp * 2).toFixed(2)}" height="${(sp * 2).toFixed(2)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})">${dot(sp * 0.5, sp * 0.5)}${dot(sp * 1.5, sp * 1.5)}</pattern>`;
    const wp = h.pop == null ? 100 : Math.min(100, h.pop);
    return `<span class="rain-ov" style="width:${wp}%"><svg xmlns="http://www.w3.org/2000/svg"><defs>${pat}</defs><rect width="100%" height="100%" fill="url(#${id})"/></svg></span>`;
};
const HAIL_CODES = new Set([96, 99]);
const hailRingsSVG = (h, base) => {
    if (!HAIL_CODES.has(h.code)) return '';
    const c = lnShade(base);
    const id = 'mrhl' + (lnId++);
    const ring = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="2.2" fill="none" stroke="rgba(${c[0]},${c[1]},${c[2]},0.9)" stroke-width="0.9"/>`;
    const pat = `<pattern id="${id}" width="18" height="18" patternUnits="userSpaceOnUse">${ring(4.5, 4.5)}${ring(13.5, 13.5)}</pattern>`;
    return `<span class="rain-ov"><svg xmlns="http://www.w3.org/2000/svg"><defs>${pat}</defs><rect width="100%" height="100%" fill="url(#${id})"/></svg></span>`;
};

// The overlay for one block, or ''. Same signature as the pattern
// renderer's, so the call site does not know which one it got.
const precipOverlay = (h, base, W, H) => {
    const w = W > 0 ? W : LN_BLOCK.W, hh = H > 0 ? H : LN_BLOCK.H;
    return rainFieldSVG(h, base, w, hh) + snowLatticeSVG(h) + hailRingsSVG(h, base);
};
