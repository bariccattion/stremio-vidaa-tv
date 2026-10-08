// #21 — Subtitle Sync Drift Auto-Correction (split from the former 032 god-module; the settingsStore lives in kernel/settings-store.js)
// Tracks manual subtitle delay adjustments, calculates drift rate,
// and applies progressive correction automatically.
// ═══════════════════════════════════════════════════════════════════════
// #21 — Subtitle Sync Drift Auto-Correction
// Tracks manual subtitle delay adjustments, calculates drift rate,
// and applies progressive correction automatically.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_sub_drift_fix';
    var DRIFT_STORE_KEY = 'stremio_sub_drift_data';
    var log = RT.logger('sub-drift');

    var adjustments = []; // { time: seconds, offset: ms }
    var driftRate = 0; // ms per second
    var correctionInterval = null;
    var lastAppliedCorrection = 0;
    var currentStreamHash = '';

    function isEnabled() {
        return RT.store.getBool(LS_KEY, false);
    }

    function getStreamHash() {
        // Derive a hash from the current player URL
        var hash = window.location.hash || '';
        // Use everything after #/player/ as stream identifier
        return hash.replace('#/player/', '').substring(0, 100);
    }

    function loadStoredDrift(streamHash) {
        try {
            var data = JSON.parse(localStorage.getItem(DRIFT_STORE_KEY) || '{}');
            if (data[streamHash] && typeof data[streamHash].rate === 'number') {
                return data[streamHash].rate;
            }
        } catch(e) {}
        return 0;
    }

    function saveDrift(streamHash, rate) {
        try {
            var data = JSON.parse(localStorage.getItem(DRIFT_STORE_KEY) || '{}');
            data[streamHash] = { rate: rate, ts: Date.now() };
            // Keep only last 50 entries
            var keys = Object.keys(data);
            if (keys.length > 50) {
                var sorted = keys.sort(function(a, b) { return (data[a].ts || 0) - (data[b].ts || 0); });
                for (var i = 0; i < keys.length - 50; i++) {
                    delete data[sorted[i]];
                }
            }
            localStorage.setItem(DRIFT_STORE_KEY, JSON.stringify(data));
        } catch(e) {}
    }

    function showDriftIndicator(ratePerMin) {
        var existing = document.getElementById('drift-indicator');
        if (existing) existing.remove();
        var el = document.createElement('div');
        el.id = 'drift-indicator';
        el.style.cssText = 'position:fixed;bottom:80px;right:20px;background:rgba(0,0,0,0.7);color:#b8a5f8;padding:8px 14px;border-radius:8px;font-family:PlusJakartaSans,sans-serif;font-size:0.8rem;z-index:99999;pointer-events:none;transition:opacity 0.5s;';
        var sign = ratePerMin >= 0 ? '+' : '';
        el.textContent = 'Subtitle drift corrected: ' + sign + ratePerMin.toFixed(1) + 'ms/min';
        document.body.appendChild(el);
        setTimeout(function() { el.style.opacity = '0'; }, 4000);
        setTimeout(function() { try { el.remove(); } catch(e) {} }, 4600);
    }

    function recordAdjustment(videoTime, offsetMs) {
        adjustments.push({ time: videoTime, offset: offsetMs });
        log('Recorded adjustment: time=' + videoTime.toFixed(1) + 's, offset=' + offsetMs + 'ms');

        // Need at least 2 adjustments to calculate drift
        if (adjustments.length >= 2) {
            var a1 = adjustments[adjustments.length - 2];
            var a2 = adjustments[adjustments.length - 1];
            var timeDiff = a2.time - a1.time;

            if (timeDiff > 10) { // At least 10 seconds apart
                driftRate = (a2.offset - a1.offset) / timeDiff; // ms per second
                log('Drift rate calculated:', (driftRate * 60).toFixed(2), 'ms/min');

                // Save for this stream
                if (currentStreamHash) {
                    saveDrift(currentStreamHash, driftRate);
                }

                showDriftIndicator(driftRate * 60);
                startCorrection();
            }
        }
    }

    function startCorrection() {
        if (correctionInterval) clearInterval(correctionInterval);
        if (Math.abs(driftRate) < 0.001) return; // negligible drift

        log('Starting progressive drift correction at', (driftRate * 60).toFixed(2), 'ms/min');

        var lastCorrectionTime = 0;
        correctionInterval = setInterval(function() {
            if (!isEnabled()) {
                clearInterval(correctionInterval);
                correctionInterval = null;
                return;
            }

            var hash = window.location.hash || '';
            if (hash.indexOf('#/player/') !== 0) {
                clearInterval(correctionInterval);
                correctionInterval = null;
                return;
            }

            var video = document.querySelector('video');
            if (!video || video.paused) return;

            var currentTime = video.currentTime;
            if (lastCorrectionTime === 0) {
                lastCorrectionTime = currentTime;
                return;
            }

            var elapsed = currentTime - lastCorrectionTime;
            if (elapsed < 25) return; // correct every ~30 seconds

            var correction = driftRate * elapsed; // ms to correct
            lastCorrectionTime = currentTime;

            if (Math.abs(correction) < 0.5) return; // too small to bother

            // Apply correction via core dispatch
            try {
                if (window.core && window.core.getState) {
                    var state = window.core.getState('player');
                    if (state) {
                        var currentDelay = 0;
                        try {
                            if (state.subtitleDelay !== undefined) currentDelay = state.subtitleDelay;
                            else if (state.subtitlesDelay !== undefined) currentDelay = state.subtitlesDelay;
                        } catch(e) {}

                        var newDelay = currentDelay + Math.round(correction);
                        lastAppliedCorrection += Math.round(correction);

                        window.core.dispatch({
                            action: 'Player',
                            args: {
                                action: 'SetProp',
                                args: {
                                    propName: 'subtitleDelay',
                                    propValue: newDelay
                                }
                            }
                        }, 'player');

                        log('Applied drift correction:', Math.round(correction) + 'ms (total:', lastAppliedCorrection + 'ms)');
                    }
                }
            } catch(e) {
                log('Failed to apply correction:', e.message);
            }
        }, 5000);
    }

    function cleanup() {
        if (correctionInterval) { clearInterval(correctionInterval); correctionInterval = null; }
        adjustments = [];
        driftRate = 0;
        lastAppliedCorrection = 0;
        currentStreamHash = '';
    }

    // Intercept subtitle delay changes from core dispatches
    // Override core.dispatch to detect SetProp for subtitleDelay
    var origDispatch = null;
    function hookDispatch() {
        if (!window.core || !window.core.dispatch || origDispatch) return;
        origDispatch = window.core.dispatch;

        window.core.dispatch = function() {
            var args = arguments;
            // Call original first
            var result = origDispatch.apply(this, args);

            // Check if this is a subtitle delay change
            try {
                if (isEnabled() && args[0] && args[0].action === 'Player' &&
                    args[0].args && args[0].args.action === 'SetProp' &&
                    args[0].args.args && args[0].args.args.propName === 'subtitleDelay') {
                    var newDelay = args[0].args.args.propValue;
                    var video = document.querySelector('video');
                    if (video && video.currentTime > 0) {
                        // Only record if this wasn't our own correction
                        var isOurCorrection = Math.abs(lastAppliedCorrection) > 0 &&
                            Math.abs(newDelay - lastAppliedCorrection) < 50;
                        if (!isOurCorrection) {
                            recordAdjustment(video.currentTime, newDelay);
                        }
                    }
                }
            } catch(e) {}

            return result;
        };
        log('Hooked core.dispatch for subtitle delay interception');
    }

    // Watch for player route changes
    var wasInPlayer = false;
    setInterval(function() {
        var hash = window.location.hash || '';
        var inPlayer = hash.indexOf('#/player/') === 0;

        if (wasInPlayer && !inPlayer) {
            log('Left player — cleaning up drift tracker');
            cleanup();
        }

        if (inPlayer && isEnabled()) {
            hookDispatch();

            // Load stored drift for this stream
            var sh = getStreamHash();
            if (sh !== currentStreamHash) {
                currentStreamHash = sh;
                var storedRate = loadStoredDrift(sh);
                if (storedRate !== 0) {
                    driftRate = storedRate;
                    log('Loaded stored drift rate:', (driftRate * 60).toFixed(2), 'ms/min');
                    showDriftIndicator(driftRate * 60);
                    startCorrection();
                }
            }
        }

        wasInPlayer = inPlayer;
    }, 1500);

    // Register settings toggle
    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'sub-drift-toggle',
            lsKey: LS_KEY,
            defaultValue: false,
            title: 'Subtitle Drift Fix',
            description: 'Learns and compensates for subtitle timing drift',
            onToggle: function(nowEnabled) {
                log('Subtitle drift fix toggled:', nowEnabled ? 'ON' : 'OFF');
                if (!nowEnabled) cleanup();
            }
        });
    }

    log('Subtitle drift patch loaded (enabled:', isEnabled(), ')');
})();
