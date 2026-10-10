// #19 — Auto-Play Best Stream (split from the former 032 god-module; the settingsStore lives in kernel/settings-store.js)
// Automatically selects the highest-scored stream instead of showing
// the stream selection screen. Scores by resolution, source, size, seeds.
// ═══════════════════════════════════════════════════════════════════════
// #19 — Auto-Play Best Stream
// Automatically selects the highest-scored stream instead of showing
// the stream selection screen. Scores by resolution, source, size, seeds.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_autoplay_best';
    var log = RT.logger('autoplay');
    var processedUrls = {};

    function isEnabled() {
        return RT.store.getBool(LS_KEY, false);
    }

    // Scoring ladder: deliberately loose indexOf matching (unknown labels
    // score as 720p-ish, partial markers still count) — do not "fix" it to
    // the stricter word-boundary predicates in kernel/streams.js.
    function scoreStream(stream) {
        var score = 0;
        var name = window.__vidaaStreams.text(stream);

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
        var sizeGB = window.__vidaaStreams.parseSizeGB(name);
        if (sizeGB !== null) {
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
        RT.toast(msg, {
            id: 'autoplay-toast',
            at: 'top',
            ms: 3600,
            fadeMs: 3000,
            extra: 'background:rgba(123,91,245,0.9);padding:10px 24px;font-size:0.9rem;z-index:99999;pointer-events:none;transition:opacity 0.5s;'
        });
    }

    // Watch for stream selection page
    var lastHash = '';
    RT.poll(function() {
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
                if (!(RT.core && RT.core.getState)) return;

                // Try to get streams from core state (RT.core seam; the real
                // field is meta_details — the old 'streaming'/'player' reads
                // never returned stream lists).
                var tryGetStreams = function(attempts) {
                    if (attempts <= 0) {
                        log('No streams found after retries');
                        return;
                    }
                    if (!(RT.core && RT.core.getState)) return;

                    RT.core.getState('meta_details').then(function(state) {
                        // meta_details.addonStreams = [{addon, content: [streams]}]
                        var streams = [];
                        if (state && Array.isArray(state.addonStreams)) {
                            for (var g = 0; g < state.addonStreams.length; g++) {
                                var content = state.addonStreams[g] && state.addonStreams[g].content;
                                if (Array.isArray(content)) {
                                    for (var c = 0; c < content.length; c++) streams.push(content[c]);
                                }
                            }
                        }
                        if (streams.length === 0) {
                            setTimeout(function() { tryGetStreams(attempts - 1); }, 1000);
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

                        // The ONLY honest play path: navigate the app's own
                        // deepLink for the stream (what a click on the row
                        // does). The old DOM-click mapped a core index onto
                        // an unrelated element list, and the 'StreamClicked'
                        // core action does not exist upstream (P0.10/P1.8).
                        if (best.stream.deepLinks && best.stream.deepLinks.player) {
                            window.location.hash = best.stream.deepLinks.player;
                            log('Navigated to player deepLink');
                        } else {
                            log('Best stream has no player deepLink — leaving selection to the user');
                            processedUrls[hash] = false;
                        }
                    }).catch(function(e) {
                        log('meta_details read failed:', e.message);
                    });
                };

                tryGetStreams(5);
            } catch(e) {
                log('Error in auto-play:', e.message);
            }
        }, 2000);
    }, 500, { route: 'nonplayer' });

    // Register settings toggle
    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'autoplay-best-toggle',
            lsKey: LS_KEY,
            defaultValue: false,
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
