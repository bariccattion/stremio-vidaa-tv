// ═══════════════════════════════════════════════════════════════════════
// VIDAA runtime kernel — the ONE shared toolbox for all patches.
// ═══════════════════════════════════════════════════════════════════════
// Every patch below this one used to ship its own copy of the same utilities
// (11 toast builders, 5 fetch-with-timeout ladders, 10 isEnabled() wrappers
// with DIVERGENT default semantics, 8 identical registry bootstrap polls, 2
// serverReady() clones). This module is the consolidation: a small interface,
// one implementation. Patches consume window.__vidaaRuntime (aliased as RT
// locally) and their private copies are deleted.
//
// Interface:
//   RT.toast(text, opts)                  opts: {at:'top'|'center'|'bottom',
//                                          bg, ms, sticky, id, extra, fadeMs}
//                                        Returns the element (callers may remove it).
//   RT.logger(name)                       Returns a log fn for '[vidaa:name]' — call it
//                                        as log(msg, …), or log.warn(…)/log.error(…).
//   RT.store.get(key, fallback)           try/catch'd localStorage read.
//   RT.store.set(key, value)              try/catch'd write ('true'/'false' for booleans).
//   RT.store.getBool(key, defaultValue)   Unified toggle read that preserves BOTH
//                                        legacy semantics: 'true'→true, 'false'→false,
//                                        anything else (incl. missing) → defaultValue.
//   RT.fetchTimeout(url, ms, fetchOpts)   Promise<Response>; rejects Error('timed out').
//                                        Settles exactly once, with or without AbortController.
//   RT.probeServer(url, cb, timeoutMs)    Stremio streaming-server probe (GET /settings).
//                                        cb({url, reachable, note}).
//   RT.onRegistryReady(fn)                Runs fn once window.__registerVidaaSettingsItem
//                                        exists; ONE shared poller for all callers.
//   RT.when(test, fn)                     Runs fn once test() turns truthy (shared poller).
//   RT.coreUsable()                       True once window.core answers getState — the ONE
//                                        core-booted predicate (splash removal, serverUrl
//                                        push/heal asked here instead of re-testing inline).
//   RT.coreReady(fn)                      Runs fn once the core is usable (RT.when-based).
//                                        window.__VIDAA_CORE_READY__ latches the same fact
//                                        exactly once, for flag-pollers (tests, probe-core).
//   RT.serverConfigured()                 True when a non-default streaming server URL is set.
//   RT.poll(fn, ms, opts)                 Route- and quiet-gated setInterval. opts:
//                                          route: 'player'|'nonplayer' (default both),
//                                          quiet: skip ticks while Quiet Player Mode is
//                                          active (default TRUE — background maintenance
//                                          goes silent; pass false for safety- or
//                                          playback-critical pollers).
//
// ES5 only, no dependencies, must load before 001.
(function() {
    'use strict';

    var RT = {};

    // ── logger ────────────────────────────────────────────────────────
    // One factory replaces the per-patch log() helpers and the inline
    // console.log('[prefix] …') calls: uniform '[vidaa:name]' provenance so
    // our layer is distinguishable from the Stremio app's own console output.
    // The returned value is a FUNCTION (console.log) with .warn/.error
    // attached, so existing call shapes keep working.
    RT.logger = function(name) {
        var prefix = '[vidaa:' + name + ']';
        function emit(method) {
            return function() {
                var args = [prefix];
                for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
                try { console[method].apply(console, args); } catch (e) {}
            };
        }
        var fn = emit('log');
        fn.warn = emit('warn');
        fn.error = emit('error');
        return fn;
    };

    // ── store ─────────────────────────────────────────────────────────
    RT.store = {
        get: function(key, fallback) {
            try {
                var v = localStorage.getItem(key);
                return (v === null || v === undefined) ? fallback : v;
            } catch (e) { return fallback; }
        },
        set: function(key, value) {
            try { localStorage.setItem(key, typeof value === 'boolean' ? String(value) : value); } catch (e) {}
        },
        remove: function(key) {
            try { localStorage.removeItem(key); } catch (e) {}
        },
        getBool: function(key, defaultValue) {
            var v = RT.store.get(key, null);
            if (v === 'true') return true;
            if (v === 'false') return false;
            return !!defaultValue;
        }
    };

    // ── fetch with timeout ────────────────────────────────────────────
    // Done-latch + AbortController: settles exactly once even on engines
    // without AbortController (mirrors the ladder patterns it replaces).
    RT.fetchTimeout = function(url, timeoutMs, fetchOpts) {
        return new Promise(function(resolve, reject) {
            var done = false;
            var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var t = setTimeout(function() {
                if (ctrl) { try { ctrl.abort(); } catch (e) {} }
                if (!done) { done = true; reject(new Error('timed out')); }
            }, timeoutMs || 2500);
            var opts = fetchOpts;
            if (ctrl) {
                opts = {};
                for (var k in (fetchOpts || {})) opts[k] = fetchOpts[k];
                opts.signal = ctrl.signal;
            }
            try {
                fetch(url, opts)
                    .then(function(r) { if (done) return; done = true; clearTimeout(t); resolve(r); })
                    .catch(function(e) { if (done) return; done = true; clearTimeout(t); reject(e); });
            } catch (e) {
                if (!done) { done = true; clearTimeout(t); reject(e); }
            }
        });
    };

    // ── streaming-server probe (GET /settings, version note) ─────────
    // Contract shared by the diagnostic panel (041), helper setup (042)
    // and the native server dialog (043).
    RT.probeServer = function(url, cb, timeoutMs) {
        url = (url || '').replace(/\/+$/, '');
        if (!url) { cb({ url: '(none configured)', reachable: false, note: 'no URL' }); return; }
        RT.fetchTimeout(url + '/settings', timeoutMs || 2500)
            .then(function(r) {
                if (!r.ok) { cb({ url: url, reachable: false, note: 'HTTP ' + r.status }); return; }
                r.json().catch(function() { return {}; }).then(function(data) {
                    var v = data && (data.serverVersion || data.version || (data.values && data.values.serverVersion));
                    cb({ url: url, reachable: true, note: v ? ('v' + v) : 'online' });
                });
            })
            .catch(function(e) { cb({ url: url, reachable: false, note: (e && e.message) || 'unreachable' }); });
    };

    // ── toast ─────────────────────────────────────────────────────────
    // Three anchored presets; `extra` cssText is appended LAST so duplicate
    // properties in it override the preset (css cascade within cssText).
    // An `id` makes the toast replace-or-create (and cancels its pending
    // hide/fade timers), matching the dv-server-toast scanning behavior.
    var TOAST_BASE = {
        top:    'position:fixed;top:40px;left:50%;transform:translateX(-50%);background:rgba(123,91,245,0.95);color:#fff;padding:10px 22px;border-radius:8px;font-family:PlusJakartaSans,sans-serif;font-size:0.92rem;z-index:100000;max-width:80%;text-align:center;line-height:1.4;',
        center: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.88);color:#fff;padding:16px 28px;border-radius:10px;font-size:1.05rem;font-family:PlusJakartaSans,sans-serif;z-index:100000;pointer-events:none;text-align:center;max-width:500px;',
        bottom: 'position:fixed;bottom:42px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.88);color:#fff;padding:12px 18px;border-radius:10px;font-size:1rem;font-family:PlusJakartaSans,sans-serif;z-index:100003;max-width:min(88vw,720px);text-align:center;box-shadow:0 12px 30px rgba(0,0,0,0.4);'
    };
    var toastTimers = {};   // id -> [timerId, ...]
    RT.toast = function(text, opts) {
        opts = opts || {};
        try {
            var css = TOAST_BASE[opts.at || 'bottom']
                + (opts.bg ? ('background:' + opts.bg + ';') : '')
                + (opts.extra || '');
            var el;
            if (opts.id) {
                var old = document.getElementById(opts.id);
                if (old && old.parentNode) old.remove();
                var pending = toastTimers[opts.id] || [];
                for (var i = 0; i < pending.length; i++) clearTimeout(pending[i]);
                toastTimers[opts.id] = [];
                el = document.createElement('div');
                el.id = opts.id;
            } else {
                el = document.createElement('div');
            }
            el.style.cssText = css;
            el.textContent = text;
            document.body.appendChild(el);
            if (!opts.sticky) {
                var timers = toastTimers[opts.id] || (toastTimers[opts.id] = []);
                if (opts.fadeMs != null) {
                    timers.push(setTimeout(function() { try { el.style.opacity = '0'; } catch (e) {} }, opts.fadeMs));
                }
                timers.push(setTimeout(function() { try { if (el.parentNode) el.remove(); } catch (e) {} }, opts.ms || 2500));
            }
            return el;
        } catch (e) { return null; }
    };

    // ── deferred-ready bootstrap ──────────────────────────────────────
    // RT.when(test, fn): run fn once test() is truthy. ONE shared 200ms
    // ticker serves every pending when(); callers arriving late (test
    // already true) run immediately. onRegistryReady is the common case.
    // Definers of commonly-awaited globals call RT.when.flush() right after
    // defining, so dependents run in the same script tick instead of racing
    // the ticker.
    var whenPending = [];
    var whenTicker = null;
    function drainPending() {
        var still = [];
        for (var i = 0; i < whenPending.length; i++) {
            var w = whenPending[i];
            var ok = false;
            try { ok = !!w.test(); } catch (e) {}
            if (ok) { try { w.fn(); } catch (e) {} }
            else still.push(w);
        }
        whenPending = still;
        if (!whenPending.length && whenTicker !== null) {
            clearInterval(whenTicker);
            whenTicker = null;
        }
    }
    RT.when = function(test, fn) {
        var ready = false;
        try { ready = !!test(); } catch (e) {}
        if (ready) { try { fn(); } catch (e) {} return; }
        whenPending.push({ test: test, fn: fn });
        if (whenTicker === null) whenTicker = setInterval(drainPending, 200);
    };
    RT.when.flush = drainPending;

    RT.onRegistryReady = function(fn) {
        RT.when(function() { return !!window.__registerVidaaSettingsItem; }, fn);
    };

    // ── core-booted signal ────────────────────────────────────────────
    // "Usable" means window.core answers getState — the real WASM engine
    // after init resolves, or a test double honoring the same contract.
    // The predicate lived inline in splash.js, server-url.js and
    // probe-core.mjs before; they ask RT now. The latched flag gives
    // pollers a stable marker instead of a predicate they must replicate.
    RT.coreUsable = function() {
        return !!(window.core && typeof window.core.getState === 'function');
    };
    RT.coreReady = function(fn) {
        RT.when(RT.coreUsable, fn);
    };
    RT.coreReady(function() { window.__VIDAA_CORE_READY__ = true; });

    // ── streaming-server configured? ──────────────────────────────────
    RT.serverConfigured = function() {
        var u = window.__STREMIO_SERVER_URL__ || '';
        return !!(u && u !== 'http://127.0.0.1:11470');
    };

    // ── route predicate ─────────────────────────────────────────────
    // The ONE player-route check (hash PREFIX matching) — the same
    // semantics RT.poll's route option and the key dispatcher use.
    RT.inPlayer = function() {
        return (window.location.hash || '').indexOf('#/player/') === 0;
    };

    // ── heap pressure ───────────────────────────────────────────────
    // The ONE JS-heap read (Chrome-only performance.memory; null where
    // unavailable). Compare raw used/limit for threshold exactness.
    RT.heapPressure = function() {
        try {
            var m = performance.memory;
            if (!m || !m.jsHeapSizeLimit) return null;
            return { used: m.usedJSHeapSize, limit: m.jsHeapSizeLimit };
        } catch (e) { return null; }
    };

    // ── fetch tap ────────────────────────────────────────────────────
    // Observe JSON responses without disturbing them: the response is
    // cloned for the tap, the original promise passes through untouched.
    // Calls chain — a second tap wraps the first's wrapper.
    RT.tapJsonFetch = function(matchUrl, onData) {
        var orig = window.fetch;
        if (typeof orig !== 'function') return;
        window.fetch = function(url, opts) {
            var result = orig.apply(this, arguments);
            try {
                if (typeof url === 'string' && matchUrl(url)) {
                    result.then(function(response) {
                        var cloned = response.clone();
                        cloned.json().then(function(data) {
                            try { onData(data); } catch (e) {}
                        }).catch(function() {});
                    }).catch(function() {});
                }
            } catch (e) {}
            return result;
        };
    };

    // ── poller scheduler ──────────────────────────────────────────────
    // The single place that knows the active route and the Quiet Player
    // Mode flag; patches declare their conditions at registration instead
    // of re-checking them inline. This is the contract the deleted 039 patch
    // promised and never delivered (it was a no-op).
    //
    // Semantics:
    //   route 'player'    — tick only on #/player/ routes
    //   route 'nonplayer' — tick only off the player route
    //   quiet (default)   — skip ticks while window.__QUIET_PLAYER_ACTIVE__
    //                       (set by player/quiet-mode.js: opt-in toggle,
    //                       in-player only). Background maintenance goes silent;
    //                       pollers that must never pause (freeze watchdog, playback-
    //                       critical feature watchers) pass quiet:false.
    //
    // Route semantics intentionally use hash PREFIX matching ('#/player/…'),
    // matching the checks the migrated patches already performed inline.
    // A thrown tick is logged via the '[vidaa:poll]' logger, not propagated.
    var pollLog = null;
    RT.poll = function(fn, ms, opts) {
        opts = opts || {};
        var wantQuiet = opts.quiet !== false;
        var route = opts.route;
        return setInterval(function() {
            try {
                if (route) {
                    var inPlayer = RT.inPlayer();
                    if (route === 'player' ? !inPlayer : inPlayer) return;
                }
                if (wantQuiet && window.__QUIET_PLAYER_ACTIVE__) return;
                fn();
            } catch (e) {
                if (pollLog === null) pollLog = RT.logger('poll');
                pollLog.error('tick failed:', (e && e.message) || e);
            }
        }, ms);
    };

    window.__vidaaRuntime = RT;
})();
