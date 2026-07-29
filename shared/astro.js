// --- Sky events: moon phase + notable lunar eclipses -------------
// Marked as a bare glyph on each day's 21:00 block (bottom-left, so
// it never collides with a bottom-right hazard). Text glyphs match
// the hazard vocabulary; custom SVG icons are a planned follow-up.
//
// Phase instants come from Meeus' "Astronomical Algorithms" ch.49
// (principal periodic terms only): a mean-synodic model drifts up to
// a day by the 2020s, but this stays within minutes, so a phase
// always lands on the right night. ΔT (<2 min) and planetary terms
// (<0.001 d) are dropped as far below a day boundary. `k` counts
// quarter-phases from the 2000 new moon: integer = new, +.25 first
// quarter, +.5 full, +.75 last.
const D2R = Math.PI / 180;
const phaseInstantMs = k => {
    const p = k - Math.floor(k);            // .00/.25/.50/.75
    const T = k / 1236.85;
    let J = 2451550.09766 + 29.530588861 * k
        + 0.00015437 * T*T - 0.000000150 * T*T*T + 0.00000000073 * T*T*T*T;
    const M  = (2.5534   + 29.10535670 * k - 0.0000014 * T*T - 0.00000011 * T*T*T) * D2R;
    const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T*T + 0.00001238 * T*T*T - 0.000000058 * T*T*T*T) * D2R;
    const F  = (160.7108 + 390.67050284 * k - 0.0016118 * T*T - 0.00000227 * T*T*T + 0.000000011 * T*T*T*T) * D2R;
    const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T*T + 0.00000215 * T*T*T) * D2R;
    const E = 1 - 0.002516 * T - 0.0000074 * T*T;
    const s = Math.sin;
    if (p < 1e-6 || Math.abs(p - 0.5) < 1e-6) { // new / full share the term set
        J += -0.40720*s(Mp) + 0.17241*E*s(M) + 0.01608*s(2*Mp) + 0.01039*s(2*F)
            + 0.00739*E*s(Mp-M) - 0.00514*E*s(Mp+M) + 0.00208*E*E*s(2*M)
            - 0.00111*s(Mp-2*F) - 0.00057*s(Mp+2*F) + 0.00056*E*s(2*Mp+M)
            - 0.00042*s(3*Mp) + 0.00042*E*s(M+2*F) + 0.00038*E*s(M-2*F)
            - 0.00024*E*s(2*Mp-M) - 0.00017*s(Om) - 0.00007*s(Mp+2*M)
            + 0.00004*s(2*Mp-2*F) + 0.00004*s(3*M) + 0.00003*s(Mp+M-2*F)
            + 0.00003*s(2*Mp+2*F) - 0.00003*s(Mp+M+2*F) + 0.00003*s(Mp-M+2*F)
            - 0.00002*s(Mp-M-2*F) - 0.00002*s(3*Mp+M) + 0.00002*s(4*Mp);
    } else {                                  // first / last quarter
        J += -0.62801*s(Mp) + 0.17172*E*s(M) - 0.01183*E*s(Mp+M) + 0.00862*s(2*Mp)
            + 0.00804*s(2*F) + 0.00454*E*s(Mp-M) + 0.00204*E*E*s(2*M)
            - 0.00180*s(Mp-2*F) - 0.00070*s(Mp+2*F) - 0.00040*s(3*Mp)
            - 0.00034*E*s(2*Mp-M) + 0.00032*E*s(M+2*F) + 0.00032*E*s(M-2*F)
            - 0.00028*E*E*s(Mp+2*M) + 0.00027*E*s(2*Mp+M) - 0.00017*s(Om)
            - 0.00005*s(Mp-M-2*F) + 0.00004*s(2*Mp+2*F) - 0.00004*s(Mp+M+2*F)
            + 0.00004*s(Mp-2*M) + 0.00003*s(Mp+M-2*F) + 0.00003*s(3*M)
            + 0.00002*s(2*Mp-2*F) + 0.00002*s(Mp-M+2*F) - 0.00002*s(3*Mp+M);
        const W = 0.00306 - 0.00038*E*Math.cos(M) + 0.00026*Math.cos(Mp)
            - 0.00002*Math.cos(Mp-M) + 0.00002*Math.cos(Mp+M) + 0.00002*Math.cos(2*F);
        J += p < 0.5 ? W : -W;                // first quarter +W, last quarter -W
    }
    return (J - 2440587.5) * 86400000;        // Julian Day → Unix ms (UTC)
};
// Values are [MR_ICON key, label]; the render draws the icon, the
// label rides the tooltip and aria.
const PHASE_MARK = { 0: ['new', 'New moon'], 0.25: ['first', 'First quarter'],
                     0.5: ['full', 'Full moon'], 0.75: ['last', 'Last quarter'] };
// total/partial lunar eclipses only (penumbral are barely perceptible);
// greatest eclipse in UTC. A 7-day forecast only ever reaches a few.
const LUNAR_ECLIPSES = [
    { t: Date.UTC(2026, 2, 3, 11, 34),   kind: 'total'   },
    { t: Date.UTC(2026, 7, 28, 4, 14),   kind: 'partial' },
    { t: Date.UTC(2028, 0, 12, 4, 14),   kind: 'partial' },
    { t: Date.UTC(2028, 6, 6, 18, 20),   kind: 'partial' },
    { t: Date.UTC(2028, 11, 31, 16, 52), kind: 'total'   }
];
// Sky event for a city-local date ("YYYY-MM-DD"), or null. The local
// day becomes a UTC window via the forecast's utc offset, so the mark
// lands on the right calendar day for the city. An eclipse (always at
// full moon) outranks the plain full-moon mark.
const skyEventFor = date => {
    const dayStart = Date.parse(date + 'T00:00:00Z') - (state.utcOffset || 0) * 1000;
    const dayEnd = dayStart + 86400000;
    const ecl = LUNAR_ECLIPSES.find(e => e.t >= dayStart && e.t < dayEnd);
    if (ecl) return { glyph: 'lunar', label: `Lunar eclipse (${ecl.kind})` };
    // scan the quarter-phases around this date for one landing today
    const approxK = (dayStart / 86400000 / 365.25 + 1970 - 2000) * 12.3685;
    const base = Math.round(approxK);
    for (let k = base - 1; k <= base + 1; k += 0.25) {
        const t = phaseInstantMs(k);
        if (t >= dayStart && t < dayEnd) {
            const mark = PHASE_MARK[Math.round((k - Math.floor(k)) * 4) / 4];
            return { glyph: mark[0], label: mark[1] };
        }
    }
    return null;
};
