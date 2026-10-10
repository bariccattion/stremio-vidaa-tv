// Smart DV/HDR stream handling
// Based on live hardware testing on Hisense PX1HE (100L5H):
// - DV+HDR in MKV at 4K: PLAYS NATIVELY (no transcoding needed)
// - DV+HDR in MP4: crashes browser (container issue)
// - Content >4K (4320p/8K upscale): black screen (decoder limit)
// - HEVC 4K 10-bit: plays fine
// - AV1: not supported
// NOTE: Other TVs may have different codec support — users can disable
// the playback warning via Settings > Vidaa TV > Playback Warning
(function() {
    var RT = window.__vidaaRuntime;
    var log = RT.logger('stream');
    var dvLog = RT.logger('dv');
    var WARN_KEY = 'stremio_playback_warning';
    window.__DV_PROFILE7_DETECTED__ = false;
    window.__STREAM_INFO__ = {};

    // Default OFF — do not block streams that look stalled, many eventually recover
    // and the full-screen overlay blocks the TV remote from navigating elsewhere.
    // Users who want the codec/stall helper can opt in via Settings > Vidaa TV > Playback Warning.
    try { if (localStorage.getItem(WARN_KEY) === null) localStorage.setItem(WARN_KEY, 'false'); } catch(e) {}

    function isWarningEnabled() {
        return RT.store.getBool(WARN_KEY, false);
    }

    // Stuck-at-start detection lives in the kernel stall coordinator since
    // P1.2 (one detector, one actor per episode); this patch registers the
    // inform strategy that shows the fullscreen warning when the user
    // opted in. The old self-owned 2 s poll duplicated auto-rebuffer's
    // frozen-time detector on an overlapping condition (t===0), and the
    // rebuffer seek silently disarmed it.
    if (RT.stall) {
        RT.stall.register({
            id: 'dv-overlay',
            phase: 'inform',
            priority: 300,
            type: 'start',
            when: isWarningEnabled,
            act: function() {
                // Keep the stallCheck flag semantics for error-messages' DV
                // branch (a crit error arriving mid-stall gets DV-specific copy).
                window.__STREAM_INFO__.stallCheck = Date.now();
                showPlaybackWarning();
                window.__STREAM_INFO__.stallCheck = null;
                return true;
            }
        });
    }

    // Watch for player route (bookkeeping — must keep ticking under Quiet
    // Player Mode, hence quiet:false): reset stream info on player entry,
    // clear the force-transcode flag on exit, and track the >4K decoder
    // limit (feeds `tooHeavy` analysis in the stall strategies).
    var wasInPlayer = false;
    RT.poll(function() {
        var inPlayer = RT.inPlayer();
        if (inPlayer) {
            if (!wasInPlayer) { window.__STREAM_INFO__ = {}; }
            if (isWarningEnabled()) {
                var video = document.querySelector('video');
                if (video && (video.videoWidth > 4096 || video.videoHeight > 2160)) {
                    log.warn('Resolution ' + video.videoWidth + 'x' + video.videoHeight + ' exceeds 4K — may cause issues');
                    window.__STREAM_INFO__.oversize = true;
                }
            }
        }
        if (!inPlayer) { window.__FORCE_TRANSCODE__ = false; }
        wasInPlayer = inPlayer;
    }, 1000, { quiet: false });

    // Intercept probe responses — log codec info but DON'T block playback
    RT.tapJsonFetch(function(u) {
        return u.indexOf('/hlsv2/') !== -1 && u.indexOf('probe') !== -1;
    }, function(data) {
        if (data && Array.isArray(data.streams)) {
            for (var i = 0; i < data.streams.length; i++) {
                var s = data.streams[i];
                if (s.track === 'video') {
                    window.__STREAM_INFO__.videoCodec = s.codec;
                    window.__STREAM_INFO__.width = s.width;
                    window.__STREAM_INFO__.height = s.height;
                    if (s.codec && /^dv(he|h1)/.test(s.codec)) {
                        window.__DV_PROFILE7_DETECTED__ = s.codec;
                        dvLog('Detected:', s.codec, s.width + 'x' + s.height, '— letting browser attempt native playback');
                    }
                }
            }
        }
    });

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
        var serverReadyW = RT.serverConfigured();
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
        var hasNativePlayer = window.__hasNativePlayer ? window.__hasNativePlayer() : false;

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

    // P1.14: Back/Escape close the overlay (priority-1000 modal-close
    // pattern, same as the diagnostics panel) — a fullscreen overlay the
    // remote can't dismiss was the exact projector regression this layer
    // forbids. The press is suppressed so the app never navigates away
    // underneath the closing overlay.
    window.__vidaaKeys.on(['back', 'escape'], function() {
        var el = document.getElementById('dv-warning');
        if (el) {
            el.remove();
            window.__STREAM_INFO__.stallCheck = null;
            log('warning overlay dismissed via Back/Escape');
        }
    }, { priority: 1000, suppress: true, when: function() { return !!document.getElementById('dv-warning'); } });

    // Register settings toggle
    RT.onRegistryReady(function() {
        window.__registerVidaaSettingsItem({
            id: 'playback-warning-toggle',
            type: 'toggle',
            label: 'Playback Warning',
            description: 'Shows a helper overlay when playback stalls (offers native player / transcode / go-back). OFF by default — most streams eventually recover and the overlay blocks the remote.',
            lsKey: WARN_KEY,
            defaultValue: false
        });
    });
})();
