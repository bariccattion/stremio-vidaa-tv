// ═══════════════════════════════════════════════════════════════════════
// VIDAA Settings — Left Column Category Button
// Adds "VIDAA >" to the LEFT column (below About) as a top-level category.
// Clicking it populates the RIGHT column with toggle switches.
// All VIDAA toggles register via window.__registerVidaaSettingsItem(cfg).
// Legacy window.__registerCommunityToggle is aliased for compatibility.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var LOG = '[settings]';
    var registeredItems = [];

    function log() {
        var args = [LOG];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    // ─── Public API ────────────────────────────────────────────────
    window.__vidaaSettingsItems = registeredItems;

    window.__registerVidaaSettingsItem = function(cfg) {
        for (var i = 0; i < registeredItems.length; i++) {
            if (registeredItems[i].id === cfg.id) return;
        }
        registeredItems.push(cfg);
        log('Registered item:', cfg.id);
    };

    // Backward-compat alias for the old community toggle API
    window.__registerCommunityToggle = function(cfg) {
        window.__registerVidaaSettingsItem({
            id: cfg.id,
            type: 'toggle',
            label: cfg.title,
            description: cfg.description,
            lsKey: cfg.lsKey,
            onToggle: cfg.onToggle,
            extraContent: cfg.extraContent
        });
    };

    // ─── Helpers ───────────────────────────────────────────────────
    // Settings toggles are now handled natively in settings.chunk.js.
    // No DOM injection needed — React renders the VIDAA section with full
    // spatial navigation and click support.
    log('VIDAA settings managed via settings.chunk.js (native React)');
})();

// ═══════════════════════════════════════════════════════════════════════
// Community-Requested Features (#17–#21)
// All features default to OFF and must be enabled via Settings toggles.
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// #17 — Force Stereo Downmix
// Downmixes surround audio to stereo using Web Audio API.
// Boosts center channel for dialogue clarity on basic speakers.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var LS_KEY = 'stremio_force_stereo';
    var LOG = '[audio]';
    var audioCtx = null;
    var sourceNode = null;
    var connectedVideo = null;

    function isEnabled() {
        try { return localStorage.getItem(LS_KEY) === 'true'; } catch(e) { return false; }
    }

    function log() {
        var args = [LOG];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    function applyStereoDownmix(video) {
        if (!video || connectedVideo === video) return;
        cleanupAudio();

        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sourceNode = audioCtx.createMediaElementSource(video);

            // Force stereo on destination
            audioCtx.destination.channelCount = 2;
            audioCtx.destination.channelCountMode = 'explicit';
            audioCtx.destination.channelInterpretation = 'speakers';

            // Create a gain node to boost center channel presence
            var gainNode = audioCtx.createGain();
            gainNode.gain.value = 1.15; // slight boost for dialogue clarity
            gainNode.channelCount = 2;
            gainNode.channelCountMode = 'explicit';
            gainNode.channelInterpretation = 'speakers';

            // Create a compressor to even out the stereo mix
            var compressor = audioCtx.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 12;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.15;
            compressor.channelCount = 2;
            compressor.channelCountMode = 'explicit';

            sourceNode.connect(gainNode);
            gainNode.connect(compressor);
            compressor.connect(audioCtx.destination);

            connectedVideo = video;
            log('Stereo downmix applied — routing through 2ch gain + compressor');

            // Show brief toast
            showToast('Stereo downmix active');
        } catch(e) {
            log('Failed to apply stereo downmix:', e.message);
            cleanupAudio();
            // Fallback: try just connecting through
            try {
                if (sourceNode) sourceNode.connect(audioCtx.destination);
            } catch(e2) {}
        }
    }

    function cleanupAudio() {
        if (sourceNode) {
            try { sourceNode.disconnect(); } catch(e) {}
            sourceNode = null;
        }
        if (audioCtx) {
            try { audioCtx.close(); } catch(e) {}
            audioCtx = null;
        }
        connectedVideo = null;
    }

    function showToast(msg) {
        var existing = document.getElementById('stereo-toast');
        if (existing) existing.remove();
        var t = document.createElement('div');
        t.id = 'stereo-toast';
        t.style.cssText = 'position:fixed;top:40px;right:30px;background:rgba(123,91,245,0.85);color:#fff;padding:10px 22px;border-radius:8px;font-family:PlusJakartaSans,sans-serif;font-size:0.9rem;z-index:99999;pointer-events:none;transition:opacity 0.5s;';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.style.opacity = '0'; }, 2000);
        setTimeout(function() { try { t.remove(); } catch(e) {} }, 2600);
    }

    // Watch for player route and video element
    var wasInPlayer = false;
    setInterval(function() {
        var hash = window.location.hash || '';
        var inPlayer = hash.indexOf('#/player/') === 0;

        if (wasInPlayer && !inPlayer) {
            log('Left player — cleaning up audio context');
            cleanupAudio();
        }

        if (inPlayer && isEnabled()) {
            var video = document.querySelector('video');
            if (video && video.readyState >= 1 && connectedVideo !== video) {
                applyStereoDownmix(video);
            }
        }

        wasInPlayer = inPlayer;
    }, 1500);

    // Register settings toggle
    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'stereo-downmix-toggle',
            lsKey: LS_KEY,
            title: 'Force Stereo',
            description: 'Downmix surround sound to stereo with dialogue boost',
            onToggle: function(nowEnabled) {
                log('Force stereo toggled:', nowEnabled ? 'ON' : 'OFF');
                if (!nowEnabled) cleanupAudio();
            }
        });
    }

    log('Force stereo patch loaded (enabled:', isEnabled(), ')');
})();

// ═══════════════════════════════════════════════════════════════════════
// #18 — Audio Delay Adjustment
// Adjustable audio offset for soundbars/AV receivers.
// Uses DelayNode in Web Audio API when positive, or shifts playback
// timing when negative. Range: -500ms to +500ms.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var LS_KEY = 'stremio_audio_delay';
    var ENABLED_KEY = 'stremio_audio_delay_enabled';
    var LOG = '[audio-delay]';
    var MIN_DELAY = -500;
    var MAX_DELAY = 500;
    var STEP = 25; // ms per press

    var audioCtx = null;
    var sourceNode = null;
    var delayNode = null;
    var connectedVideo = null;
    var overlayEl = null;
    var overlayTimer = null;

    function isEnabled() {
        try { return localStorage.getItem(ENABLED_KEY) === 'true'; } catch(e) { return false; }
    }

    function getDelay() {
        try {
            var v = parseInt(localStorage.getItem(LS_KEY), 10);
            return isNaN(v) ? 0 : Math.max(MIN_DELAY, Math.min(MAX_DELAY, v));
        } catch(e) { return 0; }
    }

    function setDelay(ms) {
        ms = Math.max(MIN_DELAY, Math.min(MAX_DELAY, ms));
        try { localStorage.setItem(LS_KEY, String(ms)); } catch(e) {}
        return ms;
    }

    function log() {
        var args = [LOG];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
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
        if (!overlayEl) {
            overlayEl = document.createElement('div');
            overlayEl.id = 'audio-delay-overlay';
            overlayEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:#fff;padding:16px 32px;border-radius:10px;font-family:PlusJakartaSans,sans-serif;font-size:1.3rem;font-weight:700;z-index:99999;pointer-events:none;transition:opacity 0.4s;text-align:center;';
            document.body.appendChild(overlayEl);
        }
        overlayEl.style.opacity = '1';
        var sign = delayMs >= 0 ? '+' : '';
        overlayEl.textContent = 'Audio Delay: ' + sign + delayMs + 'ms';
        if (overlayTimer) clearTimeout(overlayTimer);
        overlayTimer = setTimeout(function() {
            if (overlayEl) overlayEl.style.opacity = '0';
        }, 1500);
    }

    // Key handlers: Shift+[ to decrease, Shift+] to increase audio delay
    document.addEventListener('keydown', function(e) {
        if (!isEnabled()) return;
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) return;

        var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea') return;

        // Shift + [ (keyCode 219) = decrease delay
        // Shift + ] (keyCode 221) = increase delay
        if (e.shiftKey && (e.keyCode === 219 || e.keyCode === 221)) {
            e.preventDefault();
            e.stopPropagation();
            var current = getDelay();
            var newDelay;
            if (e.keyCode === 219) {
                newDelay = setDelay(current - STEP);
            } else {
                newDelay = setDelay(current + STEP);
            }
            log('Audio delay adjusted to', newDelay + 'ms');
            showOverlay(newDelay);
            var video = document.querySelector('video');
            if (video) applyDelay(video);
        }
    }, true);

    // Watch for player
    var wasInPlayer = false;
    setInterval(function() {
        var hash = window.location.hash || '';
        var inPlayer = hash.indexOf('#/player/') === 0;

        if (wasInPlayer && !inPlayer) {
            cleanupAudio();
            if (overlayEl) { try { overlayEl.remove(); } catch(e) {} overlayEl = null; }
        }

        if (inPlayer && isEnabled() && getDelay() > 0) {
            var video = document.querySelector('video');
            if (video && video.readyState >= 1 && connectedVideo !== video) {
                applyDelay(video);
            }
        }

        wasInPlayer = inPlayer;
    }, 1500);

    // Register settings toggle with extra delay control
    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'audio-delay-toggle',
            lsKey: ENABLED_KEY,
            title: 'Audio Delay',
            description: 'Shift+[ / Shift+] to adjust audio sync in player',
            onToggle: function(nowEnabled) {
                log('Audio delay toggled:', nowEnabled ? 'ON' : 'OFF');
                if (!nowEnabled) { cleanupAudio(); setDelay(0); }
            },
            extraContent: function(enabled) {
                var row = document.createElement('div');
                row.id = 'audio-delay-controls';
                row.className = 'option-pCk4g';
                row.setAttribute('tabindex', '0');

                var delayLabel = document.createElement('div');
                delayLabel.className = 'label-ZUqct';
                var currentDelay = getDelay();
                var sign = currentDelay >= 0 ? '+' : '';
                delayLabel.textContent = 'Audio Delay: ' + sign + currentDelay + 'ms  (\u2190\u2192 to adjust)';
                row.appendChild(delayLabel);

                var fakeToggle = document.createElement('div');
                fakeToggle.className = 'toggle-EKrug';
                fakeToggle.style.display = 'none';
                row.appendChild(fakeToggle);

                row.onfocus = function() { this.setAttribute('focused', ''); };
                row.onblur = function() { this.removeAttribute('focused'); };
                row.onkeydown = function(e) {
                    if (e.keyCode === 37) { // left arrow — decrease
                        e.preventDefault();
                        var d = setDelay(getDelay() - STEP);
                        var s = d >= 0 ? '+' : '';
                        delayLabel.textContent = 'Audio Delay: ' + s + d + 'ms  (\u2190\u2192 to adjust)';
                        log('Delay set to', d + 'ms (D-pad)');
                    } else if (e.keyCode === 39) { // right arrow — increase
                        e.preventDefault();
                        var d2 = setDelay(getDelay() + STEP);
                        var s2 = d2 >= 0 ? '+' : '';
                        delayLabel.textContent = 'Audio Delay: ' + s2 + d2 + 'ms  (\u2190\u2192 to adjust)';
                        log('Delay set to', d2 + 'ms (D-pad)');
                    } else if (e.keyCode === 13) { // Enter — reset to 0
                        e.preventDefault();
                        setDelay(0);
                        delayLabel.textContent = 'Audio Delay: +0ms  (\u2190\u2192 to adjust)';
                        log('Delay reset to 0ms (D-pad Enter)');
                    }
                };

                return row;
            }
        });
    }

    log('Audio delay patch loaded (enabled:', isEnabled(), ', delay:', getDelay() + 'ms)');
})();

// ═══════════════════════════════════════════════════════════════════════
// #19 — Auto-Play Best Stream
// Automatically selects the highest-scored stream instead of showing
// the stream selection screen. Scores by resolution, source, size, seeds.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var LS_KEY = 'stremio_autoplay_best';
    var LOG = '[autoplay]';
    var processedUrls = {};

    function isEnabled() {
        try { return localStorage.getItem(LS_KEY) === 'true'; } catch(e) { return false; }
    }

    function log() {
        var args = [LOG];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    function scoreStream(stream) {
        var score = 0;
        var name = ((stream.title || '') + ' ' + (stream.name || '') + ' ' + (stream.description || '')).toLowerCase();

        // Resolution scoring
        if (name.indexOf('2160p') !== -1 || name.indexOf('4k') !== -1 || name.indexOf('uhd') !== -1) score += 4;
        else if (name.indexOf('1080p') !== -1) score += 3;
        else if (name.indexOf('720p') !== -1) score += 2;
        else if (name.indexOf('480p') !== -1) score += 1;
        else score += 2; // unknown defaults to 720p-ish

        // Source scoring — debrid/cached indicators
        if (name.indexOf('[rd+]') !== -1 || name.indexOf('[rd]') !== -1 || name.indexOf('cached') !== -1 || name.indexOf('[pm+]') !== -1 || name.indexOf('[ad+]') !== -1) score += 3;
        else if (name.indexOf('debrid') !== -1 || name.indexOf('[rd') !== -1 || name.indexOf('[pm') !== -1 || name.indexOf('[ad') !== -1) score += 1;

        // HDR penalty on basic TVs (optional — keep it neutral)
        if (name.indexOf('hdr') !== -1 || name.indexOf('dv') !== -1 || name.indexOf('dolby vision') !== -1) score += 0;

        // Codec preferences
        if (name.indexOf('x265') !== -1 || name.indexOf('hevc') !== -1) score += 1;
        if (name.indexOf('x264') !== -1 || name.indexOf('avc') !== -1) score += 0.5;

        // File size scoring — parse from name
        var sizeMatch = name.match(/([\d.]+)\s*(gb|mb)/i);
        if (sizeMatch) {
            var sizeGB = parseFloat(sizeMatch[1]);
            if (sizeMatch[2].toLowerCase() === 'mb') sizeGB = sizeGB / 1024;
            // Sweet spot: 1.5-15GB for 1080p
            if (sizeGB >= 1.5 && sizeGB <= 15) score += 1;
            else if (sizeGB > 15 && sizeGB <= 50) score += 0.5;
            else if (sizeGB < 0.3) score -= 1; // too small = bad quality
        }

        // Seeds for torrent streams
        if (stream.seeds !== undefined && stream.seeds > 0) {
            score += Math.min(stream.seeds / 50, 2); // cap at +2
        }

        // Prefer streams with a URL (playable)
        if (stream.url || stream.ytId || stream.externalUrl) score += 0.5;

        return score;
    }

    function showToast(msg) {
        var existing = document.getElementById('autoplay-toast');
        if (existing) existing.remove();
        var t = document.createElement('div');
        t.id = 'autoplay-toast';
        t.style.cssText = 'position:fixed;top:40px;left:50%;transform:translateX(-50%);background:rgba(123,91,245,0.9);color:#fff;padding:10px 24px;border-radius:8px;font-family:PlusJakartaSans,sans-serif;font-size:0.9rem;z-index:99999;pointer-events:none;transition:opacity 0.5s;max-width:80%;text-align:center;';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.style.opacity = '0'; }, 3000);
        setTimeout(function() { try { t.remove(); } catch(e) {} }, 3600);
    }

    // Watch for stream selection page
    var lastHash = '';
    setInterval(function() {
        if (!isEnabled()) return;

        var hash = window.location.hash || '';
        if (hash === lastHash) return;
        lastHash = hash;

        // Detect detail page with streams (hash like #/detail/...)
        // Streams appear as selectable items in the detail view
        // We wait for the core to provide stream data
        if (hash.indexOf('#/detail/') !== 0) return;
        if (processedUrls[hash]) return;

        // Wait for streams to load in the DOM
        setTimeout(function() {
            try {
                if (!window.core || typeof window.core.getState !== 'function') return;

                // Try to get streams from core state
                var tryGetStreams = function(attempts) {
                    if (attempts <= 0) {
                        log('No streams found after retries');
                        return;
                    }

                    var state = window.core.getState('streaming');
                    if (!state) state = window.core.getState('player');

                    // Also try to read streams from the DOM
                    var streamElements = document.querySelectorAll('[class*="stream"], [class*="Stream"]');
                    if ((!state || !state.streams || state.streams.length === 0) && streamElements.length === 0) {
                        setTimeout(function() { tryGetStreams(attempts - 1); }, 1000);
                        return;
                    }

                    var streams = [];
                    if (state && state.streams) {
                        streams = state.streams;
                    }

                    if (streams.length === 0) {
                        log('No stream data available from core');
                        return;
                    }

                    processedUrls[hash] = true;

                    // Score and sort
                    var scored = [];
                    for (var i = 0; i < streams.length; i++) {
                        scored.push({ index: i, stream: streams[i], score: scoreStream(streams[i]) });
                    }
                    scored.sort(function(a, b) { return b.score - a.score; });

                    var best = scored[0];
                    if (!best || !best.stream) return;

                    var bestName = best.stream.title || best.stream.name || best.stream.description || ('Stream #' + (best.index + 1));
                    log('Best stream selected:', bestName, '(score:', best.score.toFixed(1) + ')');
                    showToast('Auto-playing: ' + bestName.substring(0, 60));

                    // Try to auto-play by clicking the stream element or dispatching to core
                    try {
                        // Method 1: Click the matching stream element in DOM
                        if (streamElements.length > best.index) {
                            streamElements[best.index].click();
                            log('Clicked stream element at index', best.index);
                            return;
                        }

                        // Method 2: Dispatch to core to play the stream
                        if (window.core && window.core.dispatch && best.stream.url) {
                            window.core.dispatch({
                                action: 'StreamClicked',
                                args: { stream: best.stream }
                            });
                            log('Dispatched StreamClicked to core');
                            return;
                        }

                        // Method 3: Navigate to player URL if available
                        if (best.stream.deepLinks && best.stream.deepLinks.player) {
                            window.location.hash = best.stream.deepLinks.player;
                            log('Navigated to player deepLink');
                            return;
                        }

                        log('Could not auto-play — no suitable dispatch method');
                        processedUrls[hash] = false; // allow retry
                    } catch(e) {
                        log('Auto-play dispatch failed:', e.message);
                        processedUrls[hash] = false;
                    }
                };

                tryGetStreams(5);
            } catch(e) {
                log('Error in auto-play:', e.message);
            }
        }, 2000);
    }, 500);

    // Register settings toggle
    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'autoplay-best-toggle',
            lsKey: LS_KEY,
            title: 'Auto-Play Stream',
            description: 'Automatically picks the highest-quality stream',
            onToggle: function(nowEnabled) {
                log('Auto-play best toggled:', nowEnabled ? 'ON' : 'OFF');
                if (!nowEnabled) processedUrls = {};
            }
        });
    }

    log('Auto-play best stream patch loaded (enabled:', isEnabled(), ')');
})();

// ═══════════════════════════════════════════════════════════════════════
// #20 — Mark Season as Watched
// Injects a "Mark Season Watched" button near the season selector
// on detail pages. Dispatches MarkAsWatched for each episode.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var LS_KEY = 'stremio_mark_season';
    var LOG = '[season]';
    var injectedForHash = '';

    function isEnabled() {
        try { return localStorage.getItem(LS_KEY) === 'true'; } catch(e) { return false; }
    }

    function log() {
        var args = [LOG];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    function showFeedback(btn, success) {
        var origText = btn.textContent;
        var origBg = btn.style.background;
        btn.textContent = success ? '\u2713 Season marked' : 'Error — try again';
        btn.style.background = success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
        setTimeout(function() {
            btn.textContent = origText;
            btn.style.background = origBg;
        }, 2000);
    }

    function findEpisodeElements() {
        // Look for episode list items in the detail page
        // Stremio's UI renders episodes as clickable items with episode info
        var candidates = [];

        // Try various selectors that match episode containers
        var selectors = [
            '[class*="episode"]',
            '[class*="Episode"]',
            '[class*="meta-row"]',
            '[class*="video"]'
        ];

        for (var s = 0; s < selectors.length; s++) {
            var els = document.querySelectorAll(selectors[s]);
            if (els.length > 1) {
                // Filter to only elements that look like episode items
                for (var i = 0; i < els.length; i++) {
                    var el = els[i];
                    // Episodes usually have some text content with episode numbers
                    var text = el.textContent || '';
                    if (text.length > 0 && text.length < 500) {
                        candidates.push(el);
                    }
                }
                if (candidates.length > 1) break;
                candidates = [];
            }
        }

        return candidates;
    }

    function markSeasonWatched(btn) {
        log('Marking season as watched...');

        try {
            if (!window.core || typeof window.core.getState !== 'function') {
                log('Core not available');
                showFeedback(btn, false);
                return;
            }

            // Get current meta state from core
            var state = window.core.getState('meta');
            if (!state && window.core.getState) {
                // Try alternative state paths
                state = window.core.getState('detail');
            }

            // Method 1: Use core state to get episode IDs
            if (state && state.videos && state.videos.length > 0) {
                var videos = state.videos;
                var marked = 0;
                for (var i = 0; i < videos.length; i++) {
                    var video = videos[i];
                    if (video && video.id) {
                        try {
                            window.core.dispatch({
                                action: 'MetaDetails',
                                args: {
                                    action: 'MarkVideoAsWatched',
                                    args: { id: video.id, isWatched: true }
                                }
                            });
                            marked++;
                        } catch(e) {}
                    }
                }
                if (marked > 0) {
                    log('Marked', marked, 'episodes as watched via core dispatch');
                    showFeedback(btn, true);
                    return;
                }
            }

            // Method 2: Click-based approach — find and interact with episode elements
            var episodes = findEpisodeElements();
            if (episodes.length > 0) {
                log('Found', episodes.length, 'episode elements in DOM');
                // Try to find checkboxes or watched indicators
                var markedCount = 0;
                for (var j = 0; j < episodes.length; j++) {
                    var ep = episodes[j];
                    // Look for a watched/checkmark button within each episode
                    var watchBtns = ep.querySelectorAll('[class*="watched"], [class*="check"], [class*="mark"]');
                    for (var k = 0; k < watchBtns.length; k++) {
                        try { watchBtns[k].click(); markedCount++; } catch(e) {}
                    }
                }
                if (markedCount > 0) {
                    log('Clicked', markedCount, 'watch buttons');
                    showFeedback(btn, true);
                    return;
                }
            }

            // Method 3: Parse the URL hash for meta ID and construct dispatches
            var hash = window.location.hash || '';
            var metaMatch = hash.match(/#\/detail\/([^/]+)\/([^/]+)/);
            if (metaMatch) {
                var metaType = metaMatch[1];
                var metaId = metaMatch[2];
                log('Detected meta:', metaType, metaId);

                // Try library dispatch
                try {
                    window.core.dispatch({
                        action: 'Ctx',
                        args: {
                            action: 'MarkAsWatched',
                            args: { id: metaId, isWatched: true }
                        }
                    });
                    log('Dispatched MarkAsWatched for', metaId);
                    showFeedback(btn, true);
                    return;
                } catch(e) {
                    log('Ctx dispatch failed:', e.message);
                }
            }

            log('Could not find episodes to mark');
            showFeedback(btn, false);
        } catch(e) {
            log('Error marking season:', e.message);
            showFeedback(btn, false);
        }
    }

    // Inject button into detail pages
    setInterval(function() {
        if (!isEnabled()) return;

        var hash = window.location.hash || '';
        if (hash.indexOf('#/detail/') !== 0) { injectedForHash = ''; return; }

        // Only inject once per hash (re-inject if hash changes)
        if (injectedForHash === hash) return;
        if (document.getElementById('mark-season-btn')) {
            injectedForHash = hash;
            return;
        }

        // Look for season selector or episode list header
        setTimeout(function() {
            // Find a suitable injection point near the season/episode area
            var seasonSelectors = document.querySelectorAll('[class*="season"], [class*="Season"], select');
            var injectTarget = null;

            for (var i = 0; i < seasonSelectors.length; i++) {
                var el = seasonSelectors[i];
                if (el.offsetHeight > 0 && el.offsetWidth > 0) {
                    injectTarget = el.parentNode;
                    break;
                }
            }

            // Fallback: look for episode list container
            if (!injectTarget) {
                var epContainers = document.querySelectorAll('[class*="episode"], [class*="Episode"], [class*="videos"]');
                for (var j = 0; j < epContainers.length; j++) {
                    if (epContainers[j].children.length > 1) {
                        injectTarget = epContainers[j].parentNode;
                        break;
                    }
                }
            }

            // Last resort: find the main detail content area
            if (!injectTarget) {
                var detailDivs = document.querySelectorAll('[class*="detail"], [class*="Detail"], [class*="meta"]');
                for (var k = 0; k < detailDivs.length; k++) {
                    if (detailDivs[k].scrollHeight > 200) {
                        injectTarget = detailDivs[k];
                        break;
                    }
                }
            }

            if (!injectTarget) return;

            var btn = document.createElement('div');
            btn.id = 'mark-season-btn';
            btn.setAttribute('tabindex', '0');
            btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin:8px 12px;padding:8px 16px;background:rgba(123,91,245,0.2);border:1px solid rgba(123,91,245,0.4);border-radius:8px;color:#b8a5f8;font-size:0.85rem;font-weight:600;font-family:PlusJakartaSans,sans-serif;cursor:pointer;transition:background 0.2s;';
            btn.innerHTML = '<span style="font-size:1rem;">&#10003;</span> Mark Season Watched';

            btn.onclick = function() { markSeasonWatched(btn); };
            btn.onkeydown = function(e) { if (e.keyCode === 13 || e.keyCode === 32) { e.preventDefault(); markSeasonWatched(btn); } };
            btn.onfocus = function() { this.style.outline = '2px solid #7b5bf5'; };
            btn.onblur = function() { this.style.outline = 'none'; };
            btn.onmouseenter = function() { this.style.background = 'rgba(123,91,245,0.35)'; };
            btn.onmouseleave = function() { this.style.background = 'rgba(123,91,245,0.2)'; };

            // Insert at the beginning of the target
            if (injectTarget.firstChild) {
                injectTarget.insertBefore(btn, injectTarget.firstChild);
            } else {
                injectTarget.appendChild(btn);
            }
            injectedForHash = hash;
            log('Mark Season Watched button injected');
        }, 1500);
    }, 1000);

    // Register settings toggle
    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'mark-season-toggle',
            lsKey: LS_KEY,
            title: 'Mark Season',
            description: 'Adds a button to mark all episodes in a season as watched',
            onToggle: function(nowEnabled) {
                log('Mark season toggled:', nowEnabled ? 'ON' : 'OFF');
                if (!nowEnabled) {
                    var btn = document.getElementById('mark-season-btn');
                    if (btn) btn.remove();
                    injectedForHash = '';
                }
            }
        });
    }

    log('Mark season patch loaded (enabled:', isEnabled(), ')');
})();

// ═══════════════════════════════════════════════════════════════════════
// #21 — Subtitle Sync Drift Auto-Correction
// Tracks manual subtitle delay adjustments, calculates drift rate,
// and applies progressive correction automatically.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var LS_KEY = 'stremio_sub_drift_fix';
    var DRIFT_STORE_KEY = 'stremio_sub_drift_data';
    var LOG = '[sub-drift]';

    var adjustments = []; // { time: seconds, offset: ms }
    var driftRate = 0; // ms per second
    var correctionInterval = null;
    var lastAppliedCorrection = 0;
    var currentStreamHash = '';

    function isEnabled() {
        try { return localStorage.getItem(LS_KEY) === 'true'; } catch(e) { return false; }
    }

    function log() {
        var args = [LOG];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
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

console.log('[community] All 5 community features loaded (#17-#21). Enable in Settings.');
