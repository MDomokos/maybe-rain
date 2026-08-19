# classic — current behaviour

*What this variant does today. Updated when behaviour changes, not when code moves.*

`classic/` is **frozen** at the `classic-baseline` tag and published at
`/classic/`. It is feature-complete and stays that way: correctness, security and
shared-core fixes only, never new behaviour. New design work happens in
`primary/`.

For how the code is split, see `../shared/README.md`.

---

## The screen

One viewport, no scrolling. Header (city name, ⚙), the grid, the hour axis, the
day row with min/max, the toggle row with the status line, and the legend.

The grid is **7 columns × 16 rows, fixed** — days across, hours 06:00–21:00 down,
switchable to all 24 hours in ⚙. One week, always. There is no way to reach an
eighth day.

Sun lines mark dawn and dusk; lunar phase and eclipse marks ride each day's 21:00
block bottom-left; hazard marks ride the bottom-right corner.

## Views

Three — **rain**, **temp**, **wind** — with the same encodings as primary, since
the whole colour system lives in `shared/colors.js`. Cycled by the toggle row, a
horizontal swipe, or ← →. Any view can be disabled in ⚙.

## Navigation

Deliberately plain. This is the main difference from primary.

- **Switch view** — one-finger horizontal swipe, or ← →. The transition plays as
  a colour wave after the gesture completes; it is not scrubbed under the finger
  and cannot be half-pulled and reversed.
- **Switch city** — one-finger vertical swipe, or ↑ ↓. One step per swipe. No
  detents, no multi-step selector, no mid-drag destination readout.
- **No rails, no drawer, no peek.** There is nothing to drag for more hours or
  more days.

## Tooltip

Identical to primary: single tap opens, tapping the block again, the tooltip, or
anywhere else closes. No pinned tier, no long press. An open tooltip survives a
swipe and re-targets the same grid position.

## Places, settings, data

Identical to primary, and genuinely shared rather than merely similar:

- Favorites (capped at 9), recents (capped at 12), the per-place forecast cache,
  and the deep-link URL all use the **same storage keys** as primary. A favorite
  starred here appears there, and a forecast fetched there paints here with no
  extra request.
- The same one ⚙ menu, same rows, same render-time thresholds.
- The same Open-Meteo Best Match request, and — importantly — the **same 15-day
  horizon** as primary even though classic only ever paints 8 days of it. A
  shared cache holding two different horizons breaks in both directions; see
  `config.js`.
- The same status line rules, per-place cache, change pulses, and honest staleness
  labelling.

## Offline and install

Installable PWA in its own scope. Its service worker uses the `maybe-rain-1.`
prefix, so activating it never evicts primary's shell (and vice versa). Neither
prefix may become a prefix of the other.

---

## What classic deliberately does not have

Excluded at the split, and not coming later:

- The sliding window: extended hours peek, day drawer, 14-day reach.
- The scrubbed view transition.
- The detented city selector and its keyboard lockstep.
- The hourly current-marker keep-alive. Classic arms a midnight rollover
  only, so its "now" marker refreshes on the next fetch or day rollover rather
  than on the hour.
