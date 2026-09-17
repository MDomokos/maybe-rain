// --- ?nosw: leave the service worker behind ---------------------------
// For a device stuck on a shell no reload shifts: unregister every worker for
// this scope, drop the caches they own, and reload without the flag. `?dev`
// (see sw.js) covers the common case and changes nothing about the install;
// this is for when the install is the problem. Scoped to this app's cache
// names, so another app on the same origin keeps its storage.
const swReset = typeof location !== 'undefined' && /[?&]nosw\b/.test(location.search);
if (swReset && 'serviceWorker' in navigator) {
    (async () => {
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
            if (window.caches) {
                const keys = await caches.keys();
                await Promise.all(keys.filter(k => k.startsWith('maybe-rain')).map(k => caches.delete(k)));
            }
        } catch { /* nothing to undo */ }
        // Without the flag, or the reload would land here again.
        const q = new URLSearchParams(location.search);
        q.delete('nosw');
        const qs = q.toString();
        location.replace(location.pathname + (qs ? `?${qs}` : '') + location.hash);
    })();
}

if (!swReset && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        let swSettled = false;
        setTimeout(() => { swSettled = true; }, SW_SETTLE_MS);
        const announceUpdate = () => {
            if (state.swUpdate || !swSettled) return; // ignore the load-time cache catch-up
            state.swUpdate = true;
            if (!state.loading) updateStatus(); // shows "↻ Update app"; else paints once data loads
        };
        navigator.serviceWorker.register('sw.js').then(reg => {
            // Already waiting at register time (installed on a prior visit).
            if (reg.waiting && navigator.serviceWorker.controller) announceUpdate();
            // A new worker starts installing: watch it reach "installed"
            // while a controller exists, which means an update (not the
            // first-ever install).
            reg.addEventListener('updatefound', () => {
                const w = reg.installing;
                if (!w) return;
                w.addEventListener('statechange', () => {
                    if (w.state === 'installed' && navigator.serviceWorker.controller) announceUpdate();
                });
            });
            // Re-check for a new deploy when the app returns to the
            // foreground (when a resident PWA most likely has one waiting),
            // throttled so a quick tab flip doesn't spam the network. This
            // is what makes the reload CTA reachable at all off navigation.
            let lastCheck = Date.now();
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState !== 'visible') return;
                if (Date.now() - lastCheck < SW_CHECK_THROTTLE) return;
                lastCheck = Date.now();
                reg.update().catch(() => {});
            });
        }).catch(() => {});
    });
}

// --- The running build, at the foot of the settings menu --------------
// Prints sw.js's CACHE_NAME verbatim, so the menu can be compared
// against the file. The token is assembled, not written out: build.mjs
// replaces every occurrence of it, including this one.
const versionReadout = () => {
    const token = '__APP_' + 'VERSION__';
    const build = APP_VERSION === token ? 'unbuilt' : APP_VERSION;
    return '<div class="shortcuts-hint"><div class="sc">'
        + `<span>Version</span><span>${esc(build)}</span></div></div>`;
};
