# changelog

what changed, newest first. the version is `CACHE_NAME` in sw.js

this is the classic variant. its versions start `1.0.` and count on their own; primary starts `2.0.`. everything below v1.2.0 is the flat numbering the app used before it split into two variants.

classic's layout and navigation are frozen as they were at v40, so most releases here are shared-core fixes that land in primary too.

## v1.2.3b (2026-09-18) — fix

- fixed the app failing to start on a device that had used it before. 1.2.3 re-keyed the cached model metadata and the startup code still read the old shape, so it threw before the grid was drawn
- the settings menu shows the running build at the foot of the list, as the service worker's cache name

## v1.2.3 (2026-09-17) — refresh

- switching to a city fetched a minute ago no longer refetches it
- the run time and next-update countdown now read the model that actually serves the city on screen. a place in the americas was told icon's cycle while its forecast came from gfs
- the app stops asking for a forecast at times the model provably has nothing new. it looks from half an hour before the next release until it lands, and once an hour regardless, instead of every thirty minutes around the clock
- a run the api announces before all its servers are serving it gets one more look ten minutes on, then no more
- the thirty-minute timer is gone. the app sets one alarm for the moment its model is next due, moves it every time a forecast lands, and stops it while the page is hidden
- fixed the stored app shell staying on the previous release
- the shell is fetched past the browser's own http cache, on install too, so network-first means the network

### debug switches

- `?dev` loads network-only and stores nothing, for testing a deploy without bumping the cache version
- `?nosw` unregisters the worker and drops its caches
- the switches survive the address-bar rewrite, so a reload keeps them. they are never part of a shared link

## v1.2.2 (2026-09-15) — bugfix

- unified scroll bar styling across the app
- pressing enter in city search no longer opens whichever city sat at the top of the list. it dismisses the keyboard and loads the results for what was typed
- on desktop, enter commits only a highlighted row belonging to the text in the field, not the list as it stood before the current keystroke
- the first result is no longer preselected on touch, where there is no enter key to explain the highlight
- city search pulses the results already on screen while the next ones load, so refining a query no longer collapses and re-expands the list. a first lookup, with nothing to pulse yet, gets a "Searching…" row
- the search list says why it is empty instead of showing a blank panel: no match names the query, one character asks for more, and a failed lookup says so rather than reading as "no such place"

## v1.2.1 (2026-08-13)

- primary gained a two-day look back, so the shared forecast now carries past days. classic keeps showing today first and does not display them

## v1.2.0 (2026-07-29)

- split the app into two versions: primary and classic. classic keeps the layout and navigation as they were at v40, and continues to share the forecast, colours, theming, caching and city handling with primary

## before the split

the app was one version until 2026-07-29. the releases below use the flat numbering from then, and are the shared history of both variants. classic froze its layout and navigation at v40, so the last releases before the split, v42 to v45, went to primary alone and are not listed here.

## v40 (2026-07-27)

- tapping a grid block opens its tooltip; tapping again or elsewhere closes it
- switching view or city no longer closes an open tooltip

## v38 (2026-07-26)

- increased the status info icon's touch target to 8px padding

## v37 (2026-07-26)

- the tooltip highlights whichever stat matches the active view (temp, rain or wind) in bigger, colored text
- wind now gets its own line, and feels-like temperature is shown at equal weight to actual temperature
- condensed the description text into one line under the numbers
- the hour marker shows the current time instead of temperature, in white
- removed the grid background line and added hour label separators and clock ticks for readability
- increased overall grid spacing slightly

## v36 (2026-07-26)

- temperature view now colors by feels-like temperature instead of actual temperature
- added a frost-line contour at 0°C and a warning glyph for extreme cold (≤-20°) or heat (≥38°) hours
- recolored into eight comfort bands, from Bitter to Very hot, each shaded to show variation within the band

## v35 (2026-07-25)

- fixed the tooltip not refreshing when a different city's data loaded underneath it while it was open
- rain amount (mm/h) now always shows alongside a rain chance, even at zero
- snowfall gets its own line under the rain amount
- the tooltip leads with temperature and rain, both large; everything else condenses to one quiet line, including sunrise/sunset on every block
- a sleet hour shows both rain and snow rates
- hazards (storm, hail, fog, freezing rain, heavy rain, extreme heat, high UV) show as amber chips along the bottom

## v34 (2026-07-25)

- adjusted nighttime colors to more closely resemble daytime
- added sunset transition colors

## v33 (2026-07-24)

- on large screens, the grid now floats in the upper-center of the viewport instead of stretching full height
- fixed the week not rolling over automatically at midnight; the app now keeps one extra day cached so the rollover doesn't need a network fetch
- switching city or view now animates as a pixel wave (vertical for city, horizontal for view), and honors "reduce motion" with an instant update instead
- the current-hour indicator is a gold bar in the gutter instead of a ring on the block
- evened out grid spacing (6px on desktop, 4px on mobile)

## v32 (2026-07-24)

- the grid colors each block by what the sky actually looks like (clear = gold, cloudy = grey, fog = pale grey, storm = violet, snow = near-white) instead of fading only by rain chance
- rainy hours lean slightly blue, and blocks switch to a night palette after sunset
- rain is drawn as blue diagonal lines over the sky color: fill amount shows chance of rain, line density shows intensity, from a faint trace under 0.3mm/hr to solid lines over 2mm/hr
- the lines lean with wind direction and stay readable against both bright and dark skies
- snow draws as white dots and hail as small rings; mixed-precipitation hours show more than one
- this was a hidden experimental option before and is now the default rain display

## v31 (2026-07-23)

- the "update app" button now only appears when a new version has actually landed, and the app re-checks for updates when the tab regains focus
- removed pinch-to-zoom and the +/- keys that narrowed the week view; the grid always shows the full week now
- fixed a small visual gap between the search field and its suggestions list

## v30 (2026-07-23)

- the city name lines up with the grid columns, and the current temperature shows on the same line
- search now looks the same across phone, tablet and desktop, with the city name bold and the region dimmed
- unified all gold accent lines to a single 1px weight across the app

## v29 (2026-07-23)

- replaced text-symbol markers throughout the app with custom-drawn SVG icons for a consistent look
- the wind view uses a single arrow that rotates to the wind direction instead of eight separate characters

## v28 (2026-07-23)

- unified the visual style of settings, search, What's New and the install banner: flush black backgrounds with thin hairline dividers
- moved the entire color palette into one shared set of tokens so every surface stays in sync

## v27 (2026-07-23)

- added a "What's New" entry in settings that shows the changelog in-app, read from `CHANGELOG.md`
- a waiting update shows an "Update app" prompt in the status line

## v26 (2026-07-23)

- added a build step that minifies the site into a `dist/` folder, deployed automatically via CI on every push to main (site size cut from 285kb to 177kb)
- the search field is now a proper "search" input type instead of "text", which stops Chrome on Android from popping up password/address autofill over it
- the freshness status line no longer overlaps the view buttons on narrow phones
- fixed a race condition where switching cities quickly could save one city's forecast under another's cache
- hazard icons (extreme heat, high UV, etc.) moved to the bottom-right corner and all show at once instead of just one
- a moon-phase icon can now appear on each day's 9pm block, including lunar eclipses

## v24 (2026-07-23)

- the freshness line shows both the local high-resolution model's run time and the global model's, where a regional model covers the area
- returning to the app after it's been backgrounded re-checks the forecast immediately
- the freshness explanation now works on tap as well as hover
- fixed the grid overlapping Android's gesture navigation bar after reloading via the update button

## v23 (2026-07-23)

- each city keeps its last forecast cached on the device, so switching cities is instant and updates happen in the background
- offline, every saved city still shows its last forecast, labeled with its age
- a meaningfully changed forecast (rain ±30 points, temp ±3°, wind ±15km/h) pulses the affected blocks once; tapping a pulsed block shows what changed

## v22 (2026-07-23)

- the freshness line is now the single status channel for offline, back-online, waiting-update and stale-forecast states, and doubles as a tap-to-refresh button
- search opens instantly with no fade-in, and geolocation is a button built into the search field
- the first search result is preselected on every keystroke, and escape or tapping outside closes search

## v21 (2026-07-23)

- on iPad, the grid now fills the screen properly in both orientations
- the link-preview card shown when sharing the app is now the actual forecast grid instead of the app icon
- on first open, the app guesses a nearby city from the device's timezone instead of defaulting to Whakatane
- a stalled network fetch now times out after 10 seconds
- favorites are capped at 6, with a hint shown when trying to add a 7th

## v20 (2026-07-22)

- added favorites: starring a city in search pins it to the top of the list, with recent cities below
- search matches favorites as well as live results
- sharing now includes the specific city in the link, and shows a branded preview card when pasted elsewhere

## v19 (2026-07-22)

- removed the tap-highlight flash, double-tap zoom and long-press text selection from the UI
- switching between rain, temp and wind now crossfades
- ⌘/Ctrl+K opens search

## v18 (2026-07-22)

- added a new logo based on the grid view

## v17 (2026-07-17)

- added sunset time and a tooltip showing when the forecast was last updated

## v14 (2026-07-17)

- added a wind view

## v12 (2026-07-17)

- first release: weather for Whakatane as an installable PWA that works offline
