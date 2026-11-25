// E-ink build only. build.mjs inlines this ahead of primary's config.js
// into dist/eink/index.html; primary itself never carries it.
//
// The app gates every animation on one reduced-motion query (REDUCE_Q in
// primary/app.js). An e-ink panel redraws each animation frame as a partial
// refresh, so this build answers that query "reduce" whatever the device
// says, and every JS-driven sweep, slide and arrival takes its static path.
{
    const mm = window.matchMedia.bind(window);
    window.matchMedia = q => {
        const mql = mm(q);
        if (/prefers-reduced-motion:\s*reduce/.test(q)) Object.defineProperty(mql, 'matches', { value: true });
        return mql;
    };
}
