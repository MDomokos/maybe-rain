# primary — current behaviour

*What this variant does today. Updated when behaviour changes, not when code moves.*

`primary/` is the active variant, published at the site root. It receives all new
design work. For *why* any of this is the way it is, see the decision records in
`SPEC.md`; for what shipped when, `CHANGELOG.md`; for how the code is split,
`../shared/README.md`.

---

## The screen

One viewport, no scrolling. Nothing above the grid but dates. Top to bottom:

- **Day row** — weekday over the date, one column per grid column.
- **Grid** — 7 columns × 16 rows at rest. Days across, hours 06:00–21:00 down.
  Every block is one real hour of one real day.
- **Side axis** — hour labels, with the current temperature in gold and a ▶ at
  the current hour when today is in frame.
- **Control row** — the city name, then the three views as words, each carrying
  its own current-hour reading. It sits directly under the grid, in the best
  reach on the screen, because it is the only row here that gets touched.
- **Bottom line** — one slot of fixed height with three occupants that never
  coexist: the status line at rest, the condition key while the grid is being
  touched or hovered, and the gesture hint on a first run. Fixed height, so the
  swap moves nothing, and the three dissolve rather than cut. The last thing on
  the screen: it is read, never pressed. The hint names one gesture per launch
  (cities, days, hours), skips any with nowhere to go, and each retires itself
  the first time its own gesture is used.

There is no header band, no ⚙ and no separate legend band. The three view
buttons are where the app prints the current temperature, chance of rain and
wind speed; the menu lives in the sheet the city name opens; the key takes the
last line while the grid is touched.

The status line carries the forecast in words in front of the freshness:
`overcast · Run 18:00 · next ~3:41`. The order is load-bearing — the slot
ellipsizes from the right, so on a narrow phone it is the freshness that falls
off the end and never the forecast. Only the resting freshness state does this;
every warning state (offline, stale, no data, update ready) keeps the whole
line to itself.

Sun lines mark dawn and dusk across the grid; a lunar phase or eclipse marks the
day's 21:00 block bottom-left. Hazard marks ride the block's bottom-right corner.

## Views

Three, cycled by the toggle row, a horizontal swipe, or ← →:

| view | block colour | overlay |
|---|---|---|
| **rain** | the sky as seen overhead (DR-38): clearness sets brightness, sunshine sets how gold, per-hour night. Rain tints toward navy by amount × chance; storms are dark slate, not violet, and carry the hazard on the glyph | rain streaks (chance = fill extent, amount = texture, wind lean), snow lattice, hail rings |
| **temp** | apparent temperature in absolute comfort bands | — |
| **wind** | speed ramp | centred direction arrow |

Any view can be turned off in ⚙; the switcher only cycles the enabled ones.

## Navigation

This is where primary diverges from classic. The grid frame never changes size —
gestures slide a window over more data instead of growing it.

Two surfaces, and which one a drag started on is what decides its meaning.

**On the grid**

- **Other days** — horizontal drag, one day per notch, forward and back. Back
  reaches the two past days the payload carries, for checking what happened
  overnight; past columns are dimmed and the tooltip names yesterday. A ⌂ chip
  returns home from either direction, and it self-returns after an idle window
  unless a tooltip is open, which counts as the screen being actively read. A
  horizontal wheel does the same.
- **More hours** — drag the hour gutter. A spring-loaded peek: the 16-slot
  window slides within the full 24, and springs home on release.
- **The key** — appears in the caption slot while a finger or pointer is on the
  grid, and gives the slot back on release.
- **The reach marks** — on the same signal as the key: a gold arrow at each side
  of the grid and a caret above and below the hour axis, drawn only in the
  directions the window can still travel. Nothing at rest.

**On the control row**

- **Switch city** — swipe up, or press and hold. The sheet opens under the
  finger, the row the finger is over is the aim, and releasing lands it. The
  list is ordered by recency with the current city at the bottom, so the city
  you were last on is one row away. While it is held the control row and the
  sheet's own action row are not drawn, and the aimed name is shown where the
  control row's name will be, so the release moves nothing.
  A release only lands a city the finger actually **aimed** at: opening the
  sheet and letting go without crossing to another row takes nothing, however
  the sheet was opened. The current city is not always in the list — it is the
  ★ favourites, and the place on screen need not be starred — so the bottom
  row cannot be relied on to be a harmless place to land.
- **Switch view** — swipe sideways, one step per swipe. Scrubbed: the grid
  crossfades under the finger and the active underline slides toward the view
  being pulled toward, so the destination is named before the release. Past a
  short dwell the pull maps to the sweep, and the release either completes it
  or rewinds it.
- **Search** — tap the city name. Every one of these is decided on release, so
  a tap that turns into a swipe is still a swipe — and a swipe that turns out
  to have been a tap with a thumb roll in it is still a tap. The press has to
  outlast a real long-press (400ms) before it counts as a hold, and travel
  further than the platform's own tap slop (18px) before it counts as a drag.
- **Keyboard** — ↑ ↓ step cities in the sheet's own order; ← → step views.
  Shift+← → step the day window, in both directions; Esc sends it home.

## Tooltip

A single tap on a block opens it; tapping the same block, the tooltip itself, or
anywhere else closes it. There is no pinned tier and no long press. An open
tooltip survives a city or view swipe and re-targets the same grid position, so
it doubles as the comparison tool.

Contents: hour, condition, temperature and apparent temperature, rain chance and
mm/h, snow cm/h, wind with gusts when they exceed the sustained wind
meaningfully, UV, and any hazard as a labelled chip. Sunrise and sunset lines
appear on the days that carry them.

## The sheet

Everything that is not the grid. Three bodies, one at a time, all opening from
the bottom: the saved places, the search, and the menu. One action row is pinned
to the bottom of all three — the mode you are in reads as the wide slot on the
left, the mode you are not is the button on the right. In search the wide slot
is the field itself.

The viewport meta carries `interactive-widget=resizes-content` so the on-screen
keyboard shrinks the layout viewport and the sheet sits above it rather than
behind it. A `visualViewport` fallback covers browsers that do not honour it,
gated at 80px so a retracting URL bar cannot trigger it.

## Places

- Tap the city name to search (Open-Meteo geocoding), or use the location button.
- **Favorites** (★) are the curated list the switcher cycles, capped at 9. With
  none saved it falls back to recents, so the gesture always has something.
- **Recents** are automatic, capped at 12, most-recently-used order.
- Both lists and the forecast cache are shared with classic — same storage keys,
  same 3-dp lat/lon identity.
- The current place lives in the URL, so any view is shareable. ⚙ → Share copies
  either the place link or the plain site link.

## Settings

One menu, reached from the sheet's own action row. Rows: Units, Wind, Clock, Hours, Views, Sun, Key,
♨ heat threshold, ☀ UV threshold, Share, What's new, Hourly data.

Thresholds apply at render time, so changing one repaints without a refetch.

## Data and freshness

- One request to Open-Meteo Best Match, 15 days, city-local timezone. No key, no
  backend, no analytics.
- The status line under the grid is the app's only state channel: model run time
  and next-update countdown at rest; loading, offline, copy confirmations and
  errors pass through it and clear themselves.
- Forecasts are cached per place, so switching cities paints instantly and
  revalidates behind. Cells whose forecast meaningfully moved since the previous
  model run pulse once, with the was/now detail in the tooltip.
- Stale data is labelled, never hidden or faked. Days fully in the past are
  dropped at render rather than relabelled.

## Offline and install

Installable PWA. The service worker precaches the shell under the
`maybe-rain-2.` prefix and serves it cache-first; `index.html` is network-first
so a deploy reaches installed apps. A genuine mid-session update announces itself
in the status line. Offline, the last forecast renders with the offline notice.

---

## Known-divergent from classic

Everything in **Navigation** and **The screen** above. Classic keeps the old
layout: a city name and ⚙ in a header, a min/max row, a legend band, and swipes
on the grid for city and view. It has a fixed week, no reach behind today, no
sheet, and no hourly current-marker keep-alive.

## Not built yet

Recorded as `Designed` in the SPEC status index: the hazard ruleset rewrite
(DR-31 / DR-31.5), the confidence falloff and resolution work (DR-33 / DR-34 /
DR-35), and localization (DR-8).
