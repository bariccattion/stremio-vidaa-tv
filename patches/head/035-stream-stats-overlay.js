(function() {
    var LS_KEY = 'stremio_stream_stats';
    var PREFIX = '[stats]';
    var UPDATE_INTERVAL = 2000;
    var TOGGLE_KEY = 457; // Info/Display remote button

    function isEnabled() {
        return localStorage.getItem(LS_KEY) !== 'false';
    }

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift(PREFIX);
        console.log.apply(console, args);
    }

    function inPlayerRoute() {
        return window.location.hash.indexOf('#/player/') !== -1;
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

    function updateStats() {
        if (!overlay || !statsVisible) return;

        var video = document.querySelector('video');
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

        overlay.textContent = lines.join('\n');
    }

    function startUpdating() {
        if (updateInterval) return;
        createOverlay();
        // Start hidden — user presses a button to show
        if (overlay) overlay.style.display = 'none';
        statsVisible = false;
        updateInterval = setInterval(updateStats, UPDATE_INTERVAL);
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
        if (inPlayerRoute()) {
            startUpdating();
        } else {
            stopUpdating();
        }
    }

    function onKeyDown(e) {
        if (!isEnabled()) return;
        if (!inPlayerRoute()) return;
        // Toggle with Info (457) or Red (403) — simple on/off, no auto-hide
        if (e.keyCode === 457 || e.keyCode === 403) {
            e.stopPropagation();
            statsVisible = !statsVisible;
            if (overlay) overlay.style.display = statsVisible ? 'block' : 'none';
            log('Stats overlay', statsVisible ? 'shown' : 'hidden');
        }
    }

    function init() {
        if (!isEnabled()) {
            log('Stream stats overlay disabled (set localStorage stremio_stream_stats=true to enable)');
            return;
        }
        window.addEventListener('hashchange', onHashChange);
        window.addEventListener('keydown', onKeyDown);
        onHashChange();
        log('Stream stats overlay initialised');
    }

    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'stream-stats-toggle',
            lsKey: LS_KEY,
            title: 'Stream Stats Overlay',
            description: 'Shows resolution, buffer health, download speed, peers, and memory in the player (toggle with Info button)',
            onToggle: function(nowEnabled) {
                log('Toggled:', nowEnabled ? 'ON' : 'OFF');
                if (nowEnabled) {
                    window.addEventListener('hashchange', onHashChange);
                    window.addEventListener('keydown', onKeyDown);
                    onHashChange();
                } else {
                    stopUpdating();
                    window.removeEventListener('hashchange', onHashChange);
                    window.removeEventListener('keydown', onKeyDown);
                }
            }
        });
    }

    init();
})();
