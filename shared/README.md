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
gesture features (the reveal rails, the city selector and the playhead
rewrite it forced, the view scrub) plus the current-hour marker
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
| `colors.js` | the whole colour/gradient system: temp bands, wind ramp, both sky models, conditions, the rain blues, the legend strip | yes — the file is identical; which sky model it uses is picked by `SKY_MODEL` (see below) |
| `precip-pattern.js` | the original precipitation overlay, the pattern renderer, frozen | **classic only** (see below) |
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

### The second divergence: which precipitation renderer a variant names

`colors.js` is shared, so editing the overlay in place changed classic
too — and the line-rendering regression test was re-pointed at classic
precisely to hold the frozen system still. Rather than put two renderers
behind a flag inside one function, the split is by **concern**, and the
load-order machinery already supports it: each variant's `index.html`
lists its own `<script src>` tags and `build.mjs` inlines whatever is
listed, so a file only one variant names is a file only that variant
carries.

| file | what | carried by |
|---|---|---|
| `precip-pattern.js` | the frozen pattern renderer verbatim: `rainLinesSVG`, `snowLatticeSVG`, `hailRingsSVG`, `LN` | classic |
| `precip-field.js` | the mark field: one lattice, discrete marks, round caps | primary |

Both define the same entry point, so neither `app.js` knows which one it
got:

```js
const precipOverlay = (h, base, W, H) => …   // one per file, same signature
```

Classic is frozen by *not being touched* rather than by a branch, and
neither variant ships the other's renderer. Two constraints hold it
together: `precip-*.js` loads **after** `colors.js`, because it reads
`lnBlue`, `lnLum` and `SNOW_CODES` from there; and, per the rule above,
nothing in it may read a variant binding at evaluation time. Porting
classic later is one line in `classic/index.html` — swap which precip
file it names — plus whatever `classic/app.js` needs to hand the block's
pixel size to the call.

### The one deliberate divergence: `SKY_MODEL`

`colors.js` carries **two** sky models and each variant picks one with a
`SKY_MODEL` constant in its `config.js`. Primary uses `'radiance'`,
where clearness sets a block's brightness and sunshine sets how gold it is;
classic holds `'wmo'`, the earlier palette that picks one of eight fixed colours
by weather code. The file itself stays byte-identical, which is why it is still
shared — the divergence is one constant, in the file that already exists to
hold per-variant constants.

This is the opposite resolution from `cache.js` and `api.js` above, and
deliberately so. Those two converged because holding two behaviours cost
correctness in a shared cache. This one diverges because the *point* is to keep
the superseded system runnable: classic is where the `'wmo'` palette can still
be opened, compared against primary on the same city and hour, and
regression-tested. A regression test pins classic's exact output for that
reason, so a change to `conditionRGB` fails a test instead of quietly drifting.

Two things depend on the dispatch staying in `colors.js` rather than leaking
into the variants:

- `skyBaseRGB` is the single call site each `app.js` uses to paint a block.
- `skyLegend()` builds the rain-view key from whichever model is active, so the
  legend cannot describe a palette the grid is not painting. Neither `app.js`
  assembles the strip itself any more.

`SKY_MODEL` is read at evaluation time by `colors.js`, which is legal for the
same reason `api.js` may read `FORECAST_DAYS`: `config.js` loads first.

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
