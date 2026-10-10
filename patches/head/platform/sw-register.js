    window.__BUILD_COMMIT__ = 'b5e0f7d';
    // Register service worker with auto-update.
    // Hygiene since P1.13: registration failures are LOGGED (the old empty
    // catch left a silently absent cache/update path — nothing to diagnose),
    // and the post-update refresh is DEFERRED while the user is watching
    // something: reloading mid-playback discards position and subtitles.
    // Off the player route the refresh stays immediate (1 s, as before).
    (function() {
        if (!('serviceWorker' in navigator)) return;
        var log = window.__vidaaRuntime.logger('sw');

        function refreshForUpdate() {
            if ((window.location.hash || '').indexOf('#/player/') === 0) {
                log('update installed — deferring refresh until playback ends');
                var onLeave = function() {
                    if ((window.location.hash || '').indexOf('#/player/') === 0) return;
                    window.removeEventListener('hashchange', onLeave);
                    log('left player — refreshing for the new version');
                    setTimeout(function() { location.reload(); }, 500);
                };
                window.addEventListener('hashchange', onLeave);
                return;
            }
            log('new version installed, refreshing...');
            setTimeout(function() { location.reload(); }, 1000);
        }

        navigator.serviceWorker.register('./sw.js').then(function(reg) {
            reg.addEventListener('updatefound', function() {
                var newWorker = reg.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', function() {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            newWorker.postMessage('skipWaiting');
                            refreshForUpdate();
                        }
                    });
                }
            });
        }).catch(function(err) {
            log('service worker registration FAILED — offline cache and auto-update unavailable:',
                (err && err.message) || err);
        });
    })();
