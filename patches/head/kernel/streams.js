// ═══════════════════════════════════════════════════════════════════════
// VIDAA streams kernel — shared stream-label conventions and formatters.
//
// Stremio addon streams carry their metadata in the human-readable label
// (resolution, codec, container, debrid markers, size). Two features
// classify those labels — the auto-play scorer (autoplay-best.js) and the
// heavy-stream helper (heavy-stream-help.js) — so the primitives live here
// once. Predicates use word-boundary regexes (the stricter variant); the
// scorer's looser indexOf ladder is deliberate scoring behavior and stays
// local to autoplay-best.js.
//
// Global: window.__vidaaStreams. Feature-check before use, like every
// kernel module.
(function() {
    var S = {};
    window.__vidaaStreams = S;

    // The canonical text every label heuristic runs against.
    S.text = function(s) {
        return ((s.title || '') + ' ' + (s.name || '') + ' ' + (s.description || '')).toLowerCase();
    };

    // "2.4 GB" / "800 MB" inside a stream label → GB (null when absent).
    S.parseSizeGB = function(t) {
        var m = String(t || '').match(/([\d.]+)\s*(gb|mb)/i);
        if (!m) return null;
        var gb = parseFloat(m[1]);
        return m[2].toLowerCase() === 'mb' ? gb / 1024 : gb;
    };

    // ── label predicates (word-boundary regexes) ─────────────────────
    S.is4k = function(t) { return /2160p|\b4k\b|uhd/.test(t); };
    S.isMkv = function(t) { return /\.mkv\b|matroska/.test(t); };
    S.isMp4 = function(t) { return /\.mp4\b|\bmp4\b/.test(t); };
    S.isH264 = function(t) { return /x264|h\.?264|avc/.test(t); };
    S.isHevc = function(t) { return /hevc|x265|h\.?265/.test(t); };

    // ── throughput / size formatting (stats overlay, diagnostics) ────
    S.formatBps = function(bytes) {
        if (bytes < 1024) return bytes + ' B/s';
        if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB/s';
        return (bytes / 1048576).toFixed(1) + ' MB/s';
    };
    S.formatMB = function(bytes) { return (bytes / 1048576).toFixed(1) + ' MB'; };
    // Human file size: GB with two decimals below 10, one above (stats v2).
    S.formatGB = function(bytes) {
        if (bytes == null || !isFinite(bytes)) return 'unknown';
        var gb = bytes / 1073741824;
        if (gb < 1) return (bytes / 1048576).toFixed(0) + ' MB';
        return gb.toFixed(gb < 10 ? 2 : 1) + ' GB';
    };
    // Bits per second → Mbps (avg-bitrate estimates in the stats overlay).
    S.formatMbps = function(bitsPerSec) {
        if (bitsPerSec == null || !isFinite(bitsPerSec) || bitsPerSec <= 0) return null;
        return (bitsPerSec / 1000000).toFixed(1) + ' Mbps';
    };

    // Seconds of buffer ahead of the playhead (0 when unknown).
    S.bufferHealth = function(video) {
        if (!video || !video.buffered || video.buffered.length === 0) return 0;
        var current = video.currentTime;
        for (var i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= current && current <= video.buffered.end(i)) {
                return video.buffered.end(i) - current;
            }
        }
        return 0;
    };
})();
