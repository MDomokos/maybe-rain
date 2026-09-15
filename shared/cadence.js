// --- Native cadence, detected from the response (DR-35) -----------
//
// Most hourly forecasts are not hourly. Past a model's native step the
// in-between hours are filled in from coarser knots, and this reads the
// hourly temperature series to find where that starts. No extra request:
// the arithmetic runs over an array the app already has.
//
// This is a PORT of `research/tz-boundary-probe.py`, not a second
// derivation of it. Same function names, same argument order, same
// constants, same control flow, so the two can be diffed by eye.
// `research/test-cadence.mjs` holds it to the probe's own six planted
// series, via the fixture `--dump-cases` writes. Change one and the other
// has to move with it.
//
// Four properties are load-bearing, each paid for by a bug the probe hit:
//
//   Phase is SEARCHED, never assumed. The knots sit at 00/06/12 UTC and
//   the app requests a local timezone, so the seam lands at
//   `utc_offset mod k` rather than at a multiple of k. A phase-0 search
//   read five cities out of six as uncoarsened when they were not.
//
//   Two stages. Find the earliest index from which the WHOLE remaining
//   series rebuilds at 6-hourly, then classify what precedes it at
//   3-hourly, with the window stopping SHORT of that boundary. The
//   transition band sits just before the seam, so a window clipped exactly
//   to it still swallows it and then fits nothing at any phase.
//
//   Three outcomes, not two. There is a ~6-hour band at each cadence
//   change where neither step reconstructs. A two-outcome detector reads
//   that as native hourly and draws 24 cells over a day that is not
//   hourly, which is the one direction principle 4 cannot absorb. UNKNOWN
//   coarsens.
//
//   A spread guard, first. A flat stretch fits every scheme trivially,
//   because there is no diurnal signal to miss.
//
// Catmull-Rom, not linear: Open-Meteo interpolates with a cubic Hermite
// spline. A linear rebuild misses manufactured hours by 0.45 °C where
// Catmull-Rom lands within 0.07, so a linear test reports manufactured
// hours as computed. `temperature_2m` only: 0.1 °C over a 10-15 °C
// diurnal swing carries the signal, integer-percent fields do not, which
// is why probability needs its own detector and does not appear here.
//
// Nothing here is stable enough to cache across payloads. The boundary's
// index moves with the age of the model run (156, then 144, then 156 for
// one city in one timezone) and its lead from initialisation moves too
// (144 at a 00Z or 12Z init, 150 at a 06Z or 18Z one). There is no
// constant to hold. A reading belongs to the payload it was read from and
// to the city that payload is for.

const CAD_THRESH = 0.15;      // °C. The empty gap between manufactured
                              // (0.06-0.08) and computed (0.19-0.68).
const CAD_MIN_SPREAD = 3.0;   // °C. Below a diurnal spread, no reading.
const CAD_BACKOFF = 12;       // Hours to stop short of a found seam, to
                              // clear the ~6h transition band plus the
                              // Catmull-Rom stencil's reach.

// Value at t in [0,1] between p1 and p2, uniform Catmull-Rom.
const catmullRom = (p0, p1, p2, p3, t) =>
    0.5 * ((2 * p1)
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

// Worst error rebuilding every non-knot hour in [lo, hi) from knots at
// indices congruent to `phase` mod k. Null when the window holds nothing
// rebuildable, which is not the same as rebuilding perfectly and must not
// be collapsed into 0.
const rebuildError = (v, k, phase, lo, hi) => {
    let worst = null;
    for (let i = lo; i < hi; i++) {
        if ((i - phase) % k === 0) continue;
        const base = phase + Math.floor((i - phase) / k) * k;
        const idx = [base - k, base, base + k, base + 2 * k];
        if (idx[0] < 0 || idx[3] >= v.length) continue;
        const pts = idx.map(j => v[j]);
        if (pts.some(p => p == null) || v[i] == null) continue;
        const err = Math.abs(catmullRom(pts[0], pts[1], pts[2], pts[3], (i - base) / k) - v[i]);
        worst = worst === null ? err : Math.max(worst, err);
    }
    return worst;
};

const cadSpread = (v, lo, hi) => {
    const w = v.slice(lo, hi).filter(x => x != null);
    return w.length ? Math.max(...w) - Math.min(...w) : 0;
};

// Stage one. Earliest index from which the series rebuilds at step k,
// searched over every phase. Returns [null, null] when no such index
// exists, which is the right answer for a GFS-backed city asked about a
// 6-hourly step inside ten days.
const cadOnset = (v, k, hi = null, thresh = CAD_THRESH) => {
    const n = hi === null ? v.length : hi;
    let best = null;
    for (let phase = 0; phase < k; phase++) {
        let start = phase;
        while (start < n - 4 * k) {
            if (cadSpread(v, start, n) < CAD_MIN_SPREAD) break;
            const err = rebuildError(v, k, phase, start, n - 2 * k);
            if (err !== null && err < thresh) {
                if (best === null || start < best[0]) best = [start, phase];
                break;
            }
            start += k;
        }
    }
    return best || [null, null];
};

// Both stages, and the third outcome. Either onset may be null. The band
// between where the 3-hourly fit stops holding and where the 6-hourly one
// starts is unknown, and the caller coarsens across it rather than
// treating it as native.
const cadClassify = v => {
    const [six, sixPhase] = cadOnset(v, 6);

    // Stage two stops SHORT of the seam, not at it.
    const limit = six !== null ? six - CAD_BACKOFF : v.length - 6;
    let three = null, threePhase = null;
    if (limit > 12) {
        for (let phase = 0; phase < 3; phase++) {
            let start = phase;
            while (start < limit - 12) {
                if (cadSpread(v, start, limit) < CAD_MIN_SPREAD) break;
                const err = rebuildError(v, 3, phase, start, limit);
                if (err !== null && err < CAD_THRESH) {
                    if (three === null || start < three) { three = start; threePhase = phase; }
                    break;
                }
                start += 3;
            }
        }
    }

    // Walk the 3-hourly window's end forward toward the seam to find where
    // it actually stops holding, rather than reporting the backoff as the
    // answer.
    let note = '';
    let unknownFrom = null, unknownTo = null;
    if (six !== null && three !== null) {
        let end = limit;
        while (end + 3 <= six) {
            const err = rebuildError(v, 3, threePhase, three, end + 3);
            if (err === null || err >= CAD_THRESH) break;
            end += 3;
        }
        if (six - end >= 3) {
            note = `unknown ${end}..${six}, coarsen across it`;
            unknownFrom = end;
            unknownTo = six;
        }
    }
    return { six, sixPhase, three, threePhase, unknownFrom, unknownTo, note };
};

// --- What the app asks it ------------------------------------------
//
// `hourly` is the payload's hourly object, or a bare temperature array for
// the test harness. The reading is read-only and belongs to one payload:
// build a new one per payload, never carry one between cities.
//
// `at(i)` answers DR-35's three outcomes for one index. `stepAt(i)` is how
// many hours one computed value covers there, which is what a renderer
// would group on once DR-44's setting exists. Unknown answers 6, because
// unknown coarsens.
const detectCadence = hourly => {
    const v = Array.isArray(hourly) ? hourly : (hourly && hourly.temperature_2m);
    const time = Array.isArray(hourly) ? null : (hourly && hourly.time);
    // Too short to say anything. Silence, not a claim of hourly.
    if (!Array.isArray(v) || v.length < 24) {
        return {
            n: 0, six: null, sixPhase: null, three: null, threePhase: null,
            unknownFrom: null, unknownTo: null, note: '',
            at: () => null, stepAt: () => null,
            over: () => ({ state: null, step: null }),
            indexOf: () => null, timeAt: () => null
        };
    }
    const c = cadClassify(v);
    const n = v.length;

    // Local ISO hour → index, built on first use. First one wins, so the
    // repeated hour at a daylight-saving fall-back resolves to the earlier
    // of the two rather than to neither.
    let byHour = null;
    const indexOf = (date, hour) => {
        if (!time) return null;
        if (!byHour) {
            byHour = new Map();
            for (let i = 0; i < time.length; i++) {
                const k = time[i].slice(0, 13);
                if (!byHour.has(k)) byHour.set(k, i);
            }
        }
        const i = byHour.get(`${date}T${String(hour).padStart(2, '0')}`);
        return i === undefined ? null : i;
    };

    const at = i => {
        if (i == null || i < 0 || i >= n) return null;
        if (c.six !== null && i >= c.six) return 'coarse';
        if (c.unknownFrom !== null && i >= c.unknownFrom && i < c.unknownTo) return 'unknown';
        if (c.three !== null && i >= c.three) return 'coarse';
        return 'hourly';
    };

    const stepAt = i => {
        const s = at(i);
        if (s === null) return null;
        if (s === 'hourly') return 1;
        if (s === 'unknown') return 6;
        return c.six !== null && i >= c.six ? 6 : 3;
    };

    // The worst reading across the `slots` hours starting at `date` `hour`,
    // as {state, step}. A block straddling a seam is not hourly, and the
    // least certain hour in it is the one a reading has to state. Ranked
    // hourly < 3-hourly < 6-hourly < unknown.
    //
    // An hour the payload does not reach is skipped rather than counted as
    // hourly: a missing index is an absent reading, not a clean one. When
    // no hour in the range resolves, state is null and the caller says
    // nothing.
    const over = (date, hour, slots = 1) => {
        let best = { state: null, step: null }, rank = -1;
        for (let k = 0; k < slots; k++) {
            const i = indexOf(date, hour + k);
            const what = at(i);
            if (what === null) continue;
            const step = stepAt(i);
            const r = what === 'unknown' ? 3 : what === 'hourly' ? 0 : step === 6 ? 2 : 1;
            if (r > rank) { rank = r; best = { state: what, step }; }
        }
        return best;
    };

    return {
        ...c, n, at, stepAt, indexOf, over,
        timeAt: i => (time && i != null && i >= 0 && i < time.length) ? time[i] : null
    };
};
