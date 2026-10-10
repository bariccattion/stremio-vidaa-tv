// ═══════════════════════════════════════════════════════════════════════
// Torrent bandwidth saver (rewritten honestly, P0.8 2026-10-08).
// ═══════════════════════════════════════════════════════════════════════
// What this module ACTUALLY does: while a webtorrent stream plays, it
// cancels future piece selection for byte ranges the video has already
// played through — the client stops fetching pieces you skipped past.
// That saves BANDWIDTH; it does NOT free memory (webtorrent's in-memory
// chunk store keeps every downloaded piece until the torrent is
// destroyed at player exit — no browser API can evict it earlier).
//
// What was removed as dishonest/broken (see docs/PATCHES_VS_UPSTREAM.md
// P0.8): the maxConns override (it RAISED the streaming patch's
// deliberate 5 to 10 while claiming to reduce it — the client's
// connection policy belongs to torrents/webtorrent-streaming.js, which
// already drops maxWebConns to 2 under heap pressure), and the heap
// monitor (an exact duplicate of platform/memory-pressure.js: same
// 85 % threshold, log-only). The settings id/lsKey are unchanged so
// existing toggles and Safe Mode keep working; only the label and
// description now tell the truth.
(function() {
    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_low_memory';
    var log = RT.logger('memory');

    function isEnabled() {
        return RT.store.getBool(LS_KEY, true);
    }

    // Cancel future selection of pieces for played-through ranges (≥30 s
    // behind the playhead). Time→byte mapping assumes CBR within the
    // largest file — an approximation; deselecting a slightly wrong range
    // only wastes bandwidth, it can never corrupt playback.
    function deselectionSweep() {
        if (!isEnabled()) return;
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
                            log('Deselected pieces', startPiece, '-', endPiece, '(played through', Math.round(end), 's)');
                        }
                    }
                }
            });
        } catch (e) {
            log('Deselection sweep error:', e.message);
        }
    }

    function init() {
        if (!isEnabled()) {
            log('Torrent bandwidth saver disabled');
            return;
        }
        // Piece deselection sweep every 30 seconds (bandwidth only — see header)
        RT.poll(deselectionSweep, 30000, { quiet: true });
        log('Torrent bandwidth saver initialised');
    }

    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'low-memory-toggle',
            lsKey: LS_KEY,
            defaultValue: true,
            title: 'Skip Watched Torrent Pieces',
            description: 'While a torrent stream plays, stops downloading pieces for parts you already watched (skips re-fetching after seeking back). Saves bandwidth — it does not free memory: downloaded pieces stay cached until you leave the player.',
            onToggle: function(nowEnabled) {
                log('Toggled:', nowEnabled ? 'ON' : 'OFF');
            }
        });
    }

    init();
})();
