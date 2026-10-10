// ═══════════════════════════════════════════════════════════════════════
// RT.stall — the ONE playback-stall detector and coordinator (P1.2).
// ═══════════════════════════════════════════════════════════════════════
// Three patches used to watch overlapping stall signals with no shared
// state: video-prep's early-stall (2+ waiting events in the first 20 s),
// auto-rebuffer (frozen currentTime ≥8 s, default ON), and dv-hdr's
// stuck-at-start overlay. One stuck stream produced the guidance card +
// automatic seeks underneath it + a stacked recovery toast, while the
// rebuffer seeks re-fed video-prep's waiting counter — and the seek moved
// currentTime off 0, silently disarming dv-hdr's detector.
//
// This module owns detection; the responders register strategies:
//
//   RT.stall.register({
//       id: 'auto-rebuffer', phase: 'recover' | 'inform',
//       priority: 300,            // higher runs first within a phase
//       type: 'early'|'start'|'frozen'|'*',   // start = frozen at t≈0
//       when: function() {},      // live gate (toggle, route, …)
//       act: function(video, episode) { return true; }  // true = claimed
//   })
//
// Episode lifecycle (one actor at a time, escalation instead of pile-up):
//   1. A stall qualifies (see thresholds below) → the 'recover' phase
//      fires: strategies in priority order until one returns true.
//   2. If a recoverer claimed, it is RE-INVOKED every 8 s while the stall
//      persists (ladder-style recovery, episode.invocation counts up);
//      after 15 s without progress the 'inform' phase fires ONCE on top
//      (guidance card / overlay) — recovery keeps running underneath.
//   3. If NO recoverer claimed, 'inform' fires immediately.
//   4. Progress (currentTime advanced), a new video element, or leaving
//      the player closes the episode; the next stall starts fresh.
//
// After any act(), waiting/stalled events are ignored for 5 s — recovery
// actions (seeks, handoffs) emit them as side effects, which is what fed
// the old cross-detector feedback loop.
//
// Test seam: RT.stall.simulateTick(videoLike) runs one detection tick
// against a synthetic element (same code path as the live poll).
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var log = RT.logger('stall');

    var TICK = 2000;              // ms — detection cadence
    var FROZEN_MS = 8000;         // ms without progress = stall
    var EARLY_WINDOW_MS = 20000;  // only count waiting events this early
    var EARLY_EVENTS = 2;         // waiting/stalled events in the window
    var RE_INVOKE_MS = 8000;      // re-invoke the claimed recoverer
    var INFORM_AFTER_MS = 15000;  // inform on top of a claimed recovery
    var EVENT_COOLDOWN_MS = 5000; // absorb recovery-induced waiting events

    var strategies = [];
    var video = null;
    var S = null;                 // per-video detector state
    var episodeSeq = 0;

    function freshVideoState() {
        return {
            lastTime: null,
            frozenMs: 0,
            firstPlayingAt: 0,
            earlyEvents: 0,
            cooldownUntil: 0,
            episode: null
        };
    }

    function byId(id) {
        for (var i = 0; i < strategies.length; i++) {
            if (strategies[i].id === id) return strategies[i];
        }
        return null;
    }

    function closeEpisode(reason) {
        if (S && S.episode) {
            log('stall episode closed (' + reason + ') after', S.episode.invocation, 'invocation(s)');
            S.episode = null;
        }
    }

    function fire(phase, ep) {
        var firing = [];
        for (var i = 0; i < strategies.length; i++) {
            var st = strategies[i];
            if (st.phase !== phase) continue;
            if (st.type !== '*' && st.type !== ep.type) continue;
            if (st.when) {
                try { if (!st.when()) continue; } catch (e) { continue; }
            }
            firing.push(st);
        }
        firing.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });

        for (var j = 0; j < firing.length; j++) {
            var claimed = false;
            try {
                claimed = firing[j].act(video, ep) === true;
            } catch (e) {
                log.error('strategy "' + firing[j].id + '" threw:', (e && e.message) || e);
            }
            if (claimed) {
                // Only the RECOVER claim drives re-invocation — an inform
                // claim must not overwrite it (the recoverer keeps running
                // underneath the guidance UI).
                if (phase === 'recover') ep.claimedBy = firing[j].id;
                log('phase "' + phase + '" claimed by "' + firing[j].id + '"');
                break;
            }
        }
        // Recovery actions emit waiting/stalled events as side effects.
        S.cooldownUntil = Date.now() + EVENT_COOLDOWN_MS;
    }

    function tick() {
        // The live poll resolves the video element itself; the test seam
        // injects a synthetic one.
        var v = (arguments.length > 0) ? arguments[0] : document.querySelector('video');
        if (!v) { video = null; S = null; return; }

        if (v !== video) {
            video = v;
            S = freshVideoState();
            attach(v);
            log('watching new video element');
        }

        var now = Date.now();
        var cur = v.currentTime;

        // Progress closes the episode and resets frozen accounting.
        if (S.lastTime !== null && cur > S.lastTime + 0.25) {
            if (S.episode) closeEpisode('progress');
            S.frozenMs = 0;
        }

        var playing = !v.paused && !v.ended && v.readyState >= 2;
        if (playing && S.lastTime !== null && Math.abs(cur - S.lastTime) <= 0.25) {
            S.frozenMs += TICK;
        } else if (!playing) {
            S.frozenMs = 0;
        }
        S.lastTime = cur;
        if (!playing) return;

        var ep = S.episode;

        if (ep && ep.claimedBy) {
            // Re-invoke the claimed recoverer while the stall persists.
            if (now - ep.lastFire >= RE_INVOKE_MS) {
                var st = byId(ep.claimedBy);
                ep.lastFire = now;
                ep.invocation++;
                if (st) {
                    try { st.act(video, ep); } catch (e) {
                        log.error('recoverer "' + st.id + '" re-invoke threw:', (e && e.message) || e);
                    }
                }
                S.cooldownUntil = now + EVENT_COOLDOWN_MS;
            }
            // Escalation: recovery has had its window — inform once on top.
            if (!ep.informed && now - ep.openedAt >= INFORM_AFTER_MS) {
                ep.informed = true;
                log('stall persists past recovery window — informing');
                fire('inform', ep);
            }
            return;
        }

        if (ep) return; // inform-only episode already fired

        // New episode?
        var type = null;
        if (S.frozenMs >= FROZEN_MS) {
            type = (cur < 0.3) ? 'start' : 'frozen';
        } else if (S.earlyEvents >= EARLY_EVENTS && S.firstPlayingAt &&
                   now - S.firstPlayingAt <= EARLY_WINDOW_MS) {
            type = 'early';
        }
        if (!type) return;

        ep = S.episode = {
            id: ++episodeSeq,
            type: type,
            openedAt: now,
            lastFire: now,
            invocation: 1,
            informed: false,
            claimedBy: null
        };
        log('stall detected:', type);
        fire('recover', ep);
        if (!ep.claimedBy) {
            ep.informed = true;
            fire('inform', ep);
        }
    }

    function attach(v) {
        try {
            v.addEventListener('playing', function() {
                if (S && !S.firstPlayingAt) S.firstPlayingAt = Date.now();
            });
            var onWait = function() {
                if (!S) return;
                if (Date.now() < S.cooldownUntil) return; // recovery side-effect
                if (S.firstPlayingAt && Date.now() - S.firstPlayingAt > EARLY_WINDOW_MS) return;
                S.earlyEvents++;
            };
            v.addEventListener('waiting', onWait);
            v.addEventListener('stalled', onWait);
        } catch (e) { /* synthetic elements in tests may be partial */ }
    }

    // Stall recovery is playback-critical: route-gated, never silenced by
    // Quiet Player Mode (same contract auto-rebuffer used to carry alone).
    RT.poll(tick, TICK, { route: 'player', quiet: false });

    RT.stall = {
        register: function(cfg) { strategies.push(cfg); return cfg; },
        off: function(cfg) {
            for (var i = 0; i < strategies.length; i++) {
                if (strategies[i] === cfg) { strategies.splice(i, 1); break; }
            }
        },
        info: function() { return S ? S.episode : null; },
        simulateTick: tick,   // test seam: run one tick against a synthetic element
        // Test seam: override detection thresholds (same code paths; the
        // production poll keeps its own cadence). Tests tune so episodes
        // open/inform without real-time waits.
        tune: function(o) {
            if (!o) return;
            if (typeof o.frozenMs === 'number') FROZEN_MS = o.frozenMs;
            if (typeof o.reInvokeMs === 'number') RE_INVOKE_MS = o.reInvokeMs;
            if (typeof o.informAfterMs === 'number') INFORM_AFTER_MS = o.informAfterMs;
            if (typeof o.eventCooldownMs === 'number') EVENT_COOLDOWN_MS = o.eventCooldownMs;
        }
    };

    log('stall coordinator ready');
})();
