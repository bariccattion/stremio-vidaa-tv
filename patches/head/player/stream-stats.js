(function() {
    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_stream_stats';
    var log = RT.logger('stats');
    var UPDATE_INTERVAL = 2000;
    var TOGGLE_KEY = 457; // Info/Display remote button

    function isEnabled() {
        return RT.store.getBool(LS_KEY, true);
    }

    var overlay = null;
    var updateInterval = null;
    var statsVisible = false; // starts hidden, press any color button to show
    var bytesAtLastCheck = 0;
    var timeAtLastCheck = 0;

    function createOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = '__stream-stats-overlay';
        overlay.style.cssText = 'position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.7);' +
            'color:#fff;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:12px;' +
            'z-index:99999;pointer-events:none;white-space:pre;line-height:1.5;';
        document.body.appendChild(overlay);
        log('Overlay created');
    }

    function removeOverlay() {
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        overlay = null;
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B/s';
        if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB/s';
        return (bytes / 1048576).toFixed(1) + ' MB/s';
    }

    function formatMB(bytes) {
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function getBufferHealth(video) {
        if (!video || !video.buffered || video.buffered.length === 0) return 0;
        var current = video.currentTime;
        for (var i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= current && current <= video.buffered.end(i)) {
                return video.buffered.end(i) - current;
            }
        }
        return 0;
    }

    function getBitrate(totalBytes) {
        var now = Date.now();
        if (!bytesAtLastCheck || !timeAtLastCheck) {
            bytesAtLastCheck = totalBytes;
            timeAtLastCheck = now;
            return 0;
        }
        var elapsed = (now - timeAtLastCheck) / 1000;
        if (elapsed < 1) return 0;
        var rate = (totalBytes - bytesAtLastCheck) / elapsed;
        bytesAtLastCheck = totalBytes;
        timeAtLastCheck = now;
        return rate;
    }

    function collectStatsLines(video) {
        var lines = [];

        // Resolution
        if (video) {
            var w = video.videoWidth, h = video.videoHeight;
            lines.push('Resolution : ' + (w && h ? w + 'x' + h : 'unknown'));
        } else {
            lines.push('Resolution : no video');
        }

        // Buffer health
        var bufferHealth = video ? getBufferHealth(video) : 0;
        lines.push('Buffer     : ' + bufferHealth.toFixed(1) + 's ahead');

        // WebTorrent stats
        var torrent = null;
        if (window.__webtorrentClient && window.__webtorrentClient.torrents &&
                window.__webtorrentClient.torrents.length > 0) {
            torrent = window.__webtorrentClient.torrents[0];
        }

        if (torrent) {
            var dlSpeed = torrent.downloadSpeed || 0;
            var peers = torrent.numPeers || 0;
            var downloaded = torrent.downloaded || 0;
            var bitrate = getBitrate(downloaded);

            lines.push('DL Speed   : ' + formatBytes(dlSpeed));
            lines.push('Peers      : ' + peers);
            lines.push('Bitrate    : ' + formatBytes(bitrate));
        } else {
            lines.push('DL Speed   : N/A (no torrent)');
            lines.push('Peers      : N/A');
            lines.push('Bitrate    : N/A');
        }

        // Memory
        if (performance.memory) {
            var used = performance.memory.usedJSHeapSize;
            var limit = performance.memory.jsHeapSizeLimit;
            lines.push('Memory     : ' + formatMB(used) + ' / ' + formatMB(limit));
        } else {
            lines.push('Memory     : unavailable');
        }

        return lines;
    }

    function updateStats() {
        if (!overlay || !statsVisible) return;
        overlay.textContent = collectStatsLines(document.querySelector('video')).join('\n');
    }

    function startUpdating() {
        if (updateInterval) return;
        createOverlay();
        // Start hidden — user presses a button to show
        if (overlay) overlay.style.display = 'none';
        statsVisible = false;
        updateInterval = RT.poll(updateStats, UPDATE_INTERVAL, { route: 'player', quiet: false });
        log('Stats overlay started');
    }

    function stopUpdating() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        removeOverlay();
        log('Stats overlay stopped');
    }

    function onHashChange() {
        if (!isEnabled()) return;
        if (RT.inPlayer()) {
            startUpdating();
        } else {
            stopUpdating();
        }
    }

    // Toggle with Info (457) or Red (403) — simple on/off, no auto-hide.
    // The `when` gate reads the toggle live, so the enable/disable machinery
    // around add/removeEventListener disappears.
    window.__vidaaKeys.on(['info', 'red'], function() {
        statsVisible = !statsVisible;
        if (overlay) overlay.style.display = statsVisible ? 'block' : 'none';
        log('Stats overlay', statsVisible ? 'shown' : 'hidden');
    }, { route: 'player', when: function() { return isEnabled(); } });

    function init() {
        if (!isEnabled()) {
            log('Stream stats overlay disabled (set localStorage stremio_stream_stats=true to enable)');
            return;
        }
        window.addEventListener('hashchange', onHashChange);
        onHashChange();
        log('Stream stats overlay initialised');
    }

    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'stream-stats-toggle',
            lsKey: LS_KEY,
            defaultValue: true,
            title: 'Stream Stats Overlay',
            description: 'Shows resolution, buffer health, download speed, peers, and memory in the player (toggle with Info button)',
            onToggle: function(nowEnabled) {
                log('Toggled:', nowEnabled ? 'ON' : 'OFF');
                if (nowEnabled) {
                    window.addEventListener('hashchange', onHashChange);
                    onHashChange();
                } else {
                    stopUpdating();
                    window.removeEventListener('hashchange', onHashChange);
                }
            }
        });
    }

    // Snapshot section of the unified diagnostics panel (044) — shares
    // collectStatsLines with the live in-player overlay.
    RT.when(function() { return !!window.__vidaaRegisterDiagnostic; }, function() {
        window.__vidaaRegisterDiagnostic({
            id: 'stats',
            label: 'Stream Stats',
            render: function(body) {
                var pre = document.createElement('div');
                pre.style.cssText = 'font-family:monospace;font-size:15px;line-height:1.8;color:#dfe2ff;white-space:pre;';
                pre.textContent = collectStatsLines(document.querySelector('video')).join('\n');
                body.appendChild(pre);
                var note = document.createElement('div');
                note.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.45);margin-top:10px;';
                note.textContent = 'Snapshot taken when this tab opened — the in-player overlay (Info/Red key during playback) updates live every 2s.';
                body.appendChild(note);
            }
        });
    });

    init();
})();
