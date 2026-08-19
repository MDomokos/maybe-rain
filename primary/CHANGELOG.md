# changelog

what changed, newest first. the version is `CACHE_NAME` in sw.js

## v2.6.6 (2026-08-19)

- on phones and tablets, holding a block for a moment now opens its reading already expanded, with a light buzz. dragging while still holding scrubs it live across other blocks, with a lighter buzz on each one crossed; the grid dims as the drag nears the reading. releasing closes it

## v2.6.5 (2026-08-19) — bugfix

- fixed tapping the reading card on a phone switching to the block behind it instead of expanding the card

- flicking the day grid now locks the extra days open instead of springing back to today, timed by the flick's own speed. removed the status-line hint that used to explain why a fast swipe didn't work
- the search list's unpin star is now filled instead of struck through, so a pinned city reads as "on" instead of "removed"
- fixed a pinned city's star sometimes showing grey instead of gold after a tap, from a hover style that stuck on touch
- the gold highlight on the first search result no longer shows on phones and tablets, where it had nothing to explain itself (it marks the Enter-key target, and touch has no Enter key)
- fixed the mist texture drawing over heavy rain and storms. below 1km visibility it used to skip the fog-code check; it now requires one at every visibility, same as the 1-2km band already did

## v2.6.4 (2026-08-19)

- on phones and tablets, tapping a block now opens a full-width card under the dates instead of a box floating over the grid. the card never blocks a tap, so every block behind it is still reachable
- tap the card to expand it: a small figure shows what to wear at that hour, whether to take an umbrella or a rain jacket, and the gusts, humidity, cloud, visibility and sun times
- swipe the card up or sideways to dismiss it, or tap the block again. it leaves in the direction it was swiped
- tapping a block plays its weather once — rain falling in, mist drifting, a storm striking — the same animation the current hour plays when the grid loads
- the card moves out of the way only when it would hide the block being read, and thins while a finger is near it so the grid can be read through
- a reading whose day is dragged off screen now says so instead of disappearing
- while a reading is open the grid no longer scrolls the page; the dates, the key and the header still do

## v2.6.3 (2026-08-19) — bugfix

- rain and snow marks now stay visible against every sky color and brightness level, including fog, near-white snow skies, and dimmed past days
- rain now scales smoothly across every threshold — chance, amount, and the heavy-rain warning — instead of snapping between fixed steps
- fixed rain not redrawing correctly while dragging to view more days, resizing the window, or switching city or view mid-drag
- rain marks now scale to fit small blocks, so the heaviest rain no longer looks the same as moderate rain on a short phone screen
- a slow connection now falls back to the cached forecast after a few seconds instead of showing a blank screen
- closing the city switcher no longer flashes the search bar

## v2.6.2 (2026-08-18) — bugfix

- rain marks are lighter and thinner, so a week of drizzle no longer reads as a busy screen

## v2.6.1 (2026-08-17)

- the current hour now plays a short animation (rain falling, snow drifting, lightning) when the grid loads, then settles

## v2.6.0 (2026-08-17)

- rain is now drawn as falling marks instead of a hatch pattern cut off at the block edge
- light drizzle hours get more visible ink instead of the least of any rain level
- an hour with a chance of rain but no forecast amount shows a faint field instead of a blank block
- rain now leans with wind direction in five fixed steps instead of a separate angle per hour
- snow, sleet and hail render on the same grid as rain, so mixed-precipitation hours show all of them
- snowflakes are drawn as full circles instead of being clipped in half
- hours below 2km visibility now show a mist texture

## v2.5.5 (2026-08-17)

- the day row marks where the week rolls over and where past days end, with a short line under the date instead of a rule across the grid
- past days are dimmed less, so their conditions stay as easy to read as upcoming days

## v2.5.4 (2026-08-16) — bugfix

- fixed the day-pull gesture jumping a day sideways when dragged past its start point and back
- a quick flick that doesn't fully open more days now explains why in the status line, for the first three times, then stops
- the freshness line at the bottom now spans the full screen width instead of being inset
- the swipe-end marker is a thin hairline instead of a bar that thickens
- in the city switcher, each city's reading now leads the row instead of trailing it, so it isn't hidden under the thumb
- fixed the switcher opening in the wrong position because it measured itself before the sheet finished rising
- switching between search and settings no longer flashes the main screen

## v2.5.3 (2026-08-16) — bugfix

- the city switcher shows pinned vs. unpinned state more clearly
- fixed several layout and spacing issues, including lining up the held city name with its row

## v2.5.1 (2026-08-15) — bugfix

- tapping the city name now reliably opens search; it used to sometimes open the switcher or change city depending on tap timing
- press-and-hold no longer opens the switcher — swiping up is now the only way in, and needs more travel than an accidental thumb wobble
- a sideways swipe ending over rain, temp or wind no longer also registers as a tap on it
- removed the grey drag-handle pill from the switcher and search panel, since neither sheet is draggable
- pin and unpin are now a star and a crossed-out star, larger and brighter, instead of a faint plus and cross
- a pinned city's star is gold, and the "pinned", "recent", "back" and "now" labels stay visible while swiping
- the switcher is capped at eight rows so the current and previous city are never pushed off screen
- pinned cities are capped at five; an over-full list trims from the top instead of the bottom
- the day label leads with the date and fades the weekday out as the column narrows, instead of jumping partway through
- the grid eases back into place on release instead of overshooting and bouncing
- closing past days is as smooth as closing future ones, and a new pull started mid-close continues from where the days are
- days held open now survive a city or view switch

## v2.5.0 (2026-08-15)

- dragging the grid sideways pulls in extra days smoothly instead of paging one at a time; today stays visible throughout
- letting go without pulling far enough springs back; pulling past the last day and releasing on the marker holds the extra days open
- removed the old auto-close-after-4-seconds behavior and the gold direction arrows
- on a keyboard, shift+arrow moves a day at a time, and shift+end holds the days open
- days a week or more out now draw in 3-hour blocks, then 6-hour, then a single daily bar, instead of pretending to be hourly
- tapping one of those blocks shows which hours it covers and that the data isn't hourly
- searching a city adds it to the switcher, unstarred, below a divider, and it drops off after three days if untouched
- pinned cities stay in their own block in a fixed order instead of re-sorting on every switch
- the previous city always sits directly above the one being viewed, and the current city is always the bottom row
- pinned cities are capped at five instead of nine, since the list now also holds recents
- every row in the switcher shows that city's current reading (rain, temp or wind), so cities can be compared at a glance
- a city that hasn't been fetched yet shows nothing instead of a fake zero
- with a tooltip open, holding a city name compares both cities for that hour side by side
- fixed tapping the city name sometimes switching cities instead of opening search, caused by slow or wobbly taps misread as a swipe
- the switcher only changes city when a row is actually released on
- dismissing the switcher while previewing another city correctly restores the current city's weather
- on desktop, moving the mouse down the switcher now previews each city, matching the touch drag

## v2.4.0 (2026-08-14)

- the city name, view buttons and freshness line moved to sit directly under the grid, closer to the thumb
- touching the grid shows small arrows and carets marking which directions can be pulled for more days or hours; they disappear on release
- the onboarding hint now cycles through all three gestures instead of naming one, and each disappears once used
- swiping between rain, temp and wind now animates live under the finger instead of jumping after release
- a swipe that doesn't travel far enough rewinds instead of committing
- returning to today after a drag now animates smoothly instead of jumping day by day
- the grid redraws once at the end of that animation instead of every frame, which keeps it smooth on slower phones
- all grid animations now run on one shared timer instead of separate clocks, fixing stutter on high refresh-rate phones
- hour blocks are announced to screen readers as pressable buttons; loading, offline, stale and update-available states are spoken aloud
- the freshness countdown itself is deliberately not read out, since it changes every minute
- the tooltip now waits for the pointer to settle on a block before opening, instead of flashing across every block passed over
- moving to a neighboring block slides the tooltip there instead of jumping
- the system "reduce motion" setting now disables all app animations, not just the grid
- removed leftover animation CSS that was no longer used
- the color key, hint and freshness line crossfade between each other instead of cutting abruptly
- the gold underline under the active view slides into place instead of jumping
- fixed hover-dim on grid blocks, which stopped working after the first animated repaint of a session
- the city sheet now animates open and closed instead of appearing and disappearing instantly
- fixed the sheet briefly showing an empty black box on close; reopening it mid-close now starts clean

## v2.3.0 (2026-08-13)

- sky colors are now calculated from actual light and cloud data instead of a fixed table of 8 colors per weather code
- brightness reflects how much light gets through; gold reflects whether the sun is out; the two no longer interfere
- cloud cover no longer reads as automatically darker — a high sun through cloud renders close to white, and only thick, stormy sky reads dark
- fixed a bug where a 30%-cloudy hour rendered brighter than a clear one
- color transitions are now smooth between clear, mostly clear and partly cloudy instead of snapping between three fixed colors
- storms are now dark slate instead of violet, with the ⚡ marker indicating the storm
- no new data is fetched for this; colors come from cloud cover and weather code already in the forecast
- the classic version keeps the old color system unchanged

## v2.2.0 (2026-08-13)

- all controls (city name, three view buttons) now sit in one row at the bottom of the screen
- the settings gear is gone; tapping the city name opens a sheet with saved cities, search and the menu
- swiping up on the bottom row switches city; swiping sideways switches view; dragging the grid itself moves between days
- the per-day min/max row was removed, since that data now lives in the grid and tooltip
- search and the menu now open from the bottom of the screen, above the on-screen keyboard
- each of the three view buttons now shows its own current reading (rain chance, temp, wind) instead of only temperature
- a reading with no data shows a dash instead of a misleading zero, and units follow the settings
- removed the temperature/feels-like/condition band above the grid, since the view buttons now carry that
- the freshness line moved below the grid, with the forecast text reading first and freshness second

## v2.1.0 (2026-08-13)

- the day view now goes back two days as well as forward, to check overnight conditions
- a past hour shows actual rainfall instead of a forecast chance
- overnight totals now update if the model revises them

## v2.0.0 (2026-07-29)

- split the app into two versions: primary (new UI) and classic (original static screen)
- both share the same forecast data, colors, theming, caching and city handling

## v45 (2026-07-29)

- the starred city list no longer loops around, and the haptic tick on each city is lighter
- pulling in more hours or days now slides back into place on release instead of replaying the full grid animation
- dragging the hour/day rails takes more finger travel per step and pauses briefly before advancing, matching the city swipe
- the more-hours/more-days reveal waits for an open tooltip to close before sliding home
- switching rain/temp/wind now takes a bit more of a pull and pauses before sliding
- experimental: dragging the hour/day rails now crossfades the grid's colors continuously instead of snapping per step

## v44 (2026-07-29)

- added a settings page explaining how the hourly weather data is generated
- improved the styling of the What's New view

## v43 (2026-07-28)

- swiping between rain, temperature and wind now updates the grid live under the finger instead of jumping after release
- a swipe held without releasing lets you peek at another view, in either direction
- a quick flick still works the same way, just faster
- the gold underline under the active view slides along with the swipe

## v42 (2026-07-28)

- swiping up and down the grid now jumps through the full starred city list, looping, instead of stepping one city at a time
- a small rail shows position in the list while dragging
- fixed dragging the times on the left edge also changing city as a side effect
- dragging the times on the left edge reveals hours outside 6am–9pm; releasing slides back to the normal view
- dragging the day letters along the top reveals up to 14 days ahead; the app now keeps two weeks of forecast cached for this
- a home icon appears to jump back to today, and hides itself again after a few seconds
- can now star up to 9 favorite cities, up from 6
- the current-hour marker and day/night background stay accurate even after the app has been open a long time, without needing a fresh forecast

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
