/* Video element preparation — preload, playsInline, warm-up fetch,
 * dynamic preconnect, and the stall strategies (detection itself lives in
 * the kernel's playback-health coordinator since P1.2).
 *
 * Root cause summary (Jellyfin + Plex + Stremio #2055 all confirm this):
 * the VIDAA (Opera-based) browser does NOT use the hardware HEVC decoder
 * path the native player uses. The <video> element reports HEVC support
 * via canPlayType, but actual decode is software-aided and can't sustain
 * 4K HEVC at 30-80 Mbps — especially not inside an MKV container. The
 * native player on the same chip plays the exact same file fine.
 *
 * So we do several things on every <video> the core creates:
 *   1. preload="auto"           — start buffering as soon as src lands
 *   2. playsInline               — avoid any fullscreen-transition delay
 *   3. preconnect to the actual stream host — RD CDN hostnames vary
 *      (xx-N.download.real-debrid.com) so the static hints in <head>
 *      can't miss; we add a dynamic one once we see the real URL
 *   4. HEAD/range warm-up fetch  — pull the first MB into the OS socket
 *      buffer before the video element asks for it, eliminating TLS
 *      slow-start on stream start
 *   5. stall strategies on the kernel coordinator — when playback stalls
 *      early (2+ waiting events in the first 20 s) and the user opted
 *      into an auto-native mode, hand the stream to the native player;
 *      otherwise, when the coordinator's inform phase fires, show the
 *      heavy-choice card / honest advice.
 */
(function() {
    var RT = window.__vidaaRuntime;
    var log = RT.logger('early-stall');
    var preconnectedOrigins = {};
    function addPreconnect(origin) {
        if (!origin || preconnectedOrigins[origin]) return;
        preconnectedOrigins[origin] = true;
        try {
            ['preconnect', 'dns-prefetch'].forEach(function(rel) {
                var l = document.createElement('link');
                l.rel = rel; l.href = origin;
                if (rel === 'preconnect') l.crossOrigin = 'anonymous';
                document.head.appendChild(l);
            });
        } catch(e) {}
    }

    function warmStreamHost(streamUrl) {
        if (!streamUrl || streamUrl.indexOf('blob:') === 0 || streamUrl.indexOf('magnet:') === 0) return;
        // WebTorrent stream URLs (torrents/webtorrent-streaming.js) are
        // same-origin <origin>/webtorrent/... served through the service
        // worker — preconnect is pointless and a warm-up fetch would
        // double-pull the torrent head.
        if (streamUrl.indexOf('/webtorrent/') !== -1) return;
        try {
            var u = new URL(streamUrl);
            addPreconnect(u.origin);
            // Fire-and-forget warm-up fetch. We read the first ~1 MB into the
            // socket buffer then cancel — the <video> element's subsequent
            // request benefits from the warmed TLS session + DNS cache.
            fetch(streamUrl, {
                method: 'GET',
                headers: { Range: 'bytes=0-1048575' },
                mode: 'cors',
                credentials: 'omit'
            }).then(function(r) {
                if (r.body && typeof r.body.cancel === 'function') r.body.cancel();
            }).catch(function() {});
        } catch(e) {}
    }

    // ── Stall strategies (kernel playback-health, P1.2) ──────────────
    // Detection used to live here (2+ waiting events in the first 20 s);
    // now the coordinator owns it and this patch only declares how to
    // RESPOND — one actor per stall episode instead of three racing ones.

    // Recover: opt-in early-stall handoff to the native player. Only the
    // FIRST invocation of an episode (a failed handoff must not retry
    // every 8 s); later invocations decline so auto-rebuffer can claim.
    if (RT.stall) {
        RT.stall.register({
            id: 'prep-handoff',
            phase: 'recover',
            priority: 300,
            type: 'early',
            when: function() {
                return RT.store.getBool('stremio_auto_native_player', false)
                    || RT.store.getBool('stremio_auto_native_player_mkv', false);
            },
            act: function(video, ep) {
                if (ep.invocation !== 1) return false;
                if (!window.__handoffAndRecover) return false;
                log('2+ early stalls, handing off to native player');
                try { video.pause(); } catch(e) {}
                window.__handoffAndRecover(video, video.currentSrc || video.src);
                return true;
            }
        });

        // Inform: the guidance UI (no auto action left). The heavy-choice
        // card when the stream analysis says "too heavy"; the honest note
        // when there is no server either.
        RT.stall.register({
            id: 'prep-guidance',
            phase: 'inform',
            priority: 200,
            type: '*',
            act: function(video) {
                var noServer = !RT.serverConfigured();
                var si = window.__STREAM_INFO__ || {};
                var src = (video.currentSrc || video.src || '').toLowerCase();
                var tooHeavy = si.oversize === true
                    || (si.width && si.width >= 3840) || (si.height && si.height >= 2160)
                    || src.indexOf('.mkv') !== -1;
                if (tooHeavy && typeof window.__heavyChoiceCardEnabled === 'function' && window.__heavyChoiceCardEnabled()
                    && typeof window.__showHeavyStreamChoiceCard === 'function') {
                    window.__showHeavyStreamChoiceCard();
                    return true;
                }
                if (noServer && typeof window.__honestStallEnabled === 'function' && window.__honestStallEnabled()
                    && typeof window.__showHonestStallMessage === 'function') {
                    // tooHeavy drives the copy — a stalling 1080p MP4 is not
                    // a 4K problem (P0.13).
                    window.__showHonestStallMessage({ tooHeavy: tooHeavy });
                    return true;
                }
                return false;
            }
        });
    }

    var seenSrcs = {};
    function onSrcChange(video) {
        var src = video.currentSrc || video.src || '';
        if (!src || seenSrcs[src]) return;
        seenSrcs[src] = true;
        warmStreamHost(src);
    }

    function prepareVideo(video) {
        if (!video || video.__v7Prepared) return;
        video.__v7Prepared = true;
        try {
            video.preload = 'auto';
            video.setAttribute('preload', 'auto');
            video.playsInline = true;
            video.setAttribute('playsinline', '');
        } catch(e) {}

        // Watch for src changes — the core may swap src multiple times per
        // player session (initial load, then the actual stream URL, then
        // possibly a segment URL for HLS).
        try {
            var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
            if (desc && desc.set && !video.__srcHooked) {
                var origSet = desc.set;
                Object.defineProperty(video, 'src', {
                    get: desc.get,
                    set: function(v) { origSet.call(this, v); setTimeout(function(){ onSrcChange(video); }, 0); },
                    configurable: true
                });
                video.__srcHooked = true;
            }
        } catch(e) {}

        // Also poll for currentSrc changes as a belt-and-braces fallback.
        // Clear the per-video poll when the core removes the element; otherwise
        // old player sessions keep running and hold removed video nodes in memory.
        video.__v7SrcPoll = setInterval(function() {
            if (!video.isConnected && !document.documentElement.contains(video)) {
                clearInterval(video.__v7SrcPoll);
                video.__v7SrcPoll = null;
                return;
            }
            onSrcChange(video);
        }, 2000);
        // Eagerly warm whatever's there now.
        setTimeout(function() { onSrcChange(video); }, 100);
    }

    document.querySelectorAll('video').forEach(prepareVideo);
    // Attachment watching goes through the kernel's ONE MutationObserver
    // since P1.6 (this patch used to own an always-on observer over the
    // whole DOM); the per-video src poll below remains as belt-and-braces.
    if (RT.dom && RT.dom.onVideoAdded) {
        RT.dom.onVideoAdded(prepareVideo);
    }

    window.__warmStreamHost = warmStreamHost;
})();
