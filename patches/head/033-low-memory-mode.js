(function() {
    var LS_KEY = 'stremio_low_memory';
    var PREFIX = '[memory]';
    var MEM_WARN_THRESHOLD = 0.85; // 85% heap usage triggers warning

    function isEnabled() {
        return localStorage.getItem(LS_KEY) !== 'false';
    }

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift(PREFIX);
        console.log.apply(console, args);
    }

    function applyLowMemoryConfig() {
        // Set global flag for other patches
        window.__lowMemoryMode = true;
        log('Low memory mode active — setting __lowMemoryMode flag');

        // Reduce WebTorrent buffer if client is available
        if (window.__webtorrentClient) {
            try {
                if (window.__webtorrentClient.maxConns !== undefined) {
                    window.__webtorrentClient.maxConns = 10;
                    log('Reduced WebTorrent maxConns to 10');
                }
            } catch (e) {
                log('Could not modify webtorrentClient config:', e.message);
            }
        }
    }

    function deselectionSweep() {
        if (!window.__webtorrentClient) return;
        try {
            var torrents = window.__webtorrentClient.torrents;
            if (!torrents || !torrents.length) return;
            torrents.forEach(function(torrent) {
                if (!torrent || !torrent.pieces) return;
                var video = document.querySelector('video');
                if (!video || !video.duration) return;
                var played = video.played;
                if (!played || played.length === 0) return;

                // Find the largest file (likely the video file)
                var file = null;
                if (torrent.files && torrent.files.length) {
                    for (var f = 0; f < torrent.files.length; f++) {
                        if (!file || torrent.files[f].length > file.length) {
                            file = torrent.files[f];
                        }
                    }
                }
                if (!file) return;

                var pieceLength = torrent.pieceLength;
                if (!pieceLength) return;
                var fileOffset = file.offset || 0;
                var totalPieces = torrent.pieces.length;

                // Estimate byte position from time position
                var bytesPerSec = file.length / video.duration;

                for (var i = 0; i < played.length; i++) {
                    var end = played.end(i);
                    // Only deselect ranges well behind current playback (30s buffer)
                    if (end < video.currentTime - 30) {
                        var startByte = fileOffset + Math.floor(played.start(i) * bytesPerSec);
                        var endByte = fileOffset + Math.floor(end * bytesPerSec);
                        var startPiece = Math.floor(startByte / pieceLength);
                        var endPiece = Math.floor(endByte / pieceLength);
                        startPiece = Math.max(0, startPiece);
                        endPiece = Math.min(totalPieces - 1, endPiece);
                        if (endPiece > startPiece && torrent.deselect) {
                            torrent.deselect(startPiece, endPiece, false);
                            log('Deselected pieces', startPiece, '-', endPiece, '(played up to', Math.round(end), 's)');
                        }
                    }
                }
            });
        } catch (e) {
            log('Deselection sweep error:', e.message);
        }
    }

    function monitorMemory() {
        if (!performance.memory) return;
        var used = performance.memory.usedJSHeapSize;
        var total = performance.memory.jsHeapSizeLimit;
        if (total > 0 && (used / total) > MEM_WARN_THRESHOLD) {
            log('WARNING: High memory usage —', Math.round(used / 1048576), 'MB used of',
                Math.round(total / 1048576), 'MB limit (', Math.round((used / total) * 100), '%)');
        }
    }

    function init() {
        if (!isEnabled()) {
            log('Low memory mode disabled (set localStorage stremio_low_memory=true to enable)');
            return;
        }
        applyLowMemoryConfig();
        // Re-apply config when WebTorrent client becomes available
        var clientCheckInterval = setInterval(function() {
            if (window.__webtorrentClient) {
                applyLowMemoryConfig();
                clearInterval(clientCheckInterval);
            }
        }, 2000);
        // Memory monitoring every 10 seconds
        setInterval(monitorMemory, 10000);
        // Piece deselection sweep every 30 seconds
        setInterval(deselectionSweep, 30000);
        log('Low memory mode initialised');
    }

    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'low-memory-toggle',
            lsKey: LS_KEY,
            title: 'Low Memory Mode',
            description: 'Reduces buffer sizes and cleans up played torrent pieces to prevent buffering on low-RAM TVs',
            onToggle: function(nowEnabled) {
                log('Toggled:', nowEnabled ? 'ON' : 'OFF');
                if (nowEnabled) {
                    window.__lowMemoryMode = true;
                    applyLowMemoryConfig();
                } else {
                    window.__lowMemoryMode = false;
                }
            }
        });
    }

    init();
})();
