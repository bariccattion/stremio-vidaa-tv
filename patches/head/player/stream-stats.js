(function() {
    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_stream_stats';
    var log = RT.logger('stats');
    var UPDATE_INTERVAL = 2000;
    var TOGGLE_KEY = 457; // Info/Display remote button

    function isEnabled() {
        return RT.store.getBool(LS_KEY, true);
    }

    // Cached current-video lookup through the kernel dom watcher (P1.6) —
    // falls back to a direct query when the watcher is absent.
    function currentVideo() {
        if (RT.dom && RT.dom.currentVideo) return RT.dom.currentVideo();
        return document.querySelector('video');
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

    // Pure helpers come from kernel/streams.js; getBitrate stays local —
    // it is stateful (keeps the last check point in this closure).
    var formatBytes = window.__vidaaStreams.formatBps;
    var formatMB = window.__vidaaStreams.formatMB;
    var formatGB = window.__vidaaStreams.formatGB;
    var formatMbps = window.__vidaaStreams.formatMbps;
    var getBufferHealth = window.__vidaaStreams.bufferHealth;

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

    // ── Verified stream facts (stats v2, P2.3) ─────────────────────
    // Pulled ONCE per new video src through the RT.core seam — never per
    // tick (the size-persist lesson): the selected stream's behaviorHints
    // carry videoHash/videoSize/filename (the exact fields the upstream
    // engine's videoParams wrapper consumes), plus infoHash/fileIdx for
    // torrent streams. The player state may also expose videoParams
    // directly — both shapes are read, belt-and-braces. Every field
    // renders from this cache; unknown stays "unknown" — no label
    // heuristics, no fabrication.
    var streamFacts = null;
    var factsForSrc = '';

    // Audio-track visibility (the honest half of the "server-side audio
    // picker" idea): the server's /tracks/ listing is REAL (wired by our
    // chunk-edit op4), so we can SHOW what audio a file carries — switching
    // server-side is NOT possible today (no selection param exists on the
    // official server; see docs/PATCHES_VS_UPSTREAM.md P2.3 BLOCKED note).
    // Fetched once per src, server-configured only, for probeable URLs.
    var audioTracks = null;

    function refreshAudioTracks(streamUrl) {
        if (audioTracks !== null || !streamUrl) return;
        audioTracks = null;
        var RTs = RT;
        if (!(RTs.serverConfigured && RTs.serverConfigured())) { audioTracks = 'unavailable'; return; }
        if (streamUrl.indexOf('http:') !== 0 && streamUrl.indexOf('https:') !== 0) { audioTracks = 'unavailable'; return; }
        RTs.fetchTimeout(window.__serverUrl.get() + '/tracks/' + encodeURIComponent(streamUrl), 10000)
            .then(function(r) {
                if (!r.ok) { audioTracks = 'unavailable'; return; }
                return r.json();
            })
            .then(function(list) {
                if (!Array.isArray(list)) { audioTracks = 'unavailable'; return; }
                var tracks = [];
                for (var i = 0; i < list.length; i++) {
                    var t = list[i];
                    if (!t || t.type !== 'audio') continue;
                    var label = t.lang || t.language || t.title || null;
                    var codec = t.codec ? String(t.codec) : null;
                    var ch = isFinite(t.channels) && t.channels ? (t.channels + 'ch') : null;
                    var parts = [];
                    if (label) parts.push(label);
                    if (codec) parts.push(codec);
                    if (ch) parts.push(ch);
                    tracks.push(parts.length ? parts.join(' ') : 'track ' + (tracks.length + 1));
                }
                audioTracks = tracks;
            })
            .catch(function() { audioTracks = 'unavailable'; });
    }

    function audioTracksValue() {
        if (audioTracks === 'unavailable') return 'listing unavailable (no server, or not probeable)';
        if (audioTracks === null) return null;   // still fetching
        if (!audioTracks.length) return '0 audio tracks listed';
        var summary = audioTracks.join(', ');
        if (summary.length > 58) summary = summary.substring(0, 55) + '…';
        return audioTracks.length + ' track' + (audioTracks.length === 1 ? '' : 's') + ' — ' + summary;
    }

    function refreshStreamFacts(video) {
        var src = (video && (video.currentSrc || video.src)) || '';
        if (src === factsForSrc) return;
        factsForSrc = src;
        streamFacts = null;
        audioTracks = null;   // re-probe per new stream
        if (!src || !(RT.core && RT.core.getState)) return;
        RT.core.getState('player').then(function(state) {
            var facts = { hash: null, size: null, filename: null, infoHash: null, fileIdx: null, streamUrl: null };
            try {
                var stream = state && state.stream;
                if (state && state.videoParams) {
                    facts.hash = state.videoParams.hash || null;
                    facts.size = state.videoParams.size || null;
                    facts.filename = state.videoParams.filename || null;
                }
                var bh = stream && stream.behaviorHints;
                if (bh) {
                    if (!facts.hash && bh.videoHash) facts.hash = bh.videoHash;
                    if (!facts.size && isFinite(bh.videoSize)) facts.size = bh.videoSize;
                    if (!facts.filename && bh.filename) facts.filename = bh.filename;
                }
                if (stream && stream.infoHash) facts.infoHash = stream.infoHash;
                if (stream && stream.fileIdx !== undefined) facts.fileIdx = stream.fileIdx;
                if (stream && typeof stream.url === 'string' && stream.url.indexOf('http') === 0) {
                    facts.streamUrl = stream.url;   // the ORIGINAL url — the right mediaURL for /tracks/
                }
            } catch (e) {}
            streamFacts = facts;
            // /tracks/ probes the ORIGINAL media URL — only meaningful when
            // one exists and the server is configured.
            if (facts.streamUrl && RT.serverConfigured && RT.serverConfigured()) {
                refreshAudioTracks(facts.streamUrl);
            } else {
                audioTracks = 'unavailable';
            }
        }).catch(function() {});
    }

    // What is actually feeding the <video> right now.
    function classifySource(src) {
        if (!src) return 'unknown';
        if (src.indexOf('/webtorrent/') !== -1) return 'webtorrent (service worker)';
        if (src.indexOf('/hlsv2/') !== -1) return 'streaming server (transcoded)';
        if (src.indexOf('magnet:') === 0) return 'magnet (intercepted)';
        if (src.indexOf('http:') === 0 || src.indexOf('https:') === 0) return 'direct link';
        if (src.indexOf('blob:') === 0) return 'blob';
        return 'other';
    }

    function droppedFrames(video) {
        if (video && typeof video.getVideoPlaybackQuality === 'function') {
            try {
                var q = video.getVideoPlaybackQuality();
                if (q) return { dropped: q.droppedVideoFrames, total: q.totalVideoFrames };
            } catch (e) {}
        }
        return null;
    }

    function pad(label) {
        while (label.length < 11) label += ' ';
        return label;
    }

    function collectStatsLines(video) {
        var lines = [];
        var src = (video && (video.currentSrc || video.src)) || '';
        refreshStreamFacts(video);

        // Resolution (from the element — the decode truth, not the label)
        if (video) {
            var w = video.videoWidth, h = video.videoHeight;
            lines.push(pad('Resolution') + ': ' + (w && h ? w + 'x' + h : 'unknown'));
        } else {
            lines.push(pad('Resolution') + ': no video');
        }
        lines.push(pad('Source') + ': ' + classifySource(src));

        // Verified stream facts (hash may be an OpenSubtitles hash or a
        // torrent infoHash; torrent info wins the display when present).
        var hash = (streamFacts && (streamFacts.hash || streamFacts.infoHash)) || null;
        var size = (streamFacts && streamFacts.size) || null;
        var filename = (streamFacts && streamFacts.filename) || null;
        lines.push(pad('Hash') + ': ' + (hash ? (String(hash).substring(0, 16) + (String(hash).length > 16 ? '…' : '')) : 'unknown'));
        lines.push(pad('Size') + ': ' + (size != null ? formatGB(size) : 'unknown'));
        if (filename) {
            var fn = String(filename);
            lines.push(pad('File') + ': ' + (fn.length > 42 ? fn.substring(0, 39) + '…' : fn));
        }

        // Codec/container intel (dv-hdr's probe tap fills __STREAM_INFO__
        // for server streams; direct links stay honestly 'unknown').
        var si = window.__STREAM_INFO__ || {};
        lines.push(pad('Codec') + ': ' + (si.videoCodec || 'unknown')
            + (si.width && si.height ? (' @ ' + si.width + 'x' + si.height) : ''));

        // Audio-track visibility from the server's /tracks/ listing (the
        // switchable-picker half is BLOCKED upstream — no server param).
        var audioValue = audioTracksValue();
        if (audioValue) lines.push(pad('Audio') + ': ' + audioValue);

        // Buffer health + how much of the file is ahead of the playhead
        var bufferHealth = video ? getBufferHealth(video) : 0;
        lines.push(pad('Buffer') + ': ' + bufferHealth.toFixed(1) + 's ahead');
        if (video && video.duration && isFinite(video.duration) && video.buffered && video.buffered.length) {
            var pct = Math.min(100, Math.round((video.buffered.end(video.buffered.length - 1) / video.duration) * 100));
            lines.push(pad('Buffered') + ': ' + pct + '% of ' + Math.round(video.duration) + 's');
        }

        // Average bitrate estimate — only when the verified size and the
        // real duration are both known; labelled as an estimate.
        var est = formatMbps(size && video && video.duration ? (size * 8) / video.duration : null);
        if (est) lines.push(pad('Avg bitrate') + ': ' + est + ' (est.)');

        // Dropped frames (Chromium playback quality API)
        var q = droppedFrames(video);
        if (q) lines.push(pad('Frames') + ': ' + q.dropped + ' dropped / ' + q.total);

        // WebTorrent live stats
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

            lines.push(pad('DL Speed') + ': ' + formatBytes(dlSpeed));
            lines.push(pad('Peers') + ': ' + peers);
            lines.push(pad('Bitrate') + ': ' + formatBytes(bitrate));
        }

        // Memory
        if (performance.memory) {
            var used = performance.memory.usedJSHeapSize;
            var limit = performance.memory.jsHeapSizeLimit;
            lines.push(pad('Memory') + ': ' + formatMB(used) + ' / ' + formatMB(limit));
        } else {
            lines.push(pad('Memory') + ': unavailable');
        }

        return lines;
    }

    // Test/panel seam: the same lines the overlay renders.
    window.__getStreamStatsLines = collectStatsLines;

    function updateStats() {
        if (!overlay || !statsVisible) return;
        overlay.textContent = collectStatsLines(currentVideo()).join('\n');
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
            description: 'In-player overlay (Info/Red key) with VERIFIED stream facts — source type, video hash, file size and name from the selected stream, codec when the server probe answers, buffer health and coverage, estimated average bitrate, dropped frames — plus live torrent stats and memory. Unknown fields say "unknown"; nothing is guessed from labels.',
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
                pre.textContent = collectStatsLines(currentVideo()).join('\n');
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
