# changelog

what changed, newest first. the version is `CACHE_NAME` in sw.js (v17, v18...), and each one has a git tag so I can diff between them.

## unreleased

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
