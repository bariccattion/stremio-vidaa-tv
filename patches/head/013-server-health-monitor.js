// Server health monitoring + core heal
//
// Two jobs:
//  1. Page-level health probe (unchanged): GET <url>/settings every 10s
//     (fallback /heartbeat) into window.__SERVER_HEALTH__ — feeds the
//     Green-key overlay and the SERVER settings row fallback.
//  2. Core heal: the WASM core checks the streaming server ONCE (at Load /
//     URL change / Reload) with NO retry — a single transient failure sticks
//     as "Offline" in Settings forever while the server is actually fine and
//     playback works. When our page-level probe proves the server is online
//     but the core still reports no baseUrl, nudge it with a reload —
//     rate-limited so a permanently failing refetch (e.g. a response shape
//     the core can't parse) isn't spammed.
(function() {
    window.__SERVER_HEALTH__ = { status: 'unknown', latency: null, version: null };

    var HEAL_MIN_INTERVAL_MS = 60000;
    var HEAL_MAX_ATTEMPTS = 5;
    var healAttempts = 0;
    var healLastAt = 0;
    var healLastCoreUrl = null;

    function makeTimeoutSignal(ms) {
        try {
            if (typeof AbortController !== 'undefined') {
                var ctrl = new AbortController();
                setTimeout(function() { ctrl.abort(); }, ms);
                return ctrl.signal;
            }
        } catch(e) {}
        return undefined;
    }

    function checkHealth() {
        if ((window.location.hash || '').indexOf('#/player/') === 0) return;
        var url = window.__STREMIO_SERVER_URL__;
        if (!url) return;
        var signal = makeTimeoutSignal(5000);
        var start = Date.now();
        fetch(url + '/settings', { signal: signal }).then(function(r) {
            return r.json();
        }).then(function(data) {
            window.__SERVER_HEALTH__ = {
                status: 'online',
                latency: Date.now() - start,
                version: data.serverVersion || data.version || null
            };
            maybeHealCore();
        }).catch(function() {
            var start2 = Date.now();
            fetch(url + '/heartbeat', { signal: makeTimeoutSignal(5000) }).then(function() {
                window.__SERVER_HEALTH__ = { status: 'online', latency: Date.now() - start2, version: null };
                maybeHealCore();
            }).catch(function() {
                window.__SERVER_HEALTH__ = { status: 'offline', latency: null, version: null };
            });
        });
    }

    function maybeHealCore() {
        try {
            if (!window.core || typeof window.core.getState !== 'function') return;
            window.core.getState('streaming_server').then(function(state) {
                if (!state || typeof state !== 'object') return;
                var coreUrl = state.selected && state.selected.transportUrl;
                if (healLastCoreUrl === null) healLastCoreUrl = coreUrl;
                if (coreUrl !== healLastCoreUrl) { healLastCoreUrl = coreUrl; healAttempts = 0; }
                if (state.baseUrl) { healAttempts = 0; return; } // core agrees: online
                if (healAttempts >= HEAL_MAX_ATTEMPTS) return;
                var now = Date.now();
                if (now - healLastAt < HEAL_MIN_INTERVAL_MS) return;
                healLastAt = now;
                healAttempts++;
                window.core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } }, 'streaming_server')
                    .catch(function() {});
            }).catch(function() {});
        } catch (e) {}
    }

    setInterval(checkHealth, 10000);
    setTimeout(checkHealth, 3000);
})();
