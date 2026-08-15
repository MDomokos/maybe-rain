# primary — current behaviour

*What this variant does today. Updated when behaviour changes, not when code moves.*

`primary/` is the active variant, published at the site root. It receives all new
design work. For *why* any of this is the way it is, see the decision records in
`SPEC.md`; for what shipped when, `CHANGELOG.md`; for how the code is split,
`../shared/README.md`.

---

## The screen

One viewport, no scrolling. Nothing above the grid but dates. Top to bottom:

- **Day row** — weekday over the date, one column per grid column. A column
  that has narrowed drops to the date alone, then to nothing.
- **Grid** — 7 columns × 16 rows at rest. Days across, hours 06:00–21:00 down.
  Every block in the home week is one real hour of one real day. Days pulled in
  from beyond it draw at the granularity the forecast actually has: 3-hour
  blocks at lead 7–8, 6-hour at 9–10, one inset daily bar from 11.
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
  (cities, days, hours, peek), skips any with nowhere to go, and each retires
  itself the first time its own gesture is used.

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
gestures make room inside it rather than growing it or scrolling it away.

Two surfaces, and which one a drag started on is what decides its meaning.

**On the grid**

- **Other days** — pull sideways from the side the days you want are on. They
  accordion in continuously under the finger while the home week squishes to
  pay for them; today never leaves the screen. Forward reaches seven days past
  the home week; back reaches the two past days the payload carries, for
  checking what happened overnight, and past columns are dimmed. Past days cost
  more travel per day, so the two ends are a comparable pull apart.
  - **Let go anywhere short of the end and it was a peek.** The grid bounces
    home. There is no scroll position, so there is nothing to lose.
  - **At the end the columns freeze** and the whole grid slides toward the pull
    instead, its trailing edge clipping into black. A little way into that
    slide a hairline beside the grid brightens and goes solid, with one haptic
    tick: **release there and the stretch locks open.**
  - **Locked is a place.** Taps open tooltips exactly as at home. Three ways
    out, all of them home: the same pull again to the same mark, a clear pull
    back, or ⌂ / Esc. Anything less is a wiggle and the lock holds. The ⌂ chip
    exists only while locked.
  - A horizontal wheel holds a peek open and lets it bounce a beat after it
    stops. It cannot lock: there is no release to read.
- **More hours** — drag the hour gutter. A spring-loaded peek: the 16-slot
  window slides within the full 24, and springs home on release.
- **The key** — appears in the caption slot while a finger or pointer is on the
  grid, and gives the slot back on release.
- **The reach carets** — on the same signal as the key: a caret above and below
  the hour axis, drawn only in the directions the hour window can still travel.
  Nothing at rest. The day axis needs none: the columns making room say it.

**On the control row**

- **Switch city** — swipe up, or press and hold. The sheet opens under the
  finger, the row the finger is over is the aim, and releasing lands it. See
  **Places** for what the list contains and in what order. While it is held
  the control row and the sheet's own action row are not drawn, and the aimed
  name is shown where the control row's name will be, so the release moves
  nothing. Beside it, the aimed row's tier — `pinned`, `recent`, `back`, or
  `now` when a release would change nothing.
- **Peek** — the same gesture, released on the row it started on. The grid
  previews each aimed city at its true colours, so holding and letting go
  where you were is "let me just check over there" and costs nothing.
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
- **Keyboard** — ↑ steps to the row above the current city, which is the swap;
  ← → step views. ↓ from a closed sheet does nothing by construction — the
  current city is the bottom row, so there is nothing below it. Both arrows
  are live with the sheet open, where the aim can be anywhere in the list.
  Shift+← → nudge the day elastic a day at a time, in both directions, and it
  holds where it is put; Shift+End locks the stretch open and lets it go again;
  Esc and ⌂ are home.

## Tooltip

A single tap on a block opens it; tapping the same block, the tooltip itself, or
anywhere else closes it. There is no pinned tier and no long press. An open
tooltip survives a city or view swipe and re-targets the same grid position, so
it doubles as the comparison tool.

While a switcher preview is aimed, an open tooltip prints **both** cities on
one line — same date, same hour, the current reading and the aimed one, in the
active view's terms. Matched on the date rather than the column, so two cities
whose today sits at different indices are still compared hour for hour. It
goes when the sheet does.

Contents: hour, condition, temperature and apparent temperature, rain chance and
mm/h, snow cm/h, wind with gusts when they exceed the sustained wind
meaningfully, UV, and any hazard as a labelled chip. Sunrise and sunset lines
appear on the days that carry them.

On a far day, where a block stands for several hours, the header gives the hour
range instead of the hour, the rain and snow figures are totals across the block
rather than rates, and a line says what the block is — `3-hour block · beyond
native hourly`, or `daily value` on the single daily bar.

## The sheet

Everything that is not the grid. Three bodies, one at a time, all opening from
the bottom: the saved places, the search, and the menu. One action row is pinned
to the bottom of all three — the mode you are in reads as the wide slot on the
left, the mode you are not is the button on the right. In search the wide slot
is the field itself.

The places list is **frozen for the life of an opening**: its rows are taken
once when the sheet opens, and every row index means an index into that array
until it closes. Search is a mode of the same sheet and pinning from it
reshapes the tiers, so `setSheetMode('places')` — the one door back in —
re-snapshots the rows and rebuilds the DOM together, keeping the aim on the
same city across the renumbering.

The viewport meta carries `interactive-widget=resizes-content` so the on-screen
keyboard shrinks the layout viewport and the sheet sits above it rather than
behind it. A `visualViewport` fallback covers browsers that do not honour it,
gated at 80px so a retracting URL bar cannot trigger it.

## Places

Tap the city name to search (Open-Meteo geocoding), or use the location button.

The switcher is a **tiered list**, not a favourites list. Bottom-up, which is
the direction the thumb travels:

| tier | what it holds | order |
|---|---|---|
| **current** | the city on screen, always, pinned or not | the bottom row |
| **back** | the city the last switch came from | one row up — drawn only when that city is not pinned |
| **pinned** (★) | your mains, capped at 5 | pin order, reversed, so the first city you pin is nearest the thumb. They do not move |
| **transient** | cities you looked up | MRU, capped at 3, dropped after 72h without a visit |

Read down, the gradient is commitment; read up from the thumb, it is cost. The
swap is one row whenever the previous city is not pinned. Groups are split by a
hairline seam — except between **back** and **current**, which are the swap and
belong together.

Every row carries that city's **current reading for the active view** (chance
in rain, degrees in temp, speed in wind), read off its cached forecast. A city
with no cache reads blank, never a zero.

- **Pinning, not favouriting.** A searched city enters the transient tier by
  itself and ages out by itself; nothing needs cleaning up. In the search list
  ★ pins and ✕ unpins, one action per row, never both. Unpinning is a
  demotion into the transient tier, not a delete.
- **Recents** are still automatic and capped at 12; the transient tier is the
  freshest 3 of them that are not otherwise on the list.
- Both lists and the forecast cache are shared with classic — same storage keys,
  same 3-dp lat/lon identity. Recents now also carry `seenAt`, which classic
  ignores.
- The search list is grouped the same way: pinned, recents, then live results,
  seamed and named.
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
