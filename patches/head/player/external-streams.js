// Honest external-stream handling — the popup-blocked belt (P2.3).
// Since the details.chunk.js edit, pressing an external stream on Vidaa
// goes through upstream's own confirm dialog and openExternal ->
// window.open(url) — the service's website in the TV browser (Netflix,
// Disney+ etc. are usable there). The one silent failure left: some TV
// browsers block popup windows, and upstream's openExternal does not
// check window.open's return value — the user confirms and NOTHING
// happens. This patch wraps window.open once and, when an external
// http(s) open is blocked (falsy return), says so honestly with the
// target domain, instead of leaving a silent dead end.
//
// Deliberately NOT attempted: fabricated Hisense/omi "launchApp"-style
// platform messages. VIDAA firmware does not act on them (the native
// player's three message types are unconfirmed on every tested firmware —
// issues #28/#29), and fire-and-forget sends are exactly the dishonesty
// pattern this layer removed. window.open is the one real, verifiable
// mechanism; its failure mode is detected here.
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var log = RT.logger('external');
    var origOpen = window.open;
    if (typeof origOpen !== 'function') return;

    var lastToastAt = 0;

    window.open = function(url) {
        var result = null;
        try {
            result = origOpen.apply(window, arguments);
        } catch (e) {
            result = null;
        }
        if (result) return result;

        // Blocked/failed — advise honestly, but only for external web URLs
        // (the external-stream flow); throttled like the handoff advice.
        var u = String(url || '');
        if (u.indexOf('http:') !== 0 && u.indexOf('https:') !== 0) return result;
        var now = Date.now();
        if (now - lastToastAt < 6000) return result;
        lastToastAt = now;
        var domain = u;
        try { domain = new URL(u).host; } catch (e) {}
        log.warn('window.open blocked for', domain);
        RT.toast('The TV browser didn\u2019t open ' + domain
            + '. Open that address on another device, or pick a stream that plays here.',
            { at: 'bottom', ms: 6000 });
        return result;
    };

    log('window.open belt installed');
})();
