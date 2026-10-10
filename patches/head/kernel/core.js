// ═══════════════════════════════════════════════════════════════════════
// RT.core — the ONE Promise-normalized seam over the WASM core (P1.1).
// ═══════════════════════════════════════════════════════════════════════
// Why this exists: four patches were shipped dead because they called
// `window.core.getState(field)` synchronously — it ALWAYS returns a Promise
// (Bridge.call, v5-worker.js:460-499), so a truthy Promise with undefined
// fields flowed through every `if (!state)` guard (see
// docs/PATCHES_VS_UPSTREAM.md §2.1). This wrapper makes that bug class
// impossible to reintroduce accidentally:
//
//   RT.core.getState(field)  → Promise<state> — VALIDATES the field name
//                              against the ten real models (unknown field
//                              rejects loudly instead of silently resolving
//                              a wrong-shaped state). Rejects 'core not
//                              usable' before the core boots.
//   RT.core.dispatch(action, field) → Promise — same validation; the field
//                              argument stays optional as upstream allows.
//   RT.core.onState(field, fn) → off() — NewState-event-driven pulls with
//                              per-field debounce (300 ms) + rate limit
//                              (2 s), so the worst case equals the old
//                              polling cadence and the best case reacts
//                              immediately. fn receives non-null states only.
//
// Valid fields (main.js model registry, byte-verified): ctx, board,
// continue_watching_preview, discover, library, meta_details, player,
// search, streaming_server, auth_link.
//
// Event plumbing: the app's CoreProvider assigns window.onCoreEvent once
// the core initializes (and clears it on app teardown — which for this SPA
// means page death, not navigation). We wrap it at RT.coreReady time and
// forward every event to the app's original handler. If the app ever
// re-assigns onCoreEvent after our wrap, subscriptions go quiet — callers
// must not depend on onState for correctness-critical reconciliation
// (pair it with an initial getState pull).
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var log = RT.logger('core');

    var FIELDS = [
        'ctx', 'board', 'continue_watching_preview', 'discover', 'library',
        'meta_details', 'player', 'search', 'streaming_server', 'auth_link'
    ];

    function assertField(field) {
        if (FIELDS.indexOf(field) === -1) {
            var err = new Error('unknown core field "' + field + '" (valid: ' + FIELDS.join(', ') + ')');
            log.error(err.message);
            throw err;
        }
    }

    function getState(field) {
        assertField(field);
        if (!RT.coreUsable()) return Promise.reject(new Error('core not usable'));
        try {
            // window.core.getState always returns a Promise (Bridge.call) —
            // never consume it synchronously.
            return window.core.getState(field);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    function dispatch(action, field) {
        if (field !== undefined && field !== null) assertField(field);
        if (!RT.coreUsable()) return Promise.reject(new Error('core not usable'));
        try {
            var r = window.core.dispatch(action, field);
            return (r && typeof r.then === 'function') ? r : Promise.resolve(r);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    // ── onState: event-driven pulls ──────────────────────────────────
    var subs = [];   // {field, fn, lastPull, timer}
    var wrapInstalled = false;    function pull(sub) {
        sub.lastPull = Date.now();
        getState(sub.field).then(function(state) {
            if (state == null) return;
            try { sub.fn(state); } catch (e) {
                log.error('onState(' + sub.field + ') subscriber failed:', (e && e.message) || e);
            }
        }).catch(function() { /* core busy/booting — the next event retries */ });
    }

    var RATE_LIMIT_MS = 2000;      // worst-case pull cadence == the old poll
    var DEBOUNCE_MS = 300;

    function schedule(sub, hint) {
        // When the event names a model, skip unrelated subscribers outright;
        // without a hint (unknown args shape) be conservative and pull.
        if (hint && hint !== sub.field) return;
        if (sub.timer) return;   // a pull is already scheduled — coalesce
        var elapsed = Date.now() - sub.lastPull;
        // Events inside the rate-limit window RE-ARM at the window's end —
        // they are never dropped, only delayed to the cadence cap.
        var delay = (elapsed < RATE_LIMIT_MS) ? (RATE_LIMIT_MS - elapsed + 50) : DEBOUNCE_MS;
        sub.timer = setTimeout(function() {
            sub.timer = null;
            pull(sub);
        }, delay);
    }

    function fanout(ev) {
        if (!ev || ev.name !== 'NewState') return;
        var hint = (ev.args && typeof ev.args.model === 'string') ? ev.args.model : null;
        for (var i = 0; i < subs.length; i++) schedule(subs[i], hint);
    }

    function installWrap() {
        if (wrapInstalled) return;
        wrapInstalled = true;
        var orig = window.onCoreEvent;
        window.onCoreEvent = function(ev) {
            try { fanout(ev); } catch (e) {}
            if (typeof orig === 'function') { try { orig(ev); } catch (e) {} }
        };
    }
    RT.coreReady(installWrap);

    function onState(field, fn) {
        assertField(field);
        var sub = { field: field, fn: fn, lastPull: 0, timer: null };
        subs.push(sub);
        return function off() {
            for (var i = 0; i < subs.length; i++) {
                if (subs[i] === sub) { subs.splice(i, 1); break; }
            }
            if (sub.timer) { clearTimeout(sub.timer); sub.timer = null; }
        };
    }

    RT.core = {
        fields: FIELDS.slice(),
        getState: getState,
        dispatch: dispatch,
        onState: onState
    };

    log('core seam ready');
})();
