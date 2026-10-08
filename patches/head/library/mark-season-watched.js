// #20 — Mark Season as Watched (split from the former 032 god-module; the settingsStore lives in kernel/settings-store.js)
// Injects a "Mark Season Watched" button near the season selector
// on detail pages. Dispatches MarkAsWatched for each episode.
// ═══════════════════════════════════════════════════════════════════════
// #20 — Mark Season as Watched
// Injects a "Mark Season Watched" button near the season selector
// on detail pages. Dispatches MarkAsWatched for each episode.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_mark_season';
    var log = RT.logger('season');
    var injectedForHash = '';

    function isEnabled() {
        return RT.store.getBool(LS_KEY, false);
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
    RT.poll(function() {
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
    }, 1000, { quiet: true });

    // Register settings toggle
    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'mark-season-toggle',
            lsKey: LS_KEY,
            defaultValue: false,
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
