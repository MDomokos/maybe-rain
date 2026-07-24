# changelog

what changed, newest first. the version is `CACHE_NAME` in sw.js (v17, v18...)

## unreleased

- update current hour indicator to use a gold accent bar in the gutter, rather than a gold ring on the block itself
- even out gridline and block gaps. whitespace in each band is split block-gap/2 above and block-gap/2 below
- even out grid gaps. 6px all around on desktop, 4px all around on mobile

## v32 (2026-07-24)

### new grid colours: the sky, hour by hour
- the main grid now colours each block by what the sky looks like that hour, instead of fading by rain chance. clear = gold, thin cloud → light grey, overcast → medium grey, fog = flat pale grey, storm = violet, snow = near-white
- the colour comes straight from the weather code Open-Meteo returns (all 28 mapped to a sky)
- a rainy hour leans slightly blue, so you can still tell a wet grey from a dry grey without opening the tooltip
- cloud cover now nudges every block: clearer hours lift a little brighter, cloudier hours ease a little darker, so two similar hours no longer look identical
- after sunset blocks switch to a night palette (a clear night reads deep blue), and the background eases to near-black-blue once your local time is past sunset

### rain now drawn as lines over the sky
- rain is drawn as blue diagonal lines over the sky-coloured block: how far they fill the block = the chance of rain, how dense and heavy = how hard it's coming down. under 0.3 mm/hr a faint trace (a possible sprinkle), 0.3-1 dotted (a drizzle), 1-2 dashed (bring an umbrella), 2+ solid (you'll get soaked)
- the lines are blue and stay readable on every sky: a deep blue on bright blocks, a pale blue on dark ones
- rain lines lean with the wind (heavier wind = more lean)
- snow draws as white falling dots (denser = heavier; any snowfall at all shows). an hour with both rain and snow shows both: lines and dots
- hail shows as small rings over the storm colour. fog and freezing rain keep their corner icons, and a warning mark appears above 20 mm/hr
- a likely-but-light sprinkle (high chance of rain, near-zero forecast amount) now shows those faint trace ticks instead of a bare block. the amount and the chance come from different models, so a high chance with ~0 mm means "probably a light drizzle," not "no rain"
- this used to be a hidden `?lines=1` experiment and is now the default rain view

## v31 (2026-07-23)

### app updates
- the "update app" button no longer shows when the app is already up to date. it now appears only when a new version actually landed while the app was open and a reload is needed
- the app re-checks for a new version when you switch back to it, so that update button shows up when there genuinely is one (not only after a full reopen)
- the update / new-version buttons in the status line now match the buttons in the settings panel 

### code cleanup
- the legend's three views (rain conditions, temperature scale, wind scale) now render through one shared code path instead of three separate blocks. each view describes its swatches as a simple list and one renderer draws them. no visible change
- the two city-time helpers (current time, and time-of-any-instant) share one date formatter, built once and reused until the city changes, instead of each rebuilding its own. no visible change
- the grid's day letters and the status line's weekday stamp now compute the day-of-week through one shared helper instead of repeating the same date math. no visible change

### removed
- removed the grid's semantic zoom: pinch, trackpad pinch, and the +/− keys that narrowed the week to 5 or 3 days. the grid always shows the full week now. the one-finger swipe gestures (switch view / switch city) and the arrow keys are unchanged

### search
- closed a small gap between the search field and the suggestions list where the grid showed through the seam (most noticeable on android)

## V30 (2026-07-23)

### header layout
- the city name now lines up with the grid columns instead of floating at the left edge
- the current temperature shows on the same line, giving you the "right now" answer at a glance without reading the grid
- the temperature hides while searching, and when there's no reading for the current hour (e.g. late at night outside the shown hours)
- a hairline now caps the top of the grid, so the header no longer feels detached from it

### search
- one unified search look on phone, tablet, and desktop: a single compact field size and row density everywhere, instead of scaling up on tablet and matching the large city-name heading
- removed the search field's gold underline
- the city name is bold and the region (state/country) is dimmed, so the place reads at a glance
- the ★ favourite and ✕ remove buttons line up under the locate and gear icons in the header above them
- the selected result is marked by a gold underline beneath it
- unified every gold line to one weight (1px)

### grid lines
- the separator under the header, the hour gridlines, and the line above the legend key are unified, driven by a single style token

## v29 (2026-07-23)

### custom icons
- the small markers on the grid and the interface controls are now custom-drawn SVG icons instead of text symbols, for a consistent look
- weather hazards, moon-phase, and eclipse marks are drawn icons; the grid's corner icons are also larger and use a thinner line, so they read more clearly at a glance
- wind view uses one arrow that rotates to the wind direction, in place of eight separate arrow characters
- also updated: gear, locate, favourite, remove, refresh, the change-city caret, and the "now" marker on the time axis
- the settings menu's heat and uv rows use the same icons as the grid

## v28 (2026-07-23)

### unified styling
- the settings menu, the search results, the "What's new" panel, and the install banner now share one look: flush on black with thin hairline dividers, no raised grey boxes
- settings toggles show the active choice as gold text with a gold underline instead of a white block
- opening the settings menu dims the grid behind it, the same as opening search
- the whole interface palette moved into one set of colour tokens (the gold accent, the greys, the amber alerts, the panel and row lines, and black itself), so every surface stays in sync and a future colour theme can be one block of values instead of edits scattered through the styles
- the install prompt draws the eye in gold: its Install button is a solid gold fill like the locate button, and on iOS the "Share → Add to Home Screen" hint is gilded to match
- the "What's new" panel's scrollbar now matches the search results, shared from one set of rules

## v27 (2026-07-23)

### what's new panel
- a "What's new" row in the settings menu opens the changelog, rendered in-app. it reads the shipped `CHANGELOG.md`
- a waiting update shows "↻ Update app" in the status line (tap to reload). Once the new build is running, a brief "New version · see ⚙" note appears there once. Tap it for the changelog, or find "what's new" in the settings menu.
- the changelog is fetched fresh when online and falls back to the offline cache

## v26 (2026-07-23)

### minified deploy
- introduce a build step that minifies the site into `dist/` and a `deploy` workflow publishes that to the `gh-pages` branch
- `npm run build` strips comments + whitespace from index.html and minifies its inline css/js, runs terser on sw.js, compacts manifest.json, runs svgo on the svgs. other files copied as-is
- index.html 172kb → 66kb; whole site 285kb → 177kb, ~24kb gzipped over the wire
- runs in ci on every push to main
- ci runs on node 22; checkout@v5 + setup-node@v6 (node 24 runtime), off the deprecated node 20

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
