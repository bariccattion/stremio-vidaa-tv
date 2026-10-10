// ═══════════════════════════════════════════════════════════════════════
// serverUrl — the ONE module owning the streaming server URL lifecycle.
// ═══════════════════════════════════════════════════════════════════════
// Collapses what used to be four shallow patches plus a setter copy in 042:
//   old 001: ?server= ingest           → ingest()  (param wins once, then localStorage)
//   old 005: boot push-to-core         → bootPush() (poll for the core, UpdateSettings + Reload)
//   old 006: core→localStorage mirror  → mirror poll (armed AFTER bootPush settles)
//   old 013: health monitor + core heal→ healthPoll (probe ladder + rate-limited heal)
//   old 042: helper-card setter copy   → set() (write-through + best-effort push)
// The boot ordering between push and mirror used to be a 10s timing guess
// split across two files; here it is explicit control flow: the mirror arms
// when the boot push settles (10s fallback if the core never appears).
//
// Interface (window.__serverUrl):
//   get()           current URL (defaults to the local sentinel)
//   set(url)        write-through: localStorage + window.__STREMIO_SERVER_URL__ + core push
//   probe(cb, ms)   RT.probeServer on the CURRENT url — one probe implementation
//   isConfigured()  true when a non-default server is set
//   health()        last health snapshot (same object as window.__SERVER_HEALTH__)
//
// Consumers of the globals this module keeps updating: window.__STREMIO_SERVER_URL__
// (007, 011, 030, 036, 040, 042, 043, chunk edit op2) and window.__SERVER_HEALTH__
// (Green-key overlay, settings SERVER row).
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var log = RT.logger('server-url');
    var LS_KEY = 'stremio_server_url';
    var DEFAULT_URL = 'http://127.0.0.1:11470';

    // ── Ingest: ?server= wins once; localStorage is the source afterwards. ──
    (function ingest() {
        var server = null;
        try {
            server = new URLSearchParams(window.location.search).get('server');
        } catch (e) {}
        if (server) RT.store.set(LS_KEY, server.replace(/\/+$/, ''));
        window.__STREMIO_SERVER_URL__ = RT.store.get(LS_KEY, DEFAULT_URL);
    })();

    function get() {
        return window.__STREMIO_SERVER_URL__ || DEFAULT_URL;
    }

    function isConfigured() {
        var u = get();
        return !!(u && u !== DEFAULT_URL);
    }

    // ── Core push: point the WASM core at our URL (settings + reload). ──
    function pushToCore(url, done) {
        try {
            if (!RT.coreUsable()) { if (done) done(); return; }
            RT.core.getState('ctx').then(function(ctxState) {
                if (!ctxState || !ctxState.profile || !ctxState.profile.settings) { if (done) done(); return; }
                var cur = ctxState.profile.settings;
                if (cur.streamingServerUrl === url) { if (done) done(); return; }
                var ns = {};
                for (var k in cur) ns[k] = cur[k];
                ns.streamingServerUrl = url;
                return RT.core.dispatch({ action: 'Ctx', args: { action: 'UpdateSettings', args: ns } }, 'ctx').then(function() {
                    return RT.core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } }, 'streaming_server');
                }).then(function() {
                    log('Pushed URL to core, streaming server reloaded');
                    if (done) done();
                }).catch(function(e) {
                    log.error('Push failed:', e);
                    if (done) done();
                });
            }).catch(function(e) {
                log.error('Failed to read ctx state:', e);
                if (done) done();
            });
        } catch (e) { if (done) done(); }
    }

    function set(url) {
        url = (url || '').trim().replace(/\/+$/, '');
        if (!url) return false;
        RT.store.set(LS_KEY, url);
        window.__STREMIO_SERVER_URL__ = url;
        pushToCore(url); // best-effort; the mirror reconciles later if it fails
        return true;
    }

    function probe(cb, timeoutMs) {
        RT.probeServer(get(), cb, timeoutMs);
    }

    // ── Boot push: wait for the core, push once, then arm the mirror. ──
    var bootPushSettled = false;
    (function bootPush() {
        if (!isConfigured()) { bootPushSettled = true; return; } // nothing to push
        var url = get();
        var attempts = 0;
        var t = setInterval(function() {
            if (bootPushSettled || ++attempts > 60) { clearInterval(t); bootPushSettled = true; return; }
            if (!RT.coreUsable()) return;
            clearInterval(t);
            pushToCore(url, function() { bootPushSettled = true; });
        }, 500);
        // The mirror must not wait forever on a core that never appears.
        setTimeout(function() { bootPushSettled = true; }, 10000);
    })();

    // ── Mirror: the core is the source of truth for USER changes (native ──
    // Settings dialog, account sync); copy core→localStorage+global so this
    // layer probes the right server. Event-driven since P1.1/P1.5: an
    // RT.core.onState('ctx') subscription replaces the 2 s poll — same
    // worst-case cadence (rate limit), immediate reaction at best. The
    // mirror only arms after the boot push settles (explicit control flow,
    // as before), with one direct pull at settle so a failed push still
    // reconciles even if no NewState event arrives.
    var lastKnownUrl = null;
    function mirrorCheck(state) {
        if (!bootPushSettled) return;
        if (!state || !state.profile || !state.profile.settings) return;
        var url = state.profile.settings.streamingServerUrl;
        if (lastKnownUrl === null) { lastKnownUrl = url; return; }
        if (url !== lastKnownUrl) {
            lastKnownUrl = url;
            var stored = RT.store.get(LS_KEY, null);
            window.__STREMIO_SERVER_URL__ = url;
            if (stored !== url) {
                RT.store.set(LS_KEY, url);
                RT.core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } }, 'streaming_server').then(function() {
                    log('URL changed ->', url, '; mirrored to localStorage; streaming server reloaded');
                }).catch(function(e) {
                    log.error('Reload failed:', e);
                });
            }
        }
    }
    if (RT.core && RT.core.onState) {
        RT.core.onState('ctx', mirrorCheck);
    }
    RT.coreReady(function() {
        // One direct pull once the boot push has had its chance, so a
        // failed push reconciles even without a subsequent NewState event.
        setTimeout(function() {
            if (!bootPushSettled) return;
            if (!(RT.core && RT.core.getState)) return;
            RT.core.getState('ctx').then(mirrorCheck).catch(function() {});
        }, 1500);
    });

    // ── Health monitor + core heal. ─────────────────────────────────────
    // The core checks the streaming server ONCE (Load / URL change / Reload)
    // with NO retry — one transient failure sticks as Offline forever while
    // the server is fine. This ladder feeds window.__SERVER_HEALTH__ and,
    // when we prove online but the core has no baseUrl, nudges it with a
    // rate-limited Reload.
    window.__SERVER_HEALTH__ = { status: 'unknown', latency: null, version: null };

    var HEAL_MIN_INTERVAL_MS = 60000;
    var HEAL_MAX_ATTEMPTS = 5;
    var healAttempts = 0;
    var healLastAt = 0;
    var healLastCoreUrl = null;

    function maybeHealCore() {
        try {
            if (!RT.coreUsable()) return;
            RT.core.getState('streaming_server').then(function(state) {
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
                RT.core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } }, 'streaming_server')
                    .catch(function() {});
            }).catch(function() {});
        } catch (e) {}
    }

    function checkHealth() {
        var url = get();
        if (!url) return;
        var start = Date.now();
        RT.fetchTimeout(url + '/settings', 5000).then(function(r) {
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
            RT.fetchTimeout(url + '/heartbeat', 5000).then(function() {
                window.__SERVER_HEALTH__ = { status: 'online', latency: Date.now() - start2, version: null };
                maybeHealCore();
            }).catch(function() {
                window.__SERVER_HEALTH__ = { status: 'offline', latency: null, version: null };
            });
        });
    }

    RT.poll(checkHealth, 10000, { route: 'nonplayer' });
    setTimeout(checkHealth, 3000);

    window.__serverUrl = {
        get: get,
        set: set,
        probe: probe,
        isConfigured: isConfigured,
        health: function() { return window.__SERVER_HEALTH__; }
    };

    log('module ready (url:', (isConfigured() ? get() : 'default') + ')');
})();
