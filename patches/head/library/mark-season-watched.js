// #20 — Mark Season as Watched (rewritten, P0.6 2026-10-08)
// Injects a "Mark Season Watched" button on series detail pages. Clicking
// it dispatches MetaDetails → MarkVideoAsWatched for every episode of the
// SELECTED season (the season the details screen is showing — read from
// the route's ?season= param, which upstream keeps in sync).
//
// The rewrite replaces three broken strategies (see
// docs/PATCHES_VS_UPSTREAM.md §2.1):
//   • Method 1 read getState('meta')/('detail') synchronously — invalid
//     fields, and getState always returns a Promise. Now: one awaited
//     getState('meta_details') (the real field) reading
//     metaItem.ready.videos — the same shape the upstream episode
//     switcher consumes.
//   • Method 2 blind-clicked [class*="watched"/"check"/"mark"] elements —
//     could trigger arbitrary controls. Deleted.
//   • Method 3 dispatched Ctx → MarkAsWatched with the SERIES id — i.e.
//     upstream's own action at the wrong granularity, behind a button
//     labeled "season". Deleted.
// Feedback now counts actual dispatch RESULTS (the core rejects unknown
// actions — worker dispatch throws — so failures are visible, not assumed).
//
// Injection fixes: the hash latch is set BEFORE the deferred injection
// (the old 1 s poll vs 1.5 s timeout race injected duplicate buttons), the
// timeout body re-checks for an existing button, and a button removed by a
// re-render is re-injected on the next poll tick.
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_mark_season';
    var log = RT.logger('season');
    var injectedForHash = '';

    function isEnabled() {
        return RT.store.getBool(LS_KEY, false);
    }

    // The details screen keeps the selected season as ?season=N on the
    // route (replace-navigation). Absent param → season 1 (the screen's
    // initial selection; it writes the param as soon as the user picks).
    function currentSeason() {
        var hash = window.location.hash || '';
        var q = hash.indexOf('?') !== -1 ? hash.substring(hash.indexOf('?') + 1) : '';
        var m = /(?:^|&)season=(\d+)/.exec(q);
        return m ? parseInt(m[1], 10) : 1;
    }

    function detailRouteInfo() {
        var m = /#\/detail\/([^/]+)\/([^/?]+)/.exec(window.location.hash || '');
        return m ? { type: m[1], metaId: m[2] } : null;
    }

    function showFeedback(btn, text, bg) {
        var origText = btn.textContent;
        var origBg = btn.style.background;
        btn.textContent = text;
        btn.style.background = bg;
        setTimeout(function() {
            btn.textContent = origText;
            btn.style.background = origBg;
        }, 2500);
    }

    // The action, exposed for tests. Returns a Promise<{ total, ok, fail }>.
    // Marks every episode of the selected (or overridden) season.
    window.__markSeasonWatched = function(seasonOverride) {
        var season = (typeof seasonOverride === 'number') ? seasonOverride : currentSeason();
        return new Promise(function(resolve) {
            if (!(RT.core && RT.core.getState)) {
                resolve({ total: 0, ok: 0, fail: 0, error: 'core unavailable' });
                return;
            }
            RT.core.getState('meta_details').then(function(state) {
                var videos = state && state.metaItem && state.metaItem.ready
                    && state.metaItem.ready.videos;
                if (!videos || !videos.length) {
                    resolve({ total: 0, ok: 0, fail: 0, error: 'no videos in meta_details' });
                    return;
                }
                var targets = [];
                for (var i = 0; i < videos.length; i++) {
                    var v = videos[i];
                    if (v && v.id && v.season === season) targets.push(v.id);
                }
                if (!targets.length) {
                    resolve({ total: 0, ok: 0, fail: 0, error: 'season ' + season + ' has no episodes' });
                    return;
                }
                var res = { total: targets.length, ok: 0, fail: 0 };
                function settle() {
                    if (res.ok + res.fail === res.total) resolve(res);
                }
                for (var j = 0; j < targets.length; j++) {
                    (function(videoId) {
                        RT.core.dispatch({
                            action: 'MetaDetails',
                            args: {
                                action: 'MarkVideoAsWatched',
                                args: { id: videoId, isWatched: true }
                            }
                        }, 'meta_details').then(function() {
                            res.ok++; settle();
                        }).catch(function(e) {
                            res.fail++;
                            log('MarkVideoAsWatched rejected for', videoId, ':', (e && e.message) || e);
                            settle();
                        });
                    })(targets[j]);
                }
            }).catch(function(e) {
                resolve({ total: 0, ok: 0, fail: 0, error: (e && e.message) || 'getState failed' });
            });
        });
    };

    function markSeasonWatched(btn) {
        var season = currentSeason();
        log('Marking season', season, 'as watched...');
        // Placeholder feedback while the dispatches run.
        btn.textContent = 'Marking…';
        window.__markSeasonWatched().then(function(res) {
            if (res.ok > 0 && res.fail === 0) {
                showFeedback(btn, '\u2713 ' + res.ok + ' episode' + (res.ok === 1 ? '' : 's') + ' marked',
                    'rgba(34,197,94,0.3)');
            } else if (res.ok > 0) {
                showFeedback(btn, res.ok + ' marked, ' + res.fail + ' failed', 'rgba(234,179,8,0.3)');
            } else {
                showFeedback(btn, 'Could not mark — nothing dispatched', 'rgba(239,68,68,0.3)');
            }
        });
    }

    // Inject button into series detail pages
    RT.poll(function() {
        if (!isEnabled()) return;

        var hash = window.location.hash || '';
        if (hash.indexOf('#/detail/') !== 0) { injectedForHash = ''; return; }

        // Series only — movies/channels have no seasons to mark.
        var info = detailRouteInfo();
        if (!info || info.type !== 'series') { injectedForHash = ''; return; }

        // Already injected for this hash AND still in the DOM → done. A
        // button removed by an upstream re-render re-injects next tick.
        if (injectedForHash === hash && document.getElementById('mark-season-btn')) return;

        // Latch BEFORE the deferred injection: the 1 s poll used to race
        // the 1.5 s timeout into duplicate buttons (P0.6).
        injectedForHash = hash;

        // Let the details screen render first, then place the button.
        setTimeout(function() {
            if (document.getElementById('mark-season-btn')) return;

            var seasonSelectors = document.querySelectorAll('[class*="season"], [class*="Season"], select');
            var injectTarget = null;
            for (var i = 0; i < seasonSelectors.length; i++) {
                var el = seasonSelectors[i];
                if (el.offsetHeight > 0 && el.offsetWidth > 0) {
                    injectTarget = el.parentNode;
                    break;
                }
            }
            if (!injectTarget) {
                var epContainers = document.querySelectorAll('[class*="episode"], [class*="Episode"], [class*="videos"]');
                for (var j = 0; j < epContainers.length; j++) {
                    if (epContainers[j].children.length > 1) {
                        injectTarget = epContainers[j].parentNode;
                        break;
                    }
                }
            }
            if (!injectTarget) return;

            var UI = window.__vidaaUI;
            var btn = UI.button('\u2713 Mark Season Watched', {
                bg: 'rgba(123,91,245,0.2)',
                color: '#b8a5f8'
            });
            btn.id = 'mark-season-btn';
            // Register with the app's spatial navigation so the remote can
            // focus the injected button.
            btn.setAttribute('nav-id', 'mark-season-btn');
            btn.onclick = function() { markSeasonWatched(btn); };

            if (injectTarget.firstChild) {
                injectTarget.insertBefore(btn, injectTarget.firstChild);
            } else {
                injectTarget.appendChild(btn);
            }
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
            description: 'Adds a button to mark all episodes in the selected season as watched',
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
