// #9 — Save and restore playback speed & volume (event-driven since P1.11).
// Restores the saved values once per new video src; PERSISTS only real
// user changes observed as media events — never poll-sampled values. The
// old save loop sampled video.playbackRate on a timer and happily saved
// the engine's own init reset to 1.0, silently destroying the user's
// preference. Discriminators now:
//   • apply window — ratechange/volumechange fired by OUR restore are
//     skipped (timestamped window after each apply);
//   • playing gate — changes before the first 'playing' event are engine
//     init (the engine sets its props on load), not user action;
//   • debounced writes — a burst of changes coalesces into one
//     localStorage write per key.
(function() {
    var RT = window.__vidaaRuntime;
    var log = RT.logger('playback');
    var SPEED_KEY = 'stremio_playback_speed';
    var VOLUME_KEY = 'stremio_volume';
    var applied = false;
    var lastVideoSrc = '';
    var applyWindowUntil = 0;

    var store = RT.store;

    function getSavedSpeed() {
        var v = parseFloat(store.get(SPEED_KEY, null));
        return (v && v > 0 && v <= 4) ? v : null;
    }
    function getSavedVolume() {
        var v = parseFloat(store.get(VOLUME_KEY, null));
        return (v >= 0 && v <= 1) ? v : null;
    }

    // ── Event-driven persistence ────────────────────────────────────
    var saveTimers = {};
    function scheduleSave(key, value, format) {
        if (saveTimers[key]) clearTimeout(saveTimers[key]);
        saveTimers[key] = setTimeout(function() {
            saveTimers[key] = null;
            store.set(key, format(value));
            log('Persisted', key, '=', value);
        }, 500);
    }

    function isSelfOrInit(video) {
        if (Date.now() < applyWindowUntil) return true;   // our own restore
        if (!video.__svpPlaying) return true;             // engine init (pre-playing)
        return false;
    }

    function hookVideo(video) {
        if (!video || video.__svpHooked) return;
        video.__svpHooked = true;
        video.__svpPlaying = false;
        video.addEventListener('playing', function() { video.__svpPlaying = true; });
        video.addEventListener('ratechange', function() {
            if (isSelfOrInit(video)) return;
            var rate = video.playbackRate;
            if (rate && rate > 0 && rate <= 4) {
                scheduleSave(SPEED_KEY, rate, function(v) { return String(v); });
            }
        });
        video.addEventListener('volumechange', function() {
            if (isSelfOrInit(video)) return;
            var vol = video.volume;
            if (vol >= 0 && vol <= 1) {
                scheduleSave(VOLUME_KEY, vol, function(v) { return String(v); });
            }
        });
    }

    // Attach to every video the engine creates (one watcher since P1.6),
    // plus a sweep for anything already mounted.
    if (RT.dom && RT.dom.onVideoAdded) {
        RT.dom.onVideoAdded(hookVideo);
    }
    var mounted = document.querySelectorAll('video');
    for (var m = 0; m < mounted.length; m++) hookVideo(mounted[m]);

    // ── One-shot restore per new src (route-gated poll; the restore is
    // playback-relevant, hence quiet:false — saves no longer run here).
    RT.poll(function() {
        var video = (RT.dom && RT.dom.currentVideo) ? RT.dom.currentVideo()
            : document.querySelector('video');
        if (!video) { applied = false; lastVideoSrc = ''; return; }
        hookVideo(video);

        var src = video.currentSrc || video.src || '';
        if (src && src !== lastVideoSrc) {
            lastVideoSrc = src;
            applied = false;
        }
        if (applied || video.readyState < 1) return;

        var savedSpeed = getSavedSpeed();
        if (savedSpeed !== null && video.playbackRate !== savedSpeed) {
            video.playbackRate = savedSpeed;
            log('Restored speed:', savedSpeed);
        }
        var savedVol = getSavedVolume();
        if (savedVol !== null && Math.abs(video.volume - savedVol) > 0.01) {
            video.volume = savedVol;
            log('Restored volume:', savedVol);
        }
        applied = true;
        // Swallow the ratechange/volumechange our restore just fired.
        applyWindowUntil = Date.now() + 1500;
    }, 1500, { route: 'player', quiet: false });
})();
