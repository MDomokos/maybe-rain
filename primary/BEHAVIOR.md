# primary — current behaviour

*What this variant does today. Updated when behaviour changes, not when code moves.*

`primary/` is the active variant, published at the site root. It receives all new
design work. For what shipped when, see `CHANGELOG.md`; for how the code is
split, `../shared/README.md`.

---

## The screen

One viewport, no scrolling. Nothing above the grid but dates. Top to bottom:

- **Day row** — the date over its weekday, one column per grid column. Both
  lines hold until a column narrows past the point where a two-digit number can
  be read, and then both fade together: the weekday is one or two letters, so
  it costs no width the date does not already need. The date is the top line so
  that the fade moves nothing, and the row keeps its height either way so the
  grid never shifts under a pull.
- **Grid** — 7 columns × 16 rows at rest. Days across, hours 06:00–21:00 down.
  Every block in the home week is one real hour of one real day. Days pulled in
  from beyond it draw at the granularity the forecast actually has: 3-hour
  blocks at lead 7–8, 6-hour at 9–10, one outlined daily bar from 11. Every
  column is the same width and sits on the same gap, whatever its cadence.
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
| **rain** | the sky as seen overhead: clearness sets brightness, sunshine sets how gold, per-hour night. Rain tints toward navy by amount × chance; storms are dark slate, not violet, and carry the hazard on the glyph | a field of falling marks, plus a mist texture where it is foggy |
| **temp** | apparent temperature in absolute comfort bands | — |
| **wind** | speed ramp | centred direction arrow |

Any view can be turned off in ⚙; the switcher only cycles the enabled ones.

### What the rain overlay says

Four facts, four independent properties of one lattice of marks. Nothing is
overlaid on anything, so the three phases cannot disagree about where a mark
belongs.

| fact | how it is drawn |
|---|---|
| **how much** | the mark's length and weight. Under 0.3 mm, grain — short ticks of varying length. From 0.3 to 1 mm, broken — each site a dot, a tick or a dash. Above 1 mm, a plain run that grows, from 12.5 px to 26, then thickens alone from 8 mm up to the 20 mm warning the glyph fires at. The jump between the drizzle band and rain is deliberate: it is the jacket question answered as a change of size. On a block too short for a full-length mark the run scales to fit, so the top of the scale still tells its steps apart instead of clipping flat |
| **how likely** | how far across the block the marks reach, anchored left. Below 8% the fill is narrow but present: a forecast amount is a fact, and an empty block would say nothing is falling when what the data says is that the runs disagree |
| **which way** | the lean, in five steps — straight down, and 13° or 26° either side. Hours in the same airflow share an angle, so a windy afternoon leans as one block of grid |
| **what kind** | which mark a site carries. A blue streak is rain, a white dot is a flake, a short white stub is hail. A flake grows a tail only while the hour is mixed, so a sleet hour reads as a mix and a pure snow hour is pure dots. Frozen marks are always white, so a snow sky is capped in brightness the way a storm sky is — otherwise a sunlit shower puts white on a near-golden base |

Two readings sit outside that. A near-dry hour keeps a **ghost** past the edge
its chance commits to: the same marks at reduced strength, meaning "possibly a
bit more than this". How far it reaches follows the amount rather than a band —
about twice the chance while the amount is still noise, fading to no over-reach
at all by 0.45 mm — so the width of a block answers how likely rain is and
nothing else, at every amount. An hour with a real chance but **nothing
forecast** is drawn entirely in that ghost — no committed mark at all — which is
a thing you can see rather than something only the tooltip knows. A **foggy** block also draws short **horizontal** runs, which is
the one direction nothing else uses, so a murky drizzle hour draws both and
neither reads as the other. Foggy means under 1 km visibility, or under 2 km
with a sky code that says fog — the same two codes the `≡` glyph is keyed to,
so the texture and the glyph cannot disagree on a block. Where the texture
shows, the tooltip prints the visibility behind it.

The blue is chosen against the sky the mark sits on: pale on dark skies, deep on
bright ones. The changeover is a polarity flip — a light mark becomes a dark one —
so there is one sky brightness where both are near their weakest, and it is placed
where the two are strongest together rather than in the middle of the range.
Blending the two across it is worse than the seam, because a blend runs through a
mid blue and a mid blue on a mid grey has no contrast at all. On the narrow band of
sky either side of the changeover, and nowhere else, the marks are painted a little
more strongly. Both are legibility corrections: the colour and the opacity of a mark
carry no data, only its size, extent, angle and figure do.

Every mark begins and finishes where it means to: marks are clipped to the block
and to the chance edge and finished with round caps, so nothing is severed by an
edge. All the marks of one phase in a block are one path, named for its phase, so
the overlay is the same handful of elements the old pattern was.

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
  - **The rain stretches with the column rather than being cut off by it**, so
    a chance of rain means the same thing at every width — which matters most
    here, since comparing days out is what the pull is for. While a pull is
    moving, the lean lies down a little and a flake goes oval; the weight of
    the marks never changes, because that is how hard it is raining. The grid
    re-draws exact geometry whenever a block settles at a different size, so
    what stretches is a gesture in flight and nothing that stays.
  - **At the end the columns freeze** and the whole grid slides toward the pull
    instead, its trailing edge clipping into black. A little way into that
    slide a hairline beside the grid grows and brightens, then goes solid with
    one haptic tick: **release there and the stretch locks open.** One pixel
    wide throughout — it answers the threshold by lighting up, never by
    thickening.
  - **A flick locks instead of springing back.** A release inside 260ms that
    travelled at least 24px carries its own speed into the animation and locks
    the stretch open on the side it was thrown toward, landing on the same day
    count a held drag reaches by pulling to the edge and staying there. A
    flick toward an end with nothing behind it has nowhere to lock, so it
    eases home like any other short peek.
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
- **Switch view** — swipe sideways, one step per swipe. Nothing moves under the
  finger: the travel is read at the release, and past 45px the grid plays one
  whole sweep, the same one a tap on the view buttons plays. A view is one of
  three rather than a position between two, so there is nothing for a
  half-played sweep to mean.
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
anywhere else closes it. There is no pinned tier.

On a coarse pointer only, a second way in: holding a block still for 350ms arms
a scrub, with a haptic tick. It opens the docked card already in its expanded
state, and from there the finger can drag across other blocks to re-target the
reading live, with a lighter tick each time it crosses onto a new one. The grid
dims as the finger nears the card, so the reading holds the eye rather than the
block still under it; the card itself stays fully opaque throughout, unlike the
thinning its own veil does for a day-elastic pull. Lifting the finger closes it
outright, whatever block it lands on: a hold-scrub reading never persists, so
none of the rules below about surviving a repaint apply to it. This is a deliberate,
owner-directed exception to distance-only navigation elsewhere in the app (see
DR-49), and the third time this project has built a long press for the tooltip;
the first two (DR-18/24, then DR-25/28) were reverted for feeling fiddly in
daily use, on the old floating tooltip rather than the docked card.

The block being read is marked with a hairline ring drawn inside it, so the
block's own colour — which is the encoding — is never altered to say it is
selected. On a mouse, hovering a block opens its tooltip and the ring replaces
the usual hover dim for as long as the reading is up. Touch has no hover state
at all: the ring is the only thing that says which block is being read.

A tapped block also plays its own weather once — rain falling in, mist
drifting, a storm striking, a glint across a clear sky — the same arrival the
current hour plays when the grid settles. Off under `prefers-reduced-motion`.

On a coarse pointer the reading is not a floating box at all. It is a full-width
card resting under the date strip, risen into the weekday line, in two states. It
never takes a touch: every tap reads through it to the block underneath, so it
costs the grid nothing and overlaps rather than displacing. Its own gestures are
claimed by **where they started** — a swipe up or sideways from inside the card
closes the reading, and the card leaves the way it was pushed. The price is that those
two rows give up the day elastic for a sideways swipe, and that the card's left
edge over the hour gutter belongs to the hour peek. Collapsed, the card carries
the day, the hour range, what the active view makes of the block, any warning,
and the three numbers in three columns. A tap expands it, and expanding **adds**
facts rather than repeating any: a figure dressed for the hour with what to wear
and whether rain means an umbrella or a jacket, then gusts, humidity, cloud,
visibility and the sun times. Nothing arrives: the figure opens with its
clothes already on, its umbrella already up and its weather already running.
What moves is the weather beside it, for as long as the reading is open — a
gusty hour loads its wind mark in and streams the scarf away from it, rain or
snow keeps falling, the sun's rays turn around a circle that stays put. Off
under `prefers-reduced-motion`, same as every other animation in the app.
Scrubbing from one hour to the next morphs the figure into the next figure
rather than cutting to it: the hem descends, the sleeve grows down the arm,
the colour crosses and the umbrella opens, because the drawing is a
continuous function of the band rather than eight separate drawings. The
warning belongs to both states, because it is the reason to look. The card moves only when the block it reads is entirely
behind the **collapsed** card, so expanding it never relocates it; it thins as
a gesture comes near it so the grid can be read through.
While it is open the grid gives up vertical page scrolling; the day row, the
legend and the header still pan the page.

An open tooltip survives a city switch, a view switch, an hour peek, a day pull
and a change of cadence, so it doubles as the comparison tool. What it holds on
to is the **hour** it was opened on, not the block. A block is a slice of the
hour window, and the window moves: past the hourly horizon the blocks stand for
three, six or twenty-four hours, cut from the top of whatever window is showing,
so one notch of hour peek redraws every one of them a little earlier or later.
The reading follows its hour into whichever block covers it, at whatever size
that block is now drawn — widening to a three-hour block, and saying so, rather
than closing. It closes only when the hour is no longer on screen at all. The
docked card does not close there: it dims, says **off screen** beside the day,
and keeps its hour until the elastic brings the day back.

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

### The day reading

Tapping the date label reads the whole day instead of one block. It uses the same
two surfaces as the block reading — the docked card on a coarse pointer, the
floating tooltip on a fine one — and every dismissal path is shared, so only one
reading of either kind is ever open. Hover, focus and the keyboard reach it the
same way they reach a block. The tapped date takes a gold underline for as long
as it is being read.

**All 24 hours of the date**, not the hours the grid is showing: the label is a
date, so the date is what it answers for, and a summary that moved with the hour
window would be a summary of the window. Every figure is reduced from that day's
own hours — Open-Meteo's daily block is not read at all, so the reading and the
grid cannot drift. A day the payload only part covers reduces over the hours on
hand, is never padded, and says how short it is.

Three sections. The date and what kind of day it is, with any hazard as a chip;
the three numbers, one per view, with no hero among them because a whole-day
summary is not taken in one view's terms; then the gear line over the ambient
tail. Temperature is the day's spread, rain is the total with the peak chance and
a count of wet hours, wind is the day's fastest with its worst gust and the
octant most of it blew from. The condition is the day's worst hour's own words,
with the hour it starts when it does not start at the first hour on hand.

The figure is two figures: the warm end of the day and the cold end, side by
side, with the hour each falls on under it. They collapse to one when both ends
land in the same band. Rain and wind gear rides the cold figure, sun rides the
warm one. The `TEMP_BANDS` cue the block reading prints beside its figure is not
printed here — the drawing is that sentence, and only the gear half is written
out. The hour-by-hour shape is not drawn at all: the grid behind the reading
already is that drawing.

A past day drops the chance and keeps the gear: rain that fell still wanted an
umbrella, a probability that never resolved advises nothing. The day reading has
no expanded state, because this layout holds every fact the hour card has to
expand to reach; a tap on it closes it.

The gear line here names the thing and the hour it starts mattering, and stops
there. `dressFor`'s own sentences say what to take **instead of** what — "rain
jacket rather than an umbrella" — which the figure has already answered by
putting a hood up rather than an umbrella, so writing the contrast out would be
the drawing said twice.

Snow takes the gear branch before rain does, on both readings. An umbrella is
the one answer that is wrong in snow: it does not run off, it sits, and a canopy
held over a head collects it. So a snowing hour advises a hood whatever the wind
is doing, and the figure draws falling snow — three pale flakes where the rain
strokes would be — instead of rain.

### The day note

Once a day, on the first paint of real data, the app taps today's date for you:
the day reading drops in from under the date strip, rests four seconds, and goes
back up the way it came. Coarse pointers only, since the card it borrows only
exists there, and off entirely behind **⚙ Day note**.

It is not a new surface and not a new state — it opens through the same
`showTooltip` the date label goes through. So everything that already dismisses a
reading dismisses this one: a tap on a block opens that block instead, a tap on
empty space closes it, a city or view switch re-renders it. That is the whole of
"any touch sends it away early", and it needed no code of its own.

The card keeps `pointer-events: none` throughout. The note is never a hit target,
so a tap aimed at the grid during those four seconds still lands on the grid.

The timer checks before it closes anything: if a tap in the meantime opened an
hour, or a different date, that reading is the user's and does not time out. The
date is recorded when the note **shows**, not when it is considered, so a run
that gives up on a hidden tab or a payload with no today has not spent the day's
one showing. Under `prefers-reduced-motion` it fades rather than travelling.

### What the two readings share

They are the same three sections said about different spans of time, so the parts
that are the same shape are written once: which day it is (`readingTitle`), the
hazard chips, the three view-ordered number columns (`readingCells`), the quiet
tail of dim facts, and the one path that opens the docked card. What differs is
which values there are, not how a value is drawn.

Two parameters carry the whole difference. `readingCells` takes a **hero** — the
view whose value is bright, with the other two dimmed — and the day reading
passes none, because a whole-day summary is not taken in any view's terms. And
the card's open path takes an **isDay** flag, which only decides whether there is
an expanded state to toggle.

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
Day note, ♨ heat threshold, ☀ UV threshold, Share, What's new, Hourly data.

Day note renders on coarse pointers only. A row for a setting that cannot do
anything on this device is a row that has to be explained.

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
- A day behind today recedes by stepping its blocks' own colour down, not by
  dimming them as a layer. The two look the same on the block and are not the
  same for anything drawn on it: dimming takes the marks and their background
  toward black together, which flattens the difference between them, and the
  rain in a past block was losing up to a quarter of its contrast against the
  very sky it sits on. The day labels have always receded this way.

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
