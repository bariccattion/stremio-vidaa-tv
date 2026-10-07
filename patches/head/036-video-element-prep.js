/* Video element preparation — preload, playsInline, warm-up fetch,
 * dynamic preconnect, and early-stall auto-handoff.
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
 *      can miss; we add a dynamic one once we see the real URL
 *   4. HEAD/range warm-up fetch  — pull the first MB into the OS socket
 *      buffer before the video element asks for it, eliminating TLS
 *      slow-start on stream start
 *   5. early-stall auto-handoff  — if the browser <video> issues 2+
 *      `waiting` events in the first 20 seconds of playback, hand the
 *      stream to the native player. This catches the exact "5 seconds
 *      in, then stall forever" pattern reporters describe.
 */
(function() {
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
        // WebTorrent stream URLs (patch 031) are same-origin <origin>/webtorrent/...
        // served through the service worker — preconnect is pointless and a
        // warm-up fetch would double-pull the torrent head.
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

    function armEarlyStallWatch(video) {
        if (video.__earlyStallArmed) return;
        video.__earlyStallArmed = true;
        var playStart = 0;
        var stalls = 0;
        video.addEventListener('playing', function() {
            if (!playStart) playStart = Date.now();
        });
        function onStall() {
            if (!playStart) return;                   // never actually started
            if (Date.now() - playStart > 20000) return; // only care about early stalls
            stalls++;
            console.warn('[early-stall] waiting/stalled event #' + stalls);
            if (stalls >= 2 && typeof window.__launchNativePlayer === 'function') {
                var inPlayer = (window.location.hash || '').indexOf('#/player/') === 0;
                if (!inPlayer) return;
                // Only auto-handoff when the user has opted into either auto-native
                // mode. Otherwise log the hint and let the user handle it.
                var allOn = localStorage.getItem('stremio_auto_native_player') === 'true';
                var mkvOn = localStorage.getItem('stremio_auto_native_player_mkv') === 'true';
                if (!allOn && !mkvOn) {
                    console.log('[early-stall] stream is stalling; user has no auto-native toggle on — no silent handoff');
                    // No auto-handoff path. Offer the user a CHOICE — never block,
                    // skip, or auto-change the stream. Detect "too heavy" from the
                    // probe data and/or the current source container.
                    var srvUrlE = window.__STREMIO_SERVER_URL__ || '';
                    var noServer = !srvUrlE || srvUrlE === 'http://127.0.0.1:11470';
                    var si = window.__STREAM_INFO__ || {};
                    var src = (video.currentSrc || video.src || '').toLowerCase();
                    var tooHeavy = si.oversize === true
                        || (si.width && si.width >= 3840) || (si.height && si.height >= 2160)
                        || src.indexOf('.mkv') !== -1;
                    // Prefer the richer, actionable choice card when it's enabled.
                    if (tooHeavy && typeof window.__heavyChoiceCardEnabled === 'function' && window.__heavyChoiceCardEnabled()
                        && typeof window.__showHeavyStreamChoiceCard === 'function') {
                        window.__showHeavyStreamChoiceCard();
                    } else if (noServer && typeof window.__honestStallEnabled === 'function' && window.__honestStallEnabled()
                        && typeof window.__showHonestStallMessage === 'function') {
                        // Fallback: the plain honest note (if the user turned the card off).
                        window.__showHonestStallMessage();
                    }
                    return;
                }
                console.log('[early-stall] 2+ early stalls, handing off to native player');
                try { video.pause(); } catch(e) {}
                // H5: act on the VERIFIED result. The launcher resolves a boolean
                // reflecting whether the native app actually foregrounded. On
                // failure we MUST un-pause the browser video (best-effort resume)
                // and surface honest advice — never leave a frozen, paused player.
                Promise.resolve(window.__launchNativePlayer(video.currentSrc || video.src)).then(function(opened) {
                    if (!opened && typeof window.__recoverAfterFailedHandoff === 'function') {
                        window.__recoverAfterFailedHandoff(video);
                    }
                });
            }
        }
        video.addEventListener('waiting', onStall);
        video.addEventListener('stalled', onStall);
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
        armEarlyStallWatch(video);

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
    var mo = new MutationObserver(function(muts) {
        for (var i = 0; i < muts.length; i++) {
            var added = muts[i].addedNodes || [];
            for (var j = 0; j < added.length; j++) {
                var n = added[j];
                if (!n || n.nodeType !== 1) continue;
                if (n.nodeName === 'VIDEO') prepareVideo(n);
                var nested = (n.querySelectorAll ? n.querySelectorAll('video') : []);
                for (var k = 0; k < nested.length; k++) prepareVideo(nested[k]);
            }
        }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    window.__warmStreamHost = warmStreamHost;
})();
