# shared/

The non-visual core, used by both variants. These files are **never
published**: `build.mjs` inlines them into each variant's `index.html`
before minifying, so production is still one self-contained file per
variant with no extra requests. The `<script src>` tags in the variant
HTML exist only so the dev copy opens straight in a browser.

## Load order

```
<variant>/config.js  →  shared/*.js  →  <variant>/app.js
```

Everything shares one lexical scope, exactly as it did when the app was a
single file. The app has around 400 top-level bindings with pervasive
forward references that work by call-time deferral (`glyphFor` reads `WMO`
declared 450 lines later; `sweepForecasts` reads `favorites` declared 2,000
lines later). Rewriting those as ESM imports would mean hundreds of edits
whose failures surface at runtime rather than at load. Plain concatenation
preserves the existing semantics.

That imposes one rule: **nothing in `shared/` may reference a variant
binding at evaluation time.** Function bodies may, since they run later.
Top-level initialisers may not. Order within `shared/` matters for the same
reason. `state.js` reads `DEFAULT_PLACE`, and `settings.js` and `places.js`
call `loadJSON`, so `constants.js` and `cache.js` load before them.

`config.js` loads first, ahead of `shared/`, because the core reads
`FORECAST_DAYS`: `api.js` builds the request URL from it and `cache.js`
stamps and checks it. That is the only inversion, and it is why the frame
geometry lives in `config.js` instead of in `app.js` with the rest of it.

## The boundary that landed

The split was mapped by diffing the two variants region by region. Of the
roughly 2,600 lines that differ between them, almost all belong to three
gesture features (DR-29 reveal rails, DR-32 city selector and the playhead
rewrite it forced, DR-30 view scrub) plus the current-hour marker
keep-alive. The core came out **byte-identical**, which is why these files
are shared directly instead of parameterised.

| file | what | was identical? |
|---|---|---|
| `constants.js` | timings, `LS_*` keys, caps, model list, `DEFAULT_PLACE` | yes |
| `dom.js` | `$`, `show`, `esc` | yes |
| `state.js` | the single mutable `state` object | yes |
| `cache.js` | `placeKey`, localStorage JSON, per-place forecast cache, sweep, change detection | see below |
| `settings.js` | `settings`/`view` declaration, defaults, `VIEWS` | yes |
| `format.js` | unit and clock formatting | yes |
| `colors.js` | the whole colour/gradient system: temp bands, wind ramp, sky palette, conditions, rain/snow/hail overlays | yes (390 lines) |
| `icons.js` | `MR_ICON` | yes |
| `astro.js` | moon phase, lunar eclipses | yes |
| `wmo.js` | WMO code to condition, weekday and date labels | yes |
| `forecast.js` | `processData`, payload into `state.data`/`days`/`sun`/`tz` | yes |
| `api.js` | request URL, model metadata, `fetchWeather` | see below |
| `places.js` | geocoding, favorites, recents, share links, geolocation | yes |
| `install.js` | PWA install eligibility and banner | yes |
| `sw-update.js` | SW registration and update announcement | yes |

Two files were not identical. In both cases classic adopted primary's
version rather than the code being parameterised:

- **`cache.js`**: primary's `saveForecast` stamps the horizon a payload was
  fetched with, and `staleHorizon` checks it. Classic had neither.
- **`api.js`**: the request horizon (`forecast_days`) and the freshness
  guard that consults `staleHorizon`.

Both reduce to the same decision. The two variants now fetch the same 15
days. See `classic/config.js` for why: a shared cache holding two different
horizons is asymmetric in both directions.

## What is not here

The grid painter and the wave/playhead engine, `buildCols`,
`updateDisplay`, every gesture and rail, the tooltip, the settings-menu
markup, the legend, the status line, and all CSS. The painter was rewritten
between the two variants rather than extended, and the status line is the
app's single state channel. Both belong to variant identity.

## The UI contract

`shared/` does not import a UI. It calls functions that each variant's
`app.js` must define, so the core knows that something paints without
knowing how. A new variant has to provide all of these:

| name | called from | job |
|---|---|---|
| `setStatus(text, kind, opts)` | `api.js`, `places.js` | write the status line |
| `updateStatus()` | `api.js`, `sw-update.js` | recompute the resting status line |
| `setLoading(bool)` | `api.js` | enter or leave the loading state |
| `showError(msg)` | `api.js` | surface a fetch failure |
| `updateDisplay(anim)` | `api.js` | repaint the grid from `state` |
| `armClocks()` | `api.js` | re-arm city-local timers after a payload lands |
| `changeCity(place, remember)` | `places.js` | switch the current place |
| `renderSuggestions()` | `places.js` | redraw the search dropdown |
| `flashFavHint()` | `places.js` | signal the favorites cap was hit |
| `nextRevealAnim` | `api.js` | pending reveal animation (a `let`, not a function) |

`armClocks` is the only one the split introduced. Primary arms a midnight
rollover and an hour tick; classic has no hour tick, so it arms only the
rollover. Everything else already existed under these names.

## Compatibility contract

Both variants share every `LS_*` key, including favorites, recents, and the
per-place forecast cache. A favorite saved in one appears in the other.
Several things depend on that holding:

- The stored place shape is exactly `{name, country, admin1, latitude,
  longitude}` and is identical in both variants. Unknown fields round-trip,
  because `renderSuggestions` spreads stored objects, so a future variant
  may add keys without breaking the others.
- `MAX_FAVORITES` is shared, so the two can never disagree about the cap.
  The cap is enforced only on add, and nothing truncates on load, so an
  over-cap list renders rather than losing data.
- Identity everywhere is `placeKey`, 3-dp lat/lon. Changing that precision
  would orphan every favorite, recent, and cache entry at once.
- One pre-existing trap, unchanged by the split: `loadCities` validates
  `name` and `latitude` but not `longitude`, while `placeKey` reads
  `longitude` unguarded.

Service-worker caches are the exception. They are per-origin rather than
per-scope, so each variant's `sw.js` carries its own `CACHE_PREFIX` and its
activate sweep only deletes keys under that prefix. Neither prefix may be a
prefix of the other, or one variant's activation would evict the other's
shell.

## Testing

`scripts/boot-test.mjs` boots a built variant in jsdom with a stubbed
network and checks it renders without errors.
`scripts/cross-variant-test.mjs` boots one variant, then feeds its
localStorage to the other, in both directions.

```
node scripts/boot-test.mjs primary
node scripts/boot-test.mjs classic
node scripts/cross-variant-test.mjs 1     # primary writes, classic reads
node scripts/cross-variant-test.mjs 2     # classic writes, primary reads
```

They need `npm install jsdom` and a prior `npm run build`.
