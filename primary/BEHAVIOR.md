# primary — current behaviour

*What this variant does today. Updated when behaviour changes, not when code moves.*

`primary/` is the active variant, published at the site root. It receives all new
design work. For what shipped when, see `CHANGELOG.md`; for how the code is
split, `../shared/README.md`.

---

## The screen

One viewport, no scrolling. Nothing above the grid but dates. Top to bottom:

- **Day row** — the date over its weekday, one column per grid column. A column
  that has narrowed fades the weekday out, then the date too. The date is the
  top line so that losing the weekday moves nothing, and the row keeps its
  height either way so the grid never shifts under a pull.
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
  swap moves nothing, and the three dissolve rather than cut. It takes the full
  width of the screen — nothing in it is a column, so it keeps none of the
  grid's gutter. The last thing on
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
| **rain** | the sky as seen overhead: clearness sets brightness, sunshine sets how gold, per-hour night. Rain tints toward navy by amount × chance; storms are dark slate, not violet, and carry the hazard on the glyph | a field of falling marks, plus a mist texture where visibility drops |
| **temp** | apparent temperature in absolute comfort bands | — |
| **wind** | speed ramp | centred direction arrow |

Any view can be turned off in ⚙; the switcher only cycles the enabled ones.

### What the rain overlay says

Four facts, four independent properties of one lattice of marks. Nothing is
overlaid on anything, so the three phases cannot disagree about where a mark
belongs.

| fact | how it is drawn |
|---|---|
| **how much** | the mark's length and weight. Under 0.3 mm, grain — short ticks of varying length. From 0.3 to 1 mm, broken — each site a dot, a tick or a dash. Above 1 mm, a plain run that grows, from 12.5 px to 26. The jump between the drizzle band and rain is deliberate: it is the jacket question answered as a change of size |
| **how likely** | how far across the block the marks reach, anchored left, nothing below 8% |
| **which way** | the lean, in five steps — straight down, and 13° or 26° either side. Hours in the same airflow share an angle, so a windy afternoon leans as one block of grid |
| **what kind** | which mark a site carries. A blue streak is rain, a white dot is a flake, a short white stub is hail. A flake grows a tail only while the hour is mixed, so a sleet hour reads as a mix and a pure snow hour is pure dots |

Two readings sit outside that. An hour under 0.3 mm keeps a **ghost** past the
edge its chance commits to: the same marks at reduced strength, out to about
twice as far, meaning "possibly a bit more than this". An hour with a real
chance but **nothing forecast** is drawn entirely in that ghost — no committed
mark at all — which is a thing you can see rather than something only the
tooltip knows. Below 2 km visibility the block also draws short **horizontal**
runs, which is the one direction nothing else uses, so a murky drizzle hour
draws both and neither reads as the other.

Every mark begins and finishes where it means to: marks are clipped to the block
and to the chance edge and finished with round caps, so nothing is severed by an
edge. All the marks of one phase in a block are one path, so the overlay is the
same single element the old pattern was.

Classic still draws the older pattern overlay, deliberately: `shared/precip-pattern.js`
is named only by `classic/index.html` and `shared/precip-field.js` only by
primary's, and both answer to the same `precipOverlay` call.

## Navigation

This is where primary diverges from classic. The grid frame never changes size —
gestures make room inside it rather than growing it or scrolling it away.

Two surfaces, and which one a drag started on is what decides its meaning.

**On the grid**

- **Other days** — pull sideways from the side the days you want are on. They
  accordion in continuously under the finger while the home week squishes to
  pay for them; today never leaves the screen. Forward reaches seven days past
  the home week; back reaches the two past days the payload carries, for
  checking what happened overnight. Past columns recede slightly, in brightness
  and saturation together, and the day row draws a seam where they end — enough
  to read as behind while keeping the conditions comparable, which is the whole
  reason to look back. Past days cost
  more travel per day, so the two ends are a comparable pull apart.
  - **Let go anywhere short of the end and it was a peek.** The grid eases
    home and stops on home — it never overshoots, because home is the seam
    between the two sides and anything past it would reveal a day from the end
    the pull was leaving. There is no scroll position, so there is nothing to
    lose.
  - **At the end the columns freeze** and the whole grid slides toward the pull
    instead, its trailing edge clipping into black. A little way into that
    slide a hairline beside the grid grows and brightens, then goes solid with
    one haptic tick: **release there and the stretch locks open.** One pixel
    wide throughout — it answers the threshold by lighting up, never by
    thickening.
  - **A flick is answered in words.** The axis is dragged and held; there is no
    momentum in it anywhere, so a thrown swipe opens a few days and shuts them
    before they can be read. A release that fast, after that little travel,
    puts one transient line in the status line saying to keep hold of the drag.
    Three times ever, and never again once a stretch has been locked open.
  - **Locked is a place.** Taps open tooltips exactly as at home. Three ways
    out, all of them home: the same pull again to the same mark, a clear pull
    back, or ⌂ / Esc. Anything less is a wiggle and the lock holds. The ⌂ chip
    exists only while locked.
  - **A lock survives a city or view switch.** It is held as a distance from
    today, so it means the same thing against the new grid — "how do these
    days look over there / in wind" is the question the switch is asking, and
    it took two gestures when the switch closed the stretch. A shorter payload
    clamps it to what that city actually has; a city with no reach at all
    closes it. An unlocked stretch, and the hour peek, still go home. Nothing
    is stored: the app still opens on the home week.
  - A horizontal wheel holds a peek open and lets it ease home a beat after it
    stops. It cannot lock: there is no release to read.
- **More hours** — drag the hour gutter. A spring-loaded peek: the 16-slot
  window slides within the full 24, and springs home on release.
- **The key** — appears in the caption slot while a finger or pointer is on the
  grid, and gives the slot back on release.
- **The reach carets** — on the same signal as the key: a caret above and below
  the hour axis, drawn only in the directions the hour window can still travel.
  Nothing at rest. The day axis needs none: the columns making room say it.

**On the control row**

- **Switch city** — swipe up. The sheet opens under the finger, the row the
  finger is over is the aim, and releasing lands it. See **Places** for what
  the list contains and in what order. While the swipe is held the control row
  and the sheet's own action row are not drawn, and the aimed name is shown
  where the control row's name will be, so the release moves nothing. Beside
  it, the aimed row's tier — `pinned`, `recent`, `back`, or `now` when a
  release would change nothing.
  A release only lands a city the finger actually **aimed** at: opening the
  sheet and letting go without crossing to another row takes nothing.
- **Peek** — the same gesture, released on the row it started on. The grid
  previews each aimed city at its true colours, so swiping up and letting go
  where you were is "let me just check over there" and costs nothing.
- **Switch view** — swipe sideways, one step per swipe. Scrubbed: the grid
  crossfades under the finger and the active underline slides toward the view
  being pulled toward, so the destination is named before the release. Past a
  short dwell the pull maps to the sweep, and the release either completes it
  or rewinds it.
- **Search** — tap the city name. Every one of these is decided on release, so
  a tap that turns into a swipe is still a swipe, and a press that never
  travels is a tap however long it is held.
  **Distance is the only arbiter.** There is no press-and-hold: a threshold in
  milliseconds cannot separate a tap from a hold, because a tap has no length
  people control, so the same gesture landed on search one time and a city
  switch the next. A touch is a swipe once it travels 24px on one axis —
  clear of the thumb roll every tap on a 52px target has in it — and a tap
  otherwise.
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

Every row **leads with** that city's **current reading for the active view**
(chance in rain, degrees in temp, speed in wind), read off its cached forecast,
in a fixed column at the left edge — the one part of the sheet the thumb
driving the swipe never covers, and a width no reading can push, so every city
name starts at the same place. A city with no cache reads blank, never a zero.

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

Designed but not shipped: the severe-weather rule rewrite, the confidence
falloff and resolution work, and localization.
