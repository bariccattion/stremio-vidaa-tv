// #9 — Save and restore playback speed & volume
// Persists user's preferred playback rate and volume in localStorage.
// Restores them automatically when a new video starts playing.
(function() {
    var SPEED_KEY = 'stremio_playback_speed';
    var VOLUME_KEY = 'stremio_volume';
    var applied = false;
    var lastVideoSrc = '';

    function getSavedSpeed() {
        try { var v = parseFloat(localStorage.getItem(SPEED_KEY)); return (v && v > 0 && v <= 4) ? v : null; } catch(e) { return null; }
    }
    function getSavedVolume() {
        try { var v = parseFloat(localStorage.getItem(VOLUME_KEY)); return (v >= 0 && v <= 1) ? v : null; } catch(e) { return null; }
    }

    // Watch for video element and apply saved settings.
    // Save path is debounced by last-persisted cache to avoid the
    // synchronous localStorage writes the old code did on every 1.5s tick.
    var lastPersistedSpeed = null;
    var lastPersistedVol = null;
    setInterval(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) { applied = false; lastVideoSrc = ''; return; }
        // Quiet Player Mode — only the one-shot apply is allowed, no polling saves.
        if (window.__QUIET_PLAYER_ACTIVE__ && applied) return;

        var video = document.querySelector('video');
        if (!video) return;

        var src = video.currentSrc || video.src || '';
        if (src && src !== lastVideoSrc) {
            lastVideoSrc = src;
            applied = false;
            lastPersistedSpeed = null;
            lastPersistedVol = null;
        }

        if (!applied && video.readyState >= 1) {
            var savedSpeed = getSavedSpeed();
            if (savedSpeed !== null && video.playbackRate !== savedSpeed) {
                video.playbackRate = savedSpeed;
                console.log('[playback] Restored speed:', savedSpeed);
            }
            var savedVol = getSavedVolume();
            if (savedVol !== null && Math.abs(video.volume - savedVol) > 0.01) {
                video.volume = savedVol;
                console.log('[playback] Restored volume:', savedVol);
            }
            applied = true;
            lastPersistedSpeed = video.playbackRate;
            lastPersistedVol = video.volume;
        }

        // Continuously monitor for user changes and persist them — but only
        // write when the value actually changed vs what we last wrote, so we
        // don't do a synchronous localStorage.setItem on every tick.
        if (video.readyState >= 1) {
            if (window.__QUIET_PLAYER_ACTIVE__) return;
            var currentSpeed = video.playbackRate;
            var currentVol = video.volume;
            try {
                if (currentSpeed && currentSpeed > 0 && currentSpeed !== lastPersistedSpeed) {
                    localStorage.setItem(SPEED_KEY, String(currentSpeed));
                    lastPersistedSpeed = currentSpeed;
                }
                if (currentVol >= 0 && (lastPersistedVol === null || Math.abs(currentVol - lastPersistedVol) > 0.01)) {
                    localStorage.setItem(VOLUME_KEY, String(currentVol));
                    lastPersistedVol = currentVol;
                }
            } catch(e) {}
        }
    }, 1500);
})();
