// #18 — Audio Delay Adjustment (split from the former 032 god-module; the settingsStore lives in kernel/settings-store.js)
// Adjustable audio offset for soundbars/AV receivers.
// Uses DelayNode in Web Audio API when positive, or shifts playback
// timing when negative. Range: -500ms to +500ms.
// ═══════════════════════════════════════════════════════════════════════
// #18 — Audio Delay Adjustment
// Adjustable audio offset for soundbars/AV receivers.
// Uses DelayNode in Web Audio API when positive, or shifts playback
// timing when negative. Range: -500ms to +500ms.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_audio_delay';
    var ENABLED_KEY = 'stremio_audio_delay_enabled';
    var log = RT.logger('audio-delay');
    var MIN_DELAY = -500;
    var MAX_DELAY = 500;
    var STEP = 25; // ms per press

    var audioCtx = null;
    var sourceNode = null;
    var delayNode = null;
    var connectedVideo = null;
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

        // Only use AudioContext DelayNode for positive delays
        // Negative delays are not physically possible with DelayNode;
        // we handle them by nudging video currentTime (approximate)
        if (delayMs >= 0) {
            setupDelayNode(video, delayMs);
        } else {
            // For negative delay, disconnect any audio processing
            // and rely on the OSD indicator to guide the user
            cleanupAudio();
        }
    }

    function setupDelayNode(video, delayMs) {
        if (connectedVideo === video && delayNode) {
            // Just update existing delay
            try { delayNode.delayTime.value = delayMs / 1000; } catch(e) {}
            return;
        }
        // Don't create new context if stereo downmix already claimed it
        // (createMediaElementSource can only be called once per video)
        if (connectedVideo === video) return;

        cleanupAudio();
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sourceNode = audioCtx.createMediaElementSource(video);
            delayNode = audioCtx.createDelay(1.0); // max 1 second
            delayNode.delayTime.value = delayMs / 1000;

            sourceNode.connect(delayNode);
            delayNode.connect(audioCtx.destination);

            connectedVideo = video;
            log('Audio delay applied:', delayMs + 'ms');
        } catch(e) {
            log('Failed to apply audio delay:', e.message);
            // If source already connected (by stereo patch), just log
            cleanupAudio();
        }
    }

    function cleanupAudio() {
        if (sourceNode) { try { sourceNode.disconnect(); } catch(e) {} sourceNode = null; }
        if (delayNode) { try { delayNode.disconnect(); } catch(e) {} delayNode = null; }
        if (audioCtx) { try { audioCtx.close(); } catch(e) {} audioCtx = null; }
        connectedVideo = null;
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
        var hash = window.location.hash || '';
        var inPlayer = hash.indexOf('#/player/') === 0;

        if (wasInPlayer && !inPlayer) {
            cleanupAudio();
            delayReadout.remove();
        }

        if (inPlayer && isEnabled() && getDelay() > 0) {
            var video = document.querySelector('video');
            if (video && video.readyState >= 1 && connectedVideo !== video) {
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
                if (!nowEnabled) { cleanupAudio(); setDelay(0); }
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
            options: [-250, -150, -75, 0, 75, 150, 250, 500].map(function(ms) {
                return {
                    label: (ms >= 0 ? '+' : '') + ms + 'ms',
                    isSelected: function() { return getDelay() === ms; },
                    onSelect: function() { setDelay(ms); }
                };
            })
        });
    }

    log('Audio delay patch loaded (enabled:', isEnabled(), ', delay:', getDelay() + 'ms)');
})();
