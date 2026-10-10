// #18 — Audio Delay Adjustment (split from the former 032 god-module; the settingsStore lives in kernel/settings-store.js)
// Adjustable audio offset for soundbars/AV receivers: a DelayNode in the
// shared Web Audio graph shifts audio LATER (0…+500ms). Negative offsets
// are physically impossible with DelayNode and the old "nudge currentTime"
// fallback never worked — the range is now honest, 0 to +500ms (P0.9/P0.13
// honesty pass: no placebo options).
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_audio_delay';
    var ENABLED_KEY = 'stremio_audio_delay_enabled';
    var log = RT.logger('audio-delay');
    var MIN_DELAY = 0;
    var MAX_DELAY = 500;
    var STEP = 25; // ms per press

    var delayNode = null;   // our node inside the shared audio graph
    var delayReadout = window.__vidaaUI.transient('audio-delay-overlay',
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:#fff;padding:16px 32px;border-radius:10px;font-family:PlusJakartaSans,sans-serif;font-size:1.3rem;font-weight:700;z-index:99999;pointer-events:none;transition:opacity 0.4s;text-align:center;',
        1500, 'opacity 0.4s');

    function isEnabled() {
        return RT.store.getBool(ENABLED_KEY, false);
    }

    function getDelay() {
        var v = parseInt(RT.store.get(LS_KEY, null), 10);
        return isNaN(v) ? 0 : Math.max(MIN_DELAY, Math.min(MAX_DELAY, v));
    }

    function setDelay(ms) {
        ms = Math.max(MIN_DELAY, Math.min(MAX_DELAY, ms));
        RT.store.set(LS_KEY, String(ms));
        return ms;
    }

    function applyDelay(video) {
        if (!video || !isEnabled()) return;
        var delayMs = getDelay();
        // DelayNode can only delay audio (0…+500ms). Anything else stored
        // from the old negative-support era is clamped by getDelay().
        if (delayMs > 0) {
            setupDelayNode(video, delayMs);
        } else {
            cleanupAudio();
        }
    }

    function setupDelayNode(video, delayMs) {
        var G = window.__vidaaAudioGraph;
        // Fast path: same video, live chain — just move the delay time.
        // A different bound video means the engine swapped the <video>;
        // ensure() tears the stale graph down and we re-attach (P0.9).
        if (delayNode && G.hasChain('delay') && G.boundVideo() === video) {
            try { delayNode.delayTime.value = delayMs / 1000; } catch(e) {}
            return;
        }
        if (!G.ensure(video)) {
            log('Failed to apply audio delay: audio graph unavailable');
            return;
        }
        var ok = G.attach('delay', function(ctx) {
            var d = ctx.createDelay(1.0); // max 1 second
            d.delayTime.value = delayMs / 1000;
            delayNode = d;
            return { in: d, out: d };
        });
        if (ok) {
            log('Audio delay applied:', delayMs + 'ms');
        } else {
            delayNode = null;
        }
    }

    function cleanupAudio() {
        // Detach only OUR chain — force-stereo may still be live.
        window.__vidaaAudioGraph.detach('delay');
        delayNode = null;
    }

    function showOverlay(delayMs) {
        var sign = delayMs >= 0 ? '+' : '';
        delayReadout.show('Audio Delay: ' + sign + delayMs + 'ms');
    }

    // Key handlers: Shift+[ to decrease, Shift+] to increase audio delay.
    // Suppressed (preventDefault + stopPropagation) exactly as before, so
    // the brackets never scroll the page or reach the app.
    window.__vidaaKeys.on(['bracketLeft', 'bracketRight'], function(e) {
        var current = getDelay();
        var newDelay = (e.keyCode === 219) ? setDelay(current - STEP) : setDelay(current + STEP);
        log('Audio delay adjusted to', newDelay + 'ms');
        showOverlay(newDelay);
        var video = document.querySelector('video');
        if (video) applyDelay(video);
    }, {
        route: 'player',
        shift: true,
        suppress: true,
        when: function(e) {
            if (!isEnabled()) return false;
            var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
            return tag !== 'input' && tag !== 'textarea';
        }
    });

    // Watch for player
    var wasInPlayer = false;
    RT.poll(function() {
        var inPlayer = RT.inPlayer();

        if (wasInPlayer && !inPlayer) {
            window.__vidaaAudioGraph.teardown();
            delayNode = null;
            delayReadout.remove();
        }

        if (inPlayer && isEnabled() && getDelay() > 0) {
            var video = (RT.dom && RT.dom.currentVideo)
                ? RT.dom.currentVideo()
                : document.querySelector('video');
            // Re-apply on engine video swaps too, not just missing chains (P0.9).
            if (video && video.readyState >= 1
                && (window.__vidaaAudioGraph.boundVideo() !== video || !window.__vidaaAudioGraph.hasChain('delay'))) {
                applyDelay(video);
            }
        }

        wasInPlayer = inPlayer;
    }, 1500, { quiet: true });

    // Register settings: the enable toggle + the offset choice row (the
    // settings UI in 032g renders both from the settingsStore registry).
    if (window.__registerVidaaSettingsItem) {
        window.__registerVidaaSettingsItem({
            id: 'audio-delay-toggle',
            type: 'toggle',
            label: 'Audio Delay',
            description: 'Shift+[ / Shift+] to adjust audio sync in player',
            lsKey: ENABLED_KEY,
            defaultValue: false,
            onToggle: function(nowEnabled) {
                log('Audio delay toggled:', nowEnabled ? 'ON' : 'OFF');
                // Detach the chain but KEEP the stored offset — turning the
                // feature off must not erase the user's saved value (P0.9).
                if (!nowEnabled) cleanupAudio();
            }
        });
        window.__registerVidaaSettingsItem({
            id: 'audio-delay-offset',
            type: 'choice',
            label: 'Audio Offset',
            lsKey: LS_KEY,
            getLabel: function() {
                var d = getDelay();
                return 'Audio Offset: ' + (d >= 0 ? '+' : '') + d + 'ms';
            },
            isDisabled: function() { return !isEnabled(); },
            options: [0, 75, 150, 250, 500].map(function(ms) {
                return {
                    label: '+' + ms + 'ms',
                    isSelected: function() { return getDelay() === ms; },
                    // Apply live: settings changes update the playing node
                    // immediately, not just on the next hotkey press (P0.9).
                    onSelect: function() {
                        setDelay(ms);
                        var v = document.querySelector('video');
                        if (v) applyDelay(v);
                    }
                };
            })
        });
    }

    log('Audio delay patch loaded (enabled:', isEnabled(), ', delay:', getDelay() + 'ms)');
})();
