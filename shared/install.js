// --- PWA install: banner + ⚙ row ----------------------------------
// Chrome/Edge (desktop & Android) fire beforeinstallprompt; it's
// deferred for a native prompt on demand. iOS Safari never fires it,
// so it gets share-sheet instructions instead. Already installed
// (standalone) hides everything.
const isStandalone = () =>
    matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS masquerades as Mac
let deferredInstall = null;
const IOS_HINT = 'Share → Add to Home Screen';

// The banner must never pre-empt the forecast. It stays hidden until
// (1) there's something to offer: beforeinstallprompt has fired, or
// we're on iOS; (2) the grid has painted real data at least once; and
// (3) a short read delay passes so the visitor sees the site first.
// Dismissal (or install) is remembered across visits via LS_INSTALL.
const INSTALL_DELAY_MS = 5000;      // let people read the forecast first
let firstPaintDone = false;
let installBannerTimer = null;

const installEligible = () =>
    !isStandalone() && !loadJSON(LS_INSTALL) && (deferredInstall || isIOS());

// Actually paint the pill. Sets its copy from whichever path applies,
// then flips on the .revealed class (see CSS default of display:none).
const revealInstallBanner = () => {
    installBannerTimer = null;
    if (!installEligible()) return;
    if (deferredInstall) {
        $('installText').textContent = 'Add Maybe Rain? to your home screen';
        show($('installGo'), true);
    } else { // iOS: no native prompt, show the share-sheet hint instead
        $('installText').innerHTML = `Install: <span class="hint">${esc(IOS_HINT)}</span>`;
        show($('installGo'), false);
    }
    $('installBanner').classList.add('revealed');
};

const hideInstallBanner = () => {
    clearTimeout(installBannerTimer);
    installBannerTimer = null;
    $('installBanner').classList.remove('revealed');
};

// Arm the delayed reveal. A no-op until BOTH a source exists and the
// grid has painted, so an early beforeinstallprompt can't jump ahead
// of the forecast. Idempotent while a timer is pending or already up.
const maybeScheduleInstallBanner = () => {
    if (!firstPaintDone || !installEligible()) return;
    if (installBannerTimer || $('installBanner').classList.contains('revealed')) return;
    installBannerTimer = setTimeout(revealInstallBanner, INSTALL_DELAY_MS);
};

const promptInstall = async () => {
    if (!deferredInstall) return;
    const p = deferredInstall;
    deferredInstall = null;
    hideInstallBanner();
    try { p.prompt(); await p.userChoice; } catch { /* dismissed */ }
};
// ⚙ row: native install button, iOS instructions, or nothing.
const installSettingsRow = () => {
    if (isStandalone()) return '';
    if (deferredInstall) return `<div class="setting-row"><span>App</span>` +
        `<button class="btn" id="installBtn" style="padding:5px 10px;font-size:12px;">Install</button></div>`;
    if (isIOS()) return `<div class="setting-row"><span>App</span><span>${esc(IOS_HINT)}</span></div>`;
    return '';
};
window.addEventListener('beforeinstallprompt', e => {
    // Fires early, often before the forecast has painted. Capture it
    // and let the paint + delay gate decide when (if ever) to show.
    e.preventDefault();
    deferredInstall = e;
    maybeScheduleInstallBanner();
});
window.addEventListener('appinstalled', () => { deferredInstall = null; hideInstallBanner(); });
$('installGo').onclick = promptInstall;
$('installDismiss').onclick = () => { saveJSON(LS_INSTALL, true); hideInstallBanner(); };
