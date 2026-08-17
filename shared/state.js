let state = {
    place: DEFAULT_PLACE,
    tz: 'Pacific/Auckland', // overwritten by every forecast response
    data: [],     // [day][{hour, temp, pop, condition, description}], all real hours
    days: [],     // [{text, isToday, date, past}]
    todayIndex: 0, // index of today within data/days; past days sit before it
    sun: {},      // date → { rise: {h, m}, set: {h, m} } (city-local)
    fetchedAt: 0, // timestamp of the forecast currently displayed
    modelRun: null, // global model run: { init, interval, nextUpdate } ms, from the metadata API
    localRun: null, // regional high-res model run (or null): { init, interval, nextUpdate, slug, label }
    loading: false,
    controller: null,
    online: navigator.onLine, // tracked via online/offline events
    swUpdate: false, // a newer app version is waiting a reload, surfaced on the status line; only a genuine mid-session deploy, never the load-time cache catch-up
    updateNote: false, // the brief "New version" note is up (tap opens the changelog), vs the resting reload CTA
    whatsNewPending: false, // we're running a build not seen before: owe a one-time "see what's new" note, shown once the line first rests
    lastError: '',   // last no-data error text, so updateStatus can restate it
    changed: null,   // "date|hour" → {pop|temp|wind: [was, now]} vs the previous model run
    pulsePending: false, // the next render pulses changed cells, then consumes this
    arrivePending: false, // new data is due an arrival on the current hour; primary's grid consumes it
    suggestions: [] // saved cities + geocoding hits, in display order
};
