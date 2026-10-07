// VIDAA remote color button mappings
(function() {
    var healthOverlay = null;

    function showToast(msg, bg, ms) {
        var t = document.createElement('div');
        t.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:' + (bg || 'rgba(0,0,0,0.88)') + ';color:white;padding:16px 28px;border-radius:10px;font-size:1.05rem;font-family:PlusJakartaSans,sans-serif;z-index:100000;pointer-events:none;text-align:center;max-width:500px;';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.remove(); }, ms || 2500);
    }

    document.addEventListener('keydown', function(e) {
        var code = e.keyCode;

        // Red (403) — toggle quality indicator (only outside the player).
        // Inside the player the Stream Stats overlay owns Red (registered on window).
        // Outside the player, show the quality indicator even though the interval
        // normally only renders it in player — just to confirm the button is wired.
        if (code === 403) {
            var inPlayer = (window.location.hash || '').indexOf('#/player/') !== -1;
            if (!inPlayer) {
                var qi = document.getElementById('quality-indicator');
                if (qi) qi.style.display = qi.style.display === 'none' ? 'block' : 'none';
            }
        }

        // Green (404) — toggle server health overlay
        if (code === 404) {
            if (healthOverlay) { healthOverlay.remove(); healthOverlay = null; return; }
            var h = window.__SERVER_HEALTH__ || {};
            var url = window.__STREMIO_SERVER_URL__ || 'default';
            var isDefault = !url || url === 'default' || url === 'http://127.0.0.1:11470';
            var statusColor, statusText;
            if (h.status === 'online') { statusColor = '#4ade80'; statusText = 'online'; }
            else if (isDefault) { statusColor = '#94a3b8'; statusText = 'not configured'; }
            else { statusColor = '#f87171'; statusText = h.status || 'offline'; }
            healthOverlay = document.createElement('div');
            healthOverlay.style.cssText = 'position:fixed;bottom:60px;right:14px;background:rgba(0,0,0,0.9);color:white;padding:16px 20px;border-radius:10px;font-size:13px;z-index:99999;font-family:monospace;min-width:260px;backdrop-filter:blur(4px);';
            var note = isDefault && h.status !== 'online'
                ? '<div style="margin-top:8px;color:rgba(255,255,255,0.6);font-size:11px;line-height:1.4;">Streaming server is optional. Real-Debrid users do not need one.</div>'
                : '';
            healthOverlay.innerHTML = '<div style="font-weight:700;margin-bottom:8px;font-size:14px;">Server Health</div>'
                + '<div>Status: <span style="color:' + statusColor + ';">' + esc(statusText) + '</span></div>'
                + '<div>Latency: ' + (h.latency ? h.latency + 'ms' : 'N/A') + '</div>'
                + '<div>Version: ' + esc(h.version || 'N/A') + '</div>'
                + '<div>URL: ' + esc(url) + '</div>'
                + note;
            document.body.appendChild(healthOverlay);
            setTimeout(function() { if (healthOverlay) { healthOverlay.remove(); healthOverlay = null; } }, 10000);
        }

        // Blue (406) — force transcode current stream (reloads player).
        // Only useful if a streaming server is configured. Do not require the
        // cached health flag here; health checks are intentionally quiet in the
        // player and can be stale even when the server is reachable.
        if (code === 406) {
            var ph = window.location.hash || '';
            if (ph.indexOf('#/player/') !== 0) return;
            var srvUrl = window.__STREMIO_SERVER_URL__ || '';
            var serverReady = srvUrl && srvUrl !== 'http://127.0.0.1:11470';
            if (!serverReady) {
                showToast('Force transcode needs a streaming server.\nCheck Settings > Server.', 'rgba(180,60,60,0.92)', 3500);
                return;
            }
            window.__FORCE_TRANSCODE__ = true;
            console.log('[remote] Force transcode enabled, reloading stream');
            showToast('Forcing transcode...', null, 1500);
            try {
                window.location.hash = '#/home';
                setTimeout(function() { window.location.hash = ph; }, 200);
            } catch(err) {
                console.error('[remote] Force transcode reload failed:', err.message);
                showToast('Could not reload stream', 'rgba(180,60,60,0.92)', 2500);
            }
        }

        // Info (457) — show one-shot stream info panel.
        // Only fires when Stream Stats overlay is explicitly disabled — otherwise
        // Info is owned by the stats overlay and we'd be double-triggering.
        // Some remotes (55Q6QV projector, many Hisense projectors) have no Info
        // button at all, so Red is accepted as an alias when in the player and
        // the stats overlay is off.
        var inPlayerNow = (window.location.hash || '').indexOf('#/player/') === 0;
        var statsDisabled = localStorage.getItem('stremio_stream_stats') === 'false';
        var infoTriggered = (code === 457) || (code === 403 && inPlayerNow && statsDisabled);
        if (infoTriggered && statsDisabled) {
            var video = document.querySelector('video');
            if (!video) return;
            var info = document.getElementById('stream-info');
            if (info) { info.remove(); return; }
            info = document.createElement('div');
            info.id = 'stream-info';
            info.style.cssText = 'position:fixed;top:60px;left:14px;background:rgba(0,0,0,0.85);color:white;padding:16px 20px;border-radius:10px;font-size:13px;z-index:99999;font-family:monospace;min-width:260px;backdrop-filter:blur(4px);';
            var bufferedStr = 'N/A';
            try { if (video.buffered.length) bufferedStr = Math.round(video.buffered.end(video.buffered.length - 1)) + 's'; } catch(e) {}
            info.innerHTML = '<div style="font-weight:700;margin-bottom:8px;font-size:14px;">Stream Info</div>'
                + '<div>Resolution: ' + esc((video.videoWidth || '?') + 'x' + (video.videoHeight || '?')) + '</div>'
                + '<div>Duration: ' + Math.round(video.duration || 0) + 's</div>'
                + '<div>Buffered: ' + esc(bufferedStr) + '</div>'
                + '<div>Current: ' + Math.round(video.currentTime || 0) + 's</div>'
                + '<div>Paused: ' + video.paused + '</div>'
                + '<div>DV P7: ' + esc(window.__DV_PROFILE7_DETECTED__ || 'No') + '</div>';
            if (window.__VIDAA_CAPS__) {
                info.innerHTML += '<div style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.15);padding-top:8px;">'
                    + '<div style="font-weight:700;margin-bottom:4px;">VIDAA Device</div>'
                    + '<div>Model: ' + esc(window.__VIDAA_CAPS__.model || '?') + '</div>'
                    + '<div>Chipset: ' + esc(window.__VIDAA_CAPS__.chipset || '?') + '</div>'
                    + '<div>HDR: ' + esc(JSON.stringify(window.__VIDAA_CAPS__.hdrInfo || {})) + '</div>'
                    + '<div>Atmos: ' + esc(window.__VIDAA_CAPS__.dolbyAtmos || '?') + '</div>'
                    + '</div>';
            }
            if (window.__VIDAA_STATE__ && Object.keys(window.__VIDAA_STATE__).length > 0) {
                info.innerHTML += '<div style="margin-top:4px;">'
                    + '<div>DV: ' + esc(window.__VIDAA_STATE__.dolbyVision || 'N/A') + '</div>'
                    + '<div>HDR: ' + esc(window.__VIDAA_STATE__.hdr || 'N/A') + '</div>'
                    + '<div>Codec: ' + esc(window.__VIDAA_STATE__.videoCodec || 'N/A') + '</div>'
                    + '</div>';
            }
            document.body.appendChild(info);
            setTimeout(function() { if (info) info.remove(); }, 10000);
        }
    });
})();
