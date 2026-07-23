# Maybe Rain?
![maybe rain? logo a squre grid of colored pixels in the shape of a rain cloud](https://github.com/MDomokos/maybe-rain/blob/main/icons/icon-192.d5c01ea6.png "Maybe Rain? Logo")

A weather PWA that answers one question at a glance: will it rain, and when?

## the idea

Maybe Rain shows a full week of hour-by-hour conditions on a single screen, no interaction needed. Open it, glance, done.

## principles

1. Glanceable first. The core answer (when it will rain this week) reads in under 5 seconds, no scrolling. Extended details on tap.
2. One screen. The whole forecast fits one phone viewport.
3. Honest data. Never show fabricated or interpolated data as if it were real.
4. Simple tech. One HTML file, no framework, no build step, no backend, free APIs. The whole source reads in one sitting.
5. Instant. Renders the cached shell immediately while fresh data loads. First paint under a second.
6. No ads, no analytics, no tracking. Served as a static site, once PWA is installed the only internet connection is to Open Meteo API.

## running it

Static site and PWA, nothing to build. Open `index.html`, or install the PWA from GitHub Pages. Live at [mdomokos.github.io/maybe-rain/](https://mdomokos.github.io/maybe-rain/)
