# changelog

what changed, newest first. the version is `CACHE_NAME` in sw.js (v17, v18...), and each one has a git tag so I can diff between them.

## unreleased

### v25 (2026-07-23)

### search autofill fix
- the city search field is now a `search` input, not `text`: chrome on android was reading the word "city" as an address field and popping up autofill for passwords, payment, and addresses over the keyboard. a search field is left out of that guess
- added search-keyboard hints (`inputmode`/`enterkeyhint`), renamed the field to `q` so nothing address-like is inferred
- stripped the native `search` clear button and appearance so the field looks unchanged

### mobile status line
- the freshness/status line no longer overlaps or hides the rain/temp/wind buttons on a narrow phone
- trimmed each state's wording so it fits the phone row in full instead of clipping behind the buttons
- the ⓘ beside the line is now a small, quiet down chevron instead of the bordered "i", so it draws less attention

### edge cases
- switching cities quickly no longer risks saving one city's forecast under another's cache: a fetch that resolves just as you switch away is now discarded
- reopening after a week away no longer flashes an empty grid: a cached forecast whose hours have all elapsed is skipped and the loading skeleton shows instead

### hazard + sky-event markers
- hazard glyphs moved from the middle of a block to its bottom-right corner. quieter, and it leaves room for a second mark
- extreme heat and very-high uv are now two separate icons (♨ and ☀) instead of one shared ⚠
- a block shows every hazard that applies, not just one
- each day's 21:00 block can now carry a moon marker in the bottom-left corner: ○ new, ◐ first quarter, ● full, ◑ last quarter, and ◉ for a lunar eclipse
- moon phases are computed accurately and shown on the right night for the city's own timezone
- lunar eclipses (total and partial) come from a built-in date table and replace the full-moon dot on that night

## v24 (2026-07-23)

### local + global model times
- the freshness line now shows two run times where a regional high-res model covers
- the local model is picked from location: arome (france/w europe), icon-d2 (central europe), harmonie (netherlands), ukmo (british isles), hrrr (us), msm (japan). Otherwise global model (icon). Only a best guess, not a guarantee.

### background refresh
- returning to a backgrounded tab or installed app now re-checks the forecast right away. does no network work if the data is already current

### status tooltip
- the freshness explanation moved off the status label and onto a small ⓘ beside it.
- the ⓘ now works on touch: before, the info was hover-only, so phones never saw it (the label's own tap is taken by refresh)
- rewrote the explanation to spell out the local vs global model split

### android layout fix
- installed on android, reloading via the update button no longer leaves the bottom of the grid tucked under the gesture nav bar: the layout now re-reads the safe-area insets once the system bars settle after a reload

## v23 (2026-07-23)

### per-city cache
- each city now keeps its last forecast on the device, so switching cities paints instantly and updates in the background
- offline, every saved city still shows its last forecast, labeled with how old it is
- old data is never deleted just for being old: a cached forecast leaves only when a fresh one replaces it, when its city is removed from favorites/recents, or when no future hours remain (about a week)
- days fully in the past drop off the grid, so an old forecast shows a shorter week instead of pretending yesterday is today
- the cache can't grow past favorites + recent cities; removing a city removes its stored forecast too

### change highlighting
- when a new model run meaningfully moves the forecast (rain chance ±30 pts, temp ±3°, wind ±15 km/h), the affected blocks pulse briefly, once, in the view the change belongs to
- tap or long-press a changed block to see what moved: "rain 20% → 60%"
- polls that bring nothing new no longer redraw the grid at all (less jank, less battery)

## v22 (2026-07-23)

### status indicator
- the freshness line is now the app's one status channel: shows offline, back-online, a waiting app version, and stale forecast indicator. Tap to refresh.
- staleness escalates on the model's cadence: when the next expected model release is missed, offline turns amber and dates the forecast. Indicates how stale the forecast is.
- copied-link and location messages now clear themselves after 2s

### search
- search bar opens instantly, removed the fade/slide-in animation
- geolocation button is now it's own button inline in the search field
- the first result is preselected on every keystroke, so Enter has an obvious target
- hover and the arrow keys now share one highlight, so the pointer, the keyboard selection, and the Enter target never disagree (and only one row is ever gold)
- more room between the typed text and its gold underline, so it no longer feels cramped
- selecting a place (click or Enter) now reliably collapses search and hands keyboard control back to the main screen
- results panel spans the full grid width and floats without an outline box. Pure black. Yellow underline.
- results highlight (hover / keyboard) tints the text gold instead of shading the whole row
- the whole top strip is a tap target for search, not just the city name
- while searching, the grid dims further and stops taking taps, so a stray touch can't open a tooltip
- escape and tapping outside the search field closes search even while the field is focused

## v21 (2026-07-23)
- ipad layout: grid fills the screen (portrait widens to 820px, landscape centered)
- link-preview card is now the actual forecast grid, not the app icon (1200×630, ~22 KB, crawler-only)
- added link-preview meta: `og:locale` (en_NZ), `og:image:type`, `twitter:image:alt` alt text describes the grid
- first open guesses a nearby city from device timezone (on-device, no IP/permission) instead of Whakatane; "locating…" + skeleton until it resolves, falls back to Whakatane
- faster first paint: preconnect forecast api in `<head>`, geocoding preconnected from js only when needed (first-visit guess / search focus)
- freshness line moved onto the rain/temp/wind row, shows model run time + next expected update
- tap the freshness line to refresh. Error banner gone
- out-of-date forecast turns the line amber → "↻ update forecast" button
- tooltip on that line explains run time vs next update, links open-meteo model docs
- install banner held until the grid paints, then a short delay
- stalled fetch aborts after 10s
- favorites now capped at 6, with a hint shown when adding a 7th.
- recent cities capped at 12


## v20 (2026-07-22)
- favorites: tap the ★ next to a city in search to favorite it; favorites pin to the top of the search list, recent cities below
- typing in search matches your favorites too, and shows them above the live results
- keyboard: ↑/↓ switch favorites, ←/→ switch views
- swipe up/down on the grid to switch favorites
- search: ↑/↓ move through results, enter picks the highlighted city
- search box now overlays the header when open, so a long place name can't squeeze it on small screens
- long city names truncate with an ellipsis instead of pushing the layout
- taller search results list, with a thin gold scrollbar
- removed saved cities from settings, add or remove them from search instead
- keep up to 9 recent cities (was 5)
- removed the number-key (1–5) city jump, it reshuffled the list and jumped back and forth
- share a place: the location is now in the link, so you can send someone a specific place
- pasted links show a branded preview card (grid icon + app name)
- share button: share sheet on phones, copy link on desktop

## v19 (2026-07-22)
- no tap-highlight flash, no double-tap zoom, no long-press selection on the ui
- crossfade when switching rain/temp/wind
- keyboard: ⌘/ctrl+k search, 1–5 for saved cities
- desktop: relaunch focuses the open window
- desktop: app draws into the title bar (window controls overlay)

## v18 (2026-07-22)
- add new logo based on grid view

## v17 (2026-07-17)
- sunset time
- tooltip showing when the forecast last updated

## v14 (2026-07-17)
- wind view

## v12 (2026-07-17)
- first release. weather for Whakatane as an installable pwa. works offline, add to home screen.
