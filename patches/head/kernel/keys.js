// ═══════════════════════════════════════════════════════════════════════
// vidaaKeys — the ONE remote-key dispatcher.
// ═══════════════════════════════════════════════════════════════════════
// Eleven addEventListener('keydown') calls across nine patches used to
// negotiate ownership of the color keys + Info via comments, load order,
// and one stopImmediatePropagation. This module is the consolidation: a
// single capture-phase listener on document, a name→code key map as the
// single source of truth, and declarative ownership —
//
//   __vidaaKeys.on('red', handler, { route: 'player', priority: 500,
//                                     when: fn, shift: true, suppress: true })
//
//   key   a name ('red', 'green', 'yellow', 'blue', 'info', 'i',
//         'channelUp', 'channelDown', 'back', 'f', 'escape',
//         'bracketLeft', 'bracketRight'), an array of names, '*' (any key),
//         or a combo 'green+red' (final key within opts.window ms of the first).
//   opts.route   'player' | 'nonplayer' — hash-route gate (like RT.poll)
//   opts.shift   only match when Shift is held (audio-delay brackets)
//   opts.when(e) extra live predicate (toggle enabled, panel open, …)
//   opts.priority  higher runs first within the same key (default 0);
//         reserved: 1000 modal close, 900 F-suppress, 800 back-dismiss,
//         500 combos
//   opts.suppress  when the handler fires, preventDefault + stopPropagation
//         and stop lower-priority handlers for this key (the old
//         stopImmediatePropagation contracts). A handler returning false
//         suppresses too.
//
// Patch load order no longer decides who wins a key — priority does.
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var log = RT.logger('keys');

    var CODES = {
        red: 403,
        green: 404,
        yellow: 405,
        blue: 406,
        info: 457,
        i: 73,
        channelUp: 427,
        channelDown: 428,
        back: [8, 461, 10009],
        f: 70,
        escape: 27,
        bracketLeft: 219,
        bracketRight: 221
    };

    var registrations = [];
    var seq = 0;

    function routeOk(opts) {
        if (!opts.route) return true;
        return opts.route === 'player' ? window.__vidaaRuntime.inPlayer() : !window.__vidaaRuntime.inPlayer();
    }

    // A registration matches when one of its names (or '*') is among the
    // event's names, the modifiers/routes/predicates agree, and — for
    // combos — the first key was seen within the combo window.
    function matches(reg, names, e, now) {
        var i;
        if (reg.combo) {
            if (names.indexOf(reg.names[reg.names.length - 1]) === -1) return false;
            var stamp = comboStamps[reg.id];
            if (!stamp || now - stamp > reg.opts.window) return false;
            return true;
        }
        var hit = false;
        if (reg.names.indexOf('*') !== -1) hit = true;
        else for (i = 0; i < names.length; i++) { if (reg.names.indexOf(names[i]) !== -1) { hit = true; break; } }
        if (!hit) return false;
        if (reg.opts.shift && !e.shiftKey) return false;
        return true;
    }

    function gatesOk(reg, e) {
        if (!routeOk(reg.opts)) return false;
        if (reg.opts.when) {
            try { if (!reg.opts.when(e)) return false; } catch (err) { return false; }
        }
        return true;
    }

    // Combo bookkeeping: remember when the FIRST key of each combo fired.
    var comboStamps = {};
    function stampCombos(names, now) {
        for (var i = 0; i < registrations.length; i++) {
            var reg = registrations[i];
            if (!reg.combo) continue;
            if (names.indexOf(reg.names[0]) !== -1) comboStamps[reg.id] = now;
        }
    }

    function dispatch(e) {
        var code = e.keyCode;
        var names = [];
        for (var n in CODES) {
            var c = CODES[n];
            if ((Array.isArray(c) ? c.indexOf(code) !== -1 : c === code)) names.push(n);
        }
        var now = Date.now();
        stampCombos(names, now);

        // Matching registrations, highest priority first; registration
        // order breaks ties (stable, deterministic).
        var firing = [];
        for (var i = 0; i < registrations.length; i++) {
            var reg = registrations[i];
            if (!matches(reg, names, e, now)) continue;
            if (!gatesOk(reg, e)) continue;
            firing.push(reg);
        }
        firing.sort(function (a, b) { return (b.opts.priority || 0) - (a.opts.priority || 0) || a.seq - b.seq; });

        for (var k = 0; k < firing.length; k++) {
            var r = firing[k];
            if (r.combo) { delete comboStamps[r.id]; } // consume the sequence
            var ret;
            try { ret = r.handler(e); } catch (err) { log.error('handler for [' + r.names.join('+') + '] failed:', (err && err.message) || err); }
            if (ret === false || r.opts.suppress) {
                try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
                return; // consumed: lower-priority handlers for this key are skipped
            }
        }
    }

    document.addEventListener('keydown', dispatch, true);

    var nextComboId = 0;
    function on(keySpec, handler, opts) {
        opts = opts || {};
        // 'green+red' (string with +) is a SEQUENCE combo; an array like
        // ['info','red'] is ALTERNATIVES (any one of them).
        var isCombo = typeof keySpec === 'string' && keySpec.indexOf('+') !== -1;
        var names = isCombo
            ? keySpec.split('+')
            : (Array.isArray(keySpec) ? keySpec.slice() : [keySpec]);
        var reg = {
            names: names,
            handler: handler,
            opts: opts,
            seq: ++seq,
            combo: isCombo
        };
        if (reg.combo) {
            if (typeof opts.window !== 'number') opts.window = 1500;
            reg.id = 'combo' + (++nextComboId);
        }
        registrations.push(reg);
        return reg;
    }

    function off(reg) {
        var i = registrations.indexOf(reg);
        if (i !== -1) registrations.splice(i, 1);
    }

    window.__vidaaKeys = { on: on, off: off, codes: CODES };
})();
