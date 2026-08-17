// shared/precip-pattern.js: the original precipitation overlay, the
// pattern renderer, exactly as it shipped.
//
// CLASSIC ONLY, and frozen. It moved out of colors.js unedited so that
// primary's mark field (shared/precip-field.js) could evolve without a
// second system living inside the same function, and so that classic is
// held still by not being touched rather than by a branch. Neither file
// is named by both variants; each index.html lists the one it carries,
// which is also why neither app.js knows which renderer it got.
//
// Loads AFTER colors.js: it reads lnBlue, lnLum and lnMix from there.
// Entry point, shared with precip-field.js:
//
//     precipOverlay(h, base, W, H) -> HTML string
//
// W and H are the block's pixel size. The pattern renderer does not need
// them — a pattern tiles to whatever box it is given — so it ignores
// them; the mark field does, which is why they are in the signature.

// --- Rain view: sky base + rain-streak overlay ---------------------
// The block colour is the sky (conditionRGB above: the WMO sky palette,
// rain-tinted, cloud-spread, night after local sunset), and rain lives
// entirely in a streak overlay drawn on top. Chance = left-to-right
// fill extent (nothing below 8%); intensity = one density/weight ramp
// (gamma 0.4, capped at 8 mm) under texture bands: below 0.3 mm a faint
// trace tick when the chance clears 8% (a likely light sprinkle the
// amount misses, since chance is the ensemble and amount the
// deterministic run), then ticks to 1, broken runs to 2, solid above;
// line colour = a luminance-tuned blue, so "blue = rain" reads.
// No base escalation: heavy rain saturates the density and
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
const LN = { sp0: 15, sp1: 4.7, sw0: 0.85, sw1: 2.6, gamma: 0.4, cap: 8,
             floor: 0.3, b1: 1, tlen: 3.7, tgap: 5.1, b2: 2, blen: 14, bgap: 6,
             shade: 0.5, alpha: 0.6, popFloor: 8, warn: 20,
             traceSp: 16, traceLen: 2.5, traceGap: 7, traceSw: 0.7, traceAlpha: 0.55,
             maxAngle: 55, windSat: 40,
             snowCap: 2 }; // cm/h; the 5-year Budapest maximum
// Hail rings borrow a neutral adaptive shade of the base (frozen, not
// rain, so not blue): darken a bright base, lighten a dark one.
const lnShade = b => lnLum(b) > 135 ? lnMix(b, [0, 0, 0], LN.shade) : lnMix(b, [255, 255, 255], LN.shade);
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
    const c = lnBlue(base); // blue, tuned to the base luminance
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
// and it lands on the overcast grey in ~97% of snow hours). No
// amount floor: any snowfall draws. Density and dot size ramp on
// cm/h (same gamma, cap 2 cm/h = the 5y max); fill = chance as for
// rain; wind lean at half strength (flakes drift, lines fall). A
// rainy-and-snowy hour stacks both overlays: that IS the sleet
// encoding, no extra vocabulary.
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

// The three overlays for one block, concatenated in the order app.js has
// always drawn them: rain lines under the snow lattice under the hail
// rings. Lines and lattice together on a mixed hour IS sleet.
const precipOverlay = (h, base, W, H) =>
    rainLinesSVG(h, base) + snowLatticeSVG(h) + hailRingsSVG(h, base);
