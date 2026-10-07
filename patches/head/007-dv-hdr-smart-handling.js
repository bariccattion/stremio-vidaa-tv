// Smart DV/HDR stream handling
// Based on live hardware testing on Hisense PX1HE (100L5H):
// - DV+HDR in MKV at 4K: PLAYS NATIVELY (no transcoding needed)
// - DV+HDR in MP4: crashes browser (container issue)
// - Content >4K (4320p/8K upscale): black screen (decoder limit)
// - HEVC 4K 10-bit: plays fine
// - AV1: not supported
// NOTE: Other TVs may have different codec support — users can disable
// the playback warning via Settings > STREMIO TV > Playback Warning
(function() {
    var WARN_KEY = 'stremio_playback_warning';
    window.__DV_PROFILE7_DETECTED__ = false;
    window.__STREAM_INFO__ = {};

    // Default OFF — do not block streams that look stalled, many eventually recover
    // and the full-screen overlay blocks the TV remote from navigating elsewhere.
    // Users who want the codec/stall helper can opt in via Settings > STREMIO TV > Playback Warning.
    try { if (localStorage.getItem(WARN_KEY) === null) localStorage.setItem(WARN_KEY, 'false'); } catch(e) {}

    function isWarningEnabled() {
        try { return localStorage.getItem(WARN_KEY) === 'true'; } catch(e) { return false; }
    }

    // Monitor video element for playback failures — warn only on actual failure
    var watchInterval = null;

    function startPlaybackWatch() {
        if (watchInterval) return;
        watchInterval = setInterval(function() {
            var hash = window.location.hash || '';
            if (hash.indexOf('#/player/') !== 0) {
                if (watchInterval) { clearInterval(watchInterval); watchInterval = null; }
                return;
            }
            if (!isWarningEnabled()) return; // User disabled playback warning
            if (window.__QUIET_PLAYER_ACTIVE__) return; // Freed CPU for the video decoder
            var video = document.querySelector('video');
            if (!video) return;

            // Check for >4K resolution (decoder limit)
            if (video.videoWidth > 4096 || video.videoHeight > 2160) {
                console.warn('[stream] Resolution ' + video.videoWidth + 'x' + video.videoHeight + ' exceeds 4K — may cause issues');
                window.__STREAM_INFO__.oversize = true;
            }

            // Detect stalled DV playback (black screen = video loads but no frames render)
            if (video.readyState >= 2 && video.currentTime === 0 && !video.paused && !video.ended) {
                // Video thinks it's playing but stuck at 0 — possible black screen
                if (!window.__STREAM_INFO__.stallCheck) {
                    window.__STREAM_INFO__.stallCheck = Date.now();
                } else if (Date.now() - window.__STREAM_INFO__.stallCheck > 8000) {
                    // 8 seconds with no progress — likely a black screen
                    console.warn('[stream] Playback stalled — possible codec/container issue');
                    showPlaybackWarning();
                    window.__STREAM_INFO__.stallCheck = null;
                }
            } else {
                window.__STREAM_INFO__.stallCheck = null;
            }
        }, 2000);
    }

    // Watch for player route
    var wasInPlayer = false;
    setInterval(function() {
        var hash = window.location.hash || '';
        var inPlayer = hash.indexOf('#/player/') === 0;
        if (inPlayer) {
            if (!wasInPlayer) { window.__STREAM_INFO__ = {}; }
            startPlaybackWatch();
        }
        if (!inPlayer) { window.__FORCE_TRANSCODE__ = false; }
        wasInPlayer = inPlayer;
    }, 1000);

    // Intercept probe responses — log codec info but DON'T block playback
    var origFetch = window.fetch;
    window.fetch = function(url, opts) {
        var result = origFetch.apply(this, arguments);
        try {
            if (typeof url === 'string' && url.indexOf('/hlsv2/') !== -1 && url.indexOf('probe') !== -1) {
                result.then(function(response) {
                    var cloned = response.clone();
                    cloned.json().then(function(data) {
                        if (data && Array.isArray(data.streams)) {
                            for (var i = 0; i < data.streams.length; i++) {
                                var s = data.streams[i];
                                if (s.track === 'video') {
                                    window.__STREAM_INFO__.videoCodec = s.codec;
                                    window.__STREAM_INFO__.width = s.width;
                                    window.__STREAM_INFO__.height = s.height;
                                    if (s.codec && /^dv(he|h1)/.test(s.codec)) {
                                        window.__DV_PROFILE7_DETECTED__ = s.codec;
                                        console.log('[DV] Detected:', s.codec, s.width + 'x' + s.height, '— letting browser attempt native playback');
                                    }
                                }
                            }
                        }
                    }).catch(function() {});
                });
            }
        } catch(e) {}
        return result;
    };

    function showPlaybackWarning() {
        var existing = document.getElementById('dv-warning');
        if (existing) return;

        var codec = window.__STREAM_INFO__.videoCodec || 'unknown';
        var res = (window.__STREAM_INFO__.width || '?') + 'x' + (window.__STREAM_INFO__.height || '?');
        var isOversize = window.__STREAM_INFO__.width > 4096 || window.__STREAM_INFO__.height > 2160;

        var overlay = document.createElement('div');
        overlay.id = 'dv-warning';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-family:PlusJakartaSans,sans-serif;';

        var title = isOversize ? 'Resolution Too High' : 'Playback Issue Detected';
        // Only advertise transcode as a remedy when a REAL streaming server is
        // configured. Bare-TV / Real-Debrid users have no server, so telling them
        // to "transcode via your streaming server" is a dead end.
        var srvUrlW = window.__STREMIO_SERVER_URL__ || '';
        var serverReadyW = srvUrlW && srvUrlW !== 'http://127.0.0.1:11470';
        var detail = isOversize
            ? 'This stream is ' + esc(res) + ' which exceeds your TV\'s 4K decode limit. Try a 2160p or 1080p source instead.'
            : 'This stream (' + esc(codec) + ' @ ' + esc(res) + ') is not rendering. The container format may be incompatible. Try a 1080p or MP4 version of this title'
                + (serverReadyW ? ', or use your streaming server to transcode it.' : '. (Transcoding needs a separate Stremio streaming-server PC — Settings ▸ Server.)');

        var inner = '<div style="font-size:2.2rem;margin-bottom:1rem;font-weight:700;">' + title + '</div>'
            + '<div style="font-size:1.1rem;color:rgba(255,255,255,0.65);margin-bottom:2rem;text-align:center;max-width:560px;line-height:1.5;">' + detail + '</div>'
            + '<div id="dv-actions" style="display:flex;gap:1.2rem;"></div>';
        overlay.innerHTML = inner;

        var actionsDiv = overlay.querySelector('#dv-actions');

        // Native Player button (VIDAA only)
        var hasNativePlayer = false;
        try { hasNativePlayer = typeof omi_platform !== 'undefined' && typeof omi_platform.sendPlatformMessage === 'function'; } catch(e) {}

        if (hasNativePlayer) {
            var nativeBtn = document.createElement('button');
            nativeBtn.textContent = 'Open in Native Player';
            nativeBtn.style.cssText = 'padding:0.9rem 2.2rem;font-size:1.1rem;background:#7b5bf5;color:white;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600;';
            nativeBtn.setAttribute('tabindex', '0');
            nativeBtn.onfocus = function() { this.style.outline = '3px solid #a78bfa'; };
            nativeBtn.onblur = function() { this.style.outline = 'none'; };
            nativeBtn.onclick = function() {
                var video = document.querySelector('video');
                var streamUrl = video ? video.currentSrc || video.src : null;
                if (!streamUrl) return;
                // M2: do NOT remove the overlay until we KNOW the handoff worked.
                // The launcher resolves a verified boolean; only on success do we
                // clear the stall flag + dismiss. On failure the recovery UI stays.
                nativeBtn.textContent = 'Trying…';
                nativeBtn.disabled = true;
                Promise.resolve(window.__launchNativePlayer(streamUrl)).then(function(opened) {
                    if (opened) {
                        window.__STREAM_INFO__.stallCheck = null;
                        overlay.remove();
                    } else {
                        nativeBtn.textContent = 'TV player didn’t open — try another option';
                        nativeBtn.disabled = false;
                    }
                });
            };
            actionsDiv.appendChild(nativeBtn);
        }

        // H4/M3: Force Transcode only works with a REAL streaming server. Gate it
        // exactly like the Blue-button handler does. Without a server, don't
        // pretend transcode is available — show it disabled with an honest label.
        var transBtn = document.createElement('button');
        transBtn.textContent = serverReadyW ? 'Force Transcode' : 'Transcode (needs streaming-server PC)';
        var transBg = serverReadyW ? (hasNativePlayer ? 'rgba(255,255,255,0.1)' : '#7b5bf5') : 'rgba(255,255,255,0.05)';
        var transColor = serverReadyW ? 'white' : 'rgba(255,255,255,0.4)';
        var transBorder = serverReadyW ? (hasNativePlayer ? '1px solid rgba(255,255,255,0.25)' : 'none') : '1px solid rgba(255,255,255,0.1)';
        transBtn.style.cssText = 'padding:0.9rem 2.2rem;font-size:1.1rem;background:' + transBg + ';color:' + transColor + ';border:' + transBorder + ';border-radius:8px;cursor:' + (serverReadyW ? 'pointer' : 'not-allowed') + ';font-family:inherit;font-weight:600;';
        transBtn.setAttribute('tabindex', '0');
        if (!serverReadyW) {
            transBtn.disabled = true;
            transBtn.setAttribute('aria-disabled', 'true');
            transBtn.title = 'Force transcode requires a separate Stremio streaming server (Settings ▸ Server). Real-Debrid / bare-TV setups have none.';
        }
        transBtn.onfocus = function() { this.style.outline = '3px solid #a78bfa'; };
        transBtn.onblur = function() { this.style.outline = 'none'; };
        transBtn.onclick = function() {
            if (!serverReadyW) return; // gated: no real server, do nothing
            window.__STREAM_INFO__.stallCheck = null;
            window.__FORCE_TRANSCODE__ = true;
            overlay.remove();
            var ch = window.location.hash;
            window.location.hash = '#/home';
            setTimeout(function() { window.location.hash = ch; }, 100);
        };
        actionsDiv.appendChild(transBtn);

        var skipBtn = document.createElement('button');
        skipBtn.textContent = 'Try Another Source';
        skipBtn.style.cssText = 'padding:0.9rem 2.2rem;font-size:1.1rem;background:rgba(255,255,255,0.1);color:white;border:1px solid rgba(255,255,255,0.25);border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600;';
        skipBtn.setAttribute('tabindex', '0');
        skipBtn.onfocus = function() { this.style.outline = '3px solid #a78bfa'; };
        skipBtn.onblur = function() { this.style.outline = 'none'; };
        skipBtn.onclick = function() {
            window.__STREAM_INFO__.stallCheck = null;
            overlay.remove();
            window.history.back();
        };
        actionsDiv.appendChild(skipBtn);

        var dismissBtn = document.createElement('button');
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.style.cssText = 'padding:0.9rem 2.2rem;font-size:1.1rem;background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600;';
        dismissBtn.setAttribute('tabindex', '0');
        dismissBtn.onfocus = function() { this.style.outline = '3px solid #a78bfa'; };
        dismissBtn.onblur = function() { this.style.outline = 'none'; };
        dismissBtn.onclick = function() { window.__STREAM_INFO__.stallCheck = null; overlay.remove(); };
        actionsDiv.appendChild(dismissBtn);

        document.body.appendChild(overlay);
        setTimeout(function() { transBtn.focus(); }, 100);
    }
    window.__showPlaybackWarning = showPlaybackWarning;

    // Register settings toggle
    var regInterval = setInterval(function() {
        if (!window.__registerVidaaSettingsItem) return;
        clearInterval(regInterval);
        window.__registerVidaaSettingsItem({
            id: 'playback-warning-toggle',
            type: 'toggle',
            label: 'Playback Warning',
            description: 'Shows a helper overlay when playback stalls (offers native player / transcode / go-back). OFF by default — most streams eventually recover and the overlay blocks the remote.',
            lsKey: WARN_KEY,
            defaultValue: false
        });
    }, 200);
})();
