if ('serviceWorker' in navigator) {
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
