# changelog

what changed, newest first. the version is `CACHE_NAME` in sw.js

## v2.4.0 (2026-08-14)

### the status line moved under the controls
- the city name and the three view buttons now sit directly beneath the grid, and the freshness line sits beneath them
- the control row is the only row on this screen that gets pressed, so it takes the position nearest the thumb. the line above it was spending the easiest reach in the app on text that is only ever read
- the colour key and the first-run hint share that line and moved with it. a hand on the grid is above the line either way, which is the reason the line went below the grid in the first place

### the bottom line and the view underline stopped snapping
- the colour key, the first-run hint and the freshness line share one slot, and used to cut between each other in a single frame. they now dissolve, so the line under the thumb no longer flickers on every touch
- the gold underline beneath the active view used to jump the instant a view button was tapped, while the grid it labels took a third of a second to answer. it now slides, and still arrives before the grid does

### the grid responds to a pointer again
- hovering a block dimmed it slightly, and that fade stopped working after the first animated repaint of the session. it now works whatever the grid last did

### the city sheet opens and closes
- the sheet used to appear fully formed at the bottom of the screen in a single frame. it now rises into place over 140ms, and the dim behind it fades in with it
- it leaves the same way, still holding its list. before, the rows were cleared in the same frame the sheet was hidden, so the last thing drawn was an empty black box
- the bottom control row fades as the sheet arrives instead of blinking out
- a sheet reopened while the previous one is still leaving cancels the exit and starts clean

## v2.3.0 (2026-08-13)

### the grid now shows what the sky actually looks like
- the colour of each block used to come out of a table: the weather code picked one of eight fixed colours. it now comes from two things about the light itself — how much of it is getting through the cloud, and whether the sun is actually out
- how bright a block is means how much light there is. how gold it is means the sun is on you. the two no longer interfere, so a bright hazy hour and a bright sunny hour are both bright, and only one of them is gold
- **cloud is not darkness any more.** a cloud lit by a high sun is close to white, and the grid shows it that way. an ordinary overcast day is a light grey, not a dark one. dark blocks are kept for genuinely thick, wet, stormy sky
- the old palette had a flaw worth naming: a 30%-cloud hour rendered *brighter* than a clear one, because the gold hit the ceiling and the paler "mostly clear" colour did not. sunshine could not stand out because it was not the brightest thing on the grid. it is now
- clear, mostly clear and partly cloudy used to snap between three fixed colours at 20% and 50% cloud, so two nearly identical skies could look very different and two very different ones identical. the change is smooth now, and lands where the sky actually changes
- rain colours the block more, and in proportion: a likely soaking goes much bluer than a possible sprinkle, where before every rainy hour got the same small nudge
- storms are no longer painted violet. a storm sky is dark slate and that is what it looks like now — the ⚡ marker is what tells you it is a storm. a cell passing well to one side no longer paints the hour as though it is overhead
- the key at the bottom of the screen follows the new colours automatically

### notes
- nothing extra is downloaded for this. the colours are worked out from the cloud cover and weather code already in the forecast
- the previous colour system is still running, unchanged, in the classic version

## v2.2.0 (2026-08-13)

### the one-handed main screen
- every control now sits in one row at the bottom of the screen: the city name, then the three view buttons
- the settings gear is gone from the top corner. tapping the city name opens a sheet holding the saved cities, the search, and the menu, all within reach of a thumb
- swipe up on the bottom row to switch city. the list opens under the finger, the row it is over is highlighted, and releasing lands that city
- press and hold opens the same list without moving, for when there is no room to swipe
- the list is ordered by recency with the current city at the bottom, nearest the thumb, so switching back and forth between two cities is a single short flick either way
- swipe sideways on the bottom row to change view
- a horizontal drag on the grid itself now moves the days, forward and back. the day row is no longer a drag handle
- the per-day min/max row is gone. those temperatures are in the grid it labelled, and in the tooltip
- the day row carries the date as well as the weekday, since the grid can now be moved to any day
- the hairlines between sections are gone. spacing separates them instead
- the search field and the menu open from the bottom of the screen, above the on-screen keyboard rather than behind it

### the rain, temp and wind buttons now show what it is right now
- each of the three view buttons carries its own reading for the current hour: the chance of rain, the temperature, and the wind speed
- so the screen answers all three at a glance. it only ever showed the temperature before
- the active view's reading is printed largest, so the biggest number on the screen is always the one the grid below is drawing
- each button keeps its name beneath the number. the number changes through the day and the word does not, so a view is still found by looking in the same place
- tapping still only switches the view. the button now previews what tapping it gives
- a reading with nothing behind it shows a dash rather than a guess. the chance of rain in particular is left blank by the forecast when it is not known, and stays blank here instead of reading 0%
- temperature and wind follow the units set in the menu

### the top of the screen is gone
- the band above the grid held a temperature, a feels-like and a condition line. the three view buttons carry those readings now, so it was stating them twice
- nothing above the grid but the dates, and the blocks grew taller for it
- the freshness line moved to a single line beneath the grid, and the forecast in words moved with it: `overcast · Run 18:00 · next ~3:41`
- the forecast reads first and the freshness second, so on a narrow screen the freshness is what gets cut off, never the weather
- the colour key shares that line and appears there while the grid is being touched. it used to sit above the grid, which is where the hand was
- every warning keeps the line to itself: offline, stale data, no data, and a waiting update all read as before

## v2.1.0 (2026-08-13)

### past days
- the day drawer now goes back two days as well as forward. drag the day row to the right, or press shift+left
- so you can check what happened overnight before heading out: how cold it got, whether it rained, and how much
- a past hour shows what fell, not a chance of rain. the percentage is a forecast, and the hour already happened
- overnight rainfall totals now follow the model when it revises them, instead of keeping the first figure fetched

## v2.0.0 (2026-07-29)

- split the app into two versions: primary and classic, with classic keeping the old static screen, and this version getting the UI overhaul
- the two versions continues to share the forecast, colours, theming, caching and city handling


## v45 (2026-07-29)

### swiping tweaks
- swiping through the starred city list no longer loops
- the haptic tick felt on each city swiped past is much lighter
- pulling more hours or more days into view and letting go no longer plays the full grid wipe on the way back. it just slides itself home, the same motion that opened it
- dragging on the hour/day rails is less twitchy: it takes more finger travel to move a notch, and each notch has a short built-in pause before it lets go to the next, matching the linger already in the vertical city swipe
- the more-hours/more-days reveal no longer scrolls itself home while a tooltip is open, it waits for the tooltip to close first
- swiping between rain/temp/wind now takes a bit more of a pull, and pauses on the current screen before it starts sliding to the next one, matching the linger the city swipe already has

### experimental
- dragging the hour/day rails now crossfades the grid's colours continuously under the finger instead of snapping per notch, the same idea as the rain/temp/wind swipe

## v44 (2026-07-29)

### documentation
- added a section in setting for documentation about how the hourly weather data is made
- added more styling to What's New view


## v43 (2026-07-28)

### swiping between views
- swiping sideways between rain, temperature and wind now happens under the finger instead of after it. the grid changes colour column by column as it is dragged, to indicate the motion
- swipe without releasing to quickly peek at another screen, works both ways in one swipe
- a quick flick still works exactly as before. it was never a separate gesture, just a fast drag
- the gold underline under rain / temp / wind slides along with it, so the grid always has something naming it


## v42 (2026-07-28)

### swiping between cities
- swiping up and down the grid now picks a city from the starred list instead of stepping one at a time. keep pulling and it keeps going down the list, so any favourite is one unbroken swipe away
- a small rail appears at the right edge while you drag, showing where you are in the list and how much is left
- the list loops, so nothing is ever more than half a lap away in either direction
- each city has a little landing spot in the swipe, so you can feel and see where it settles rather than balancing on an edge
- the list rolls with your finger, so a city arriving from below is a later one
- a quick flick still swaps one city, however hard you throw it
- changing direction mid-swipe turns around instead of jumping

### bug fixes
- dragging on the times down the left edge no longer changes city as well as showing more hours



### see more hours
- pull down or up on the times running along the left edge of the grid to see hours outside the usual 6am–9pm
- or just scroll with the pointer over those times, which does the same thing
- let go and it slides straight back to the normal day. it's a look, not a setting, so the grid you come back to is always the one you left
- on a keyboard, shift with the up and down arrows does the same thing

### see more days
- drag sideways on the row of day letters above the grid to look further ahead, out to fourteen days
- or scroll with the pointer over those letters, same thing
- the app now keeps two weeks of forecast on hand instead of one, so the far days are already there when you scroll to them. the first time you open it after this update it fetches once more than usual to fill that in
- worth knowing: a fourteen-day forecast is a much weaker claim than a two-day one
- a ⌂ appears on the left to jump back to today, and it comes back on its own after a few seconds, or if you tap away, press escape, or switch view or city
- on a keyboard, shift with the left and right arrows steps through the days

### more favourite cities
- you can now star up to 9 cities instead of 6

### current-hour marker stays live
- the "now" time label, the current-hour highlight on the grid, and the day/night background now stay accurate even if you leave the app open, or step away and come back, without needing a fresh forecast


## v40 (2026-07-27)

### tooltip touch: single tap
- tap a grid block to open its tooltip; tap the same block, the tooltip itself, or anywhere else to close it
- swipe to change view or city without closing an open tooltip, so you can compare it against another city/view in place

## v38 (2026-07-26)

### bug fixes
- increased size of the status info icon padding to 8px to become a better touch target on mobile

## v37 (2026-07-26)

### tooltip redesign
- tooltip now highlights whichever stat matches the view you're on. bigger and brighter text for temp in the temp view, rain in the rain view, wind in the wind view
- wind now gets its own line in the tooltip, wasn't shown as clearly before
- feels-like temperature is now equal weight to actual temp, instead of being smaller and greyed out
- added a divider line under the date so the header and the numbers read separately
- condensed the description text (condition, humidity, sunrise/sunset) into a single line under the numbers, leading with whichever detail matches the active view
- add color to the currently highlighted tooltip data. temp - yellow, rain - blue, wind - green

### visual cleanup
- slimmed the legend step swatch height to 8px to give vertical space back to the grid
- changed hour mark do display current time instead of temp, and reduce visual noise by making in white
- remove whole grid background line for more visual clarity
- added hour label separators to the internal borders of the hours
- add clock ticks to each our mark to still help with readability
- update spacing of the whole grid to be slightly taller

## v36 (2026-07-26)

### temperature view
- temperature view is now colored based on feels-like temperature, which is more relevant to actual day to day usage
- 0 °C frost line (solid) countour at each crossing between adjacent hours, based on actual temp
- bannering a fully-frozen column's top
- dashed possible-frost line at +2 °C
- added a ▲ glyph on feels-like <= -20 (frostbite) or >= 38 (heat-stress), temperature view only
- snapped to eight absolute comfort bands:
  Bitter    Below-8
  Freezing  -8 to 0
  Cold       0 to 8
  Cool       8 to 13
  Comfort   13 to 22
  Warm      22 to 27
  Hot       27 to 32
  Very hot  32+
- 30% within-band shading to still have some differentiation
- legend rebanded to the eight bands

## v35 (2026-07-25)

### tooltip update (bug)
- when tooltip is active over a block, and a different city is loaded, the tooltip refreshes with the new city's data
- always show mm/h of precipitation if there is a % chance of rain. even if mm/hr is 0
- wrap snow fall cm/hto its own line under the rain amount

### block tooltip redesign
- the hover/tap tooltip now leads with the two most-checked facts: temperature (with feels-like) and rain, shown big; rain chance and amount sit together (e.g. "85% · 6.4 mm/h"), with the rain figure in the same blue as the grid's rain lines
- a sleet hour shows both the rain and snow rates
- everything else drops to one quiet line below; sunrise or sunset now shows on every block
- gusts show only when meaningfully stronger than the steady wind
- hazards (thunderstorm/hail, fog, freezing rain, heavy rain, extreme heat, very high UV) now read as amber chips along the bottom, one for each hazard marked on the block

## v34 (2026-07-25)
- update night time colors to more closely resemble daytime
- add a sunset transition colors

## v33 (2026-07-24)

### desktop layout
- the grid now floats in the upper-centre of the viewport on large screens, with the height driven by the viewport size

### day rollover (bug)
- the week now updates itself at midnight: when the clock ticks over to a new day the past day drops off and the next day slides in on its own, instead of the grid getting stuck a day short until you reloaded
- the app now keeps one extra day of forecast in reserve (fetches 8, still shows 7), so that new day appears instantly at the rollover without waiting on the network

### grid transitions
- switching city or view now animates as a pixel wave: blocks blink to black and back to colour in sequence, so the motion is carried by the order the pixels change while. city (swipe up/down or the ↑/↓ arrows) sweeps vertically, view (swipe left/right or the toggle) sweeps horizontally
- first load now fills in from the skeleton grid left-to-right
- a city with cached data shows instantly; when fresh data lands only the blocks whose values actually changed blink
- a refresh that arrives mid-swipe waits for the wave to finish before blinking its changed blocks, so the sweep never gets cut short
- the pixel order carries a bit of randomness, so repeating the same switch never plays back exactly the same way
- all of it honours "reduce motion": the grid updates instantly with no blinking
- shorten reload animation to 0.25s fade-in, no translate

### grid layout
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
