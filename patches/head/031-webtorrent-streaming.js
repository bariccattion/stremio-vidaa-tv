// #16 — WebTorrent in-browser torrent streaming (Experimental)
// Intercepts magnet: URIs from torrent addons and streams them via the pinned,
// vendored webtorrent 3.0.21 (upstream/vendor/webtorrent/3.0.21) using its
// service-worker streaming server: file.streamTo() progressive playback —
// the first frame plays long before the file finishes downloading. The old
// getBlobURL() primary path buffered the ENTIRE file into RAM before playing
// (2 GB movie = OOM) and is gone.
//
// Streaming requires our app service worker (it importScripts the webtorrent
// worker — a fetch event only reaches the SW controlling the page, so a
// separate registration would displace the app shell worker).
//
// Honest failure story, per the 040-honest-stall precedent: ~30 s at 0 peers →
// dismissible card ("no WebRTC-capable peers — isn't web-seeded; use debrid or
// a streaming server") instead of an eternal "Connecting to peers...".
// Settings toggle in Settings page, status overlay in player.
(function() {
    'use strict';

    var LS_KEY = 'stremio_webtorrent_enabled';
    var LOG_PREFIX = '[torrent]';
    var MAX_BUFFER_MB = 100;
    var OVERLAY_HIDE_DELAY = 10000;
    var PEER_STALL_TIMEOUT = 30000;
    var TRACKERS = [
        'wss://tracker.webtorrent.dev',
        'wss://open.ftorrent.com'
    ];

    // ─── State ────────────────────────────────────────────────────
    var clientLoaded = false;
    var clientLoading = false;
    var activeTorrent = null;
    var overlayEl = null;
    var overlayTimer = null;
    var statsInterval = null;
    var lastInterceptedSrc = '';
    var swRegistration = null;
    var peerStallTimer = null;
    var stallCardEl = null;

    function isEnabled() {
        try { return localStorage.getItem(LS_KEY) === 'true'; } catch(e) { return false; }
    }

    function setEnabled(val) {
        try { localStorage.setItem(LS_KEY, val ? 'true' : 'false'); } catch(e) {}
    }

    function log() {
        var args = [LOG_PREFIX];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    // ─── Library Loader (vendored + pinned, same origin — no CDN) ──
    function loadWebTorrentLib(cb) {
        if (window.WebTorrent) { clientLoaded = true; cb(null); return; }
        if (clientLoading) {
            var waitCount = 0;
            var waitId = setInterval(function() {
                waitCount++;
                if (window.WebTorrent) { clearInterval(waitId); clientLoaded = true; cb(null); }
                else if (waitCount > 100) { clearInterval(waitId); cb(new Error('Timeout loading WebTorrent')); }
            }, 200);
            return;
        }
        clientLoading = true;
        log('Loading vendored WebTorrent library...');
        var s = document.createElement('script');
        s.src = './webtorrent.min.js';
        s.onload = function() {
            clientLoading = false;
            if (window.WebTorrent) {
                clientLoaded = true;
                log('WebTorrent library loaded successfully');
                cb(null);
            } else {
                cb(new Error('webtorrent.min.js evaluated but window.WebTorrent missing'));
            }
        };
        s.onerror = function() {
            clientLoading = false;
            log('Failed to load vendored WebTorrent library');
            cb(new Error('Failed to load webtorrent.min.js'));
        };
        document.head.appendChild(s);
    }

    // ─── Service Worker Streaming Server ──────────────────────────
    // file.streamTo/streamURL require client.createServer({ controller: reg })
    // with the app shell's service worker registration (patch 004 registers
    // './sw.js'; the webtorrent worker is importScripts'd inside it).
    function ensureStreamingServer(cb) {
        if (!navigator.serviceWorker) {
            cb(new Error('ServiceWorker unsupported in this browser'));
            return;
        }
        navigator.serviceWorker.ready.then(function(reg) {
            swRegistration = reg;
            var client = getClient();
            if (!client) { cb(new Error('Cannot create WebTorrent client')); return; }
            if (client._server) { cb(null); return; }
            try {
                client.createServer({ controller: reg });
                log('Streaming server created');
                cb(null);
            } catch(e) {
                log('createServer failed:', e.message);
                cb(e);
            }
        }).catch(function(err) {
            log('serviceWorker.ready failed:', err && err.message);
            cb(err);
        });
    }

    // ─── Client Management ────────────────────────────────────────
    function getClient() {
        if (window.__webtorrentClient && !window.__webtorrentClient.destroyed) {
            return window.__webtorrentClient;
        }
        if (!window.WebTorrent) return null;
        log('Creating new WebTorrent client');
        window.__webtorrentClient = new window.WebTorrent({
            maxConns: 5,
            tracker: { announce: TRACKERS }
        });
        window.__webtorrentClient.on('error', function(err) {
            log('Client error:', err.message);
        });
        return window.__webtorrentClient;
    }

    function destroyClient() {
        if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
        cancelPeerStallWatchdog();
        if (activeTorrent) {
            try { activeTorrent.destroy(); } catch(e) {}
            activeTorrent = null;
        }
        if (window.__webtorrentClient) {
            try { if (window.__webtorrentClient._server) window.__webtorrentClient._server.close(); } catch(e) {}
            try { window.__webtorrentClient.destroy(); } catch(e) {}
            window.__webtorrentClient = null;
        }
        removeOverlay();
        log('Client destroyed and cleaned up');
    }

    // ─── Overlay ──────────────────────────────────────────────────
    function createOverlay() {
        if (overlayEl) return overlayEl;
        overlayEl = document.createElement('div');
        overlayEl.id = 'webtorrent-overlay';
        overlayEl.style.cssText = 'position:fixed;bottom:60px;left:16px;background:rgba(0,0,0,0.75);color:#fff;font-family:PlusJakartaSans,monospace;font-size:0.8rem;padding:8px 14px;border-radius:8px;z-index:99999;pointer-events:none;transition:opacity 0.3s;opacity:1;max-width:350px;';
        overlayEl.textContent = 'Connecting to peers...';
        document.body.appendChild(overlayEl);
        scheduleOverlayHide();
        return overlayEl;
    }

    function removeOverlay() {
        if (overlayEl) {
            try { overlayEl.remove(); } catch(e) {}
            overlayEl = null;
        }
        if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
    }

    function scheduleOverlayHide() {
        if (overlayTimer) clearTimeout(overlayTimer);
        overlayTimer = setTimeout(function() {
            if (overlayEl) overlayEl.style.opacity = '0';
        }, OVERLAY_HIDE_DELAY);
    }

    function showOverlay() {
        if (overlayEl) {
            overlayEl.style.opacity = '1';
            scheduleOverlayHide();
        }
    }

    function updateOverlayStats(torrent) {
        if (!overlayEl || !torrent) return;
        var dlSpeed = (torrent.downloadSpeed / (1024 * 1024)).toFixed(1);
        var peers = torrent.numPeers || 0;
        var progress = Math.round((torrent.progress || 0) * 100);
        var ulSpeed = (torrent.uploadSpeed / (1024 * 1024)).toFixed(1);
        overlayEl.textContent = '\u2193 ' + dlSpeed + ' MB/s | ' + peers + ' peers | ' + progress + '% buffered' + (parseFloat(ulSpeed) > 0 ? ' | \u2191 ' + ulSpeed + ' MB/s' : '');
        overlayEl.style.opacity = '1';
    }

    // ─── Honest Failure Card ──────────────────────────────────────
    // 040-honest-stall pattern: small dismissible corner card with a
    // focusable button — never a fullscreen trap, never auto-skip. No
    // autofocus (would hijack D-pad navigation on TV remotes); auto-removes.
    function showHonestCard(text) {
        removeStallCard();
        var card = document.createElement('div');
        card.id = 'webtorrent-honest-card';
        card.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;font-family:PlusJakartaSans,sans-serif;font-size:0.9rem;line-height:1.45;padding:14px 18px;border-radius:10px;z-index:99999;max-width:420px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.5);';
        card.textContent = text;
        var btn = document.createElement('button');
        btn.textContent = 'Dismiss';
        btn.setAttribute('tabindex', '0');
        btn.style.cssText = 'display:block;margin:10px auto 0;padding:6px 18px;background:#7b5bf5;color:#fff;border:none;border-radius:6px;font-family:inherit;font-size:0.85rem;cursor:pointer;';
        btn.onclick = removeStallCard;
        card.appendChild(btn);
        document.body.appendChild(card);
        stallCardEl = card;
        setTimeout(function() { removeStallCard(); }, 14000);
    }

    function removeStallCard() {
        if (stallCardEl) {
            try { stallCardEl.remove(); } catch(e) {}
            stallCardEl = null;
        }
    }

    // ─── Peer-Stall Watchdog ──────────────────────────────────────
    // Raw torrents without web seeds (and with only non-WebRTC peers) can
    // never connect from a browser. Say so after ~30 s instead of letting the
    // overlay lie with "Connecting to peers..." forever. Cancels itself the
    // moment any peer connects — late recovery always wins.
    function armPeerStallWatchdog() {
        cancelPeerStallWatchdog();
        peerStallTimer = setTimeout(function() {
            peerStallTimer = null;
            if (!activeTorrent || activeTorrent.destroyed) return;
            if ((activeTorrent.numPeers || 0) > 0) return;
            log('No peers after ' + (PEER_STALL_TIMEOUT / 1000) + 's — torrent is not web-seeded');
            if (overlayEl) {
                overlayEl.textContent = 'No peers \u2014 not web-seeded';
                overlayEl.style.opacity = '1';
            }
            showHonestCard("This torrent has no WebRTC-capable peers \u2014 it isn't web-seeded. Use debrid or a streaming server.");
        }, PEER_STALL_TIMEOUT);
    }

    function cancelPeerStallWatchdog() {
        if (peerStallTimer) { clearTimeout(peerStallTimer); peerStallTimer = null; }
        removeStallCard();
    }

    // ─── Magnet Detection & Streaming ─────────────────────────────
    function isMagnet(url) {
        return typeof url === 'string' && url.indexOf('magnet:') === 0;
    }

    function showDisabledMessage() {
        var existing = document.getElementById('webtorrent-disabled-msg');
        if (existing) return;
        var msg = document.createElement('div');
        msg.id = 'webtorrent-disabled-msg';
        msg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:99999;';
        msg.innerHTML = '<div style="text-align:center;max-width:500px;padding:32px;">' +
            '<div style="font-size:1.5rem;color:#fff;font-family:PlusJakartaSans,sans-serif;font-weight:700;margin-bottom:16px;">Torrent Stream Detected</div>' +
            '<div style="color:#aaa;font-size:1rem;line-height:1.5;font-family:PlusJakartaSans,sans-serif;margin-bottom:24px;">This stream requires torrent support. Enable <span style="color:#7b5bf5;font-weight:600;">Direct Torrent Streaming</span> in Settings, or use Real-Debrid / a streaming server.</div>' +
            '<div style="color:#666;font-size:0.85rem;font-family:PlusJakartaSans,sans-serif;">Press Back to return.</div>' +
            '</div>';
        document.body.appendChild(msg);
        // Remove on back/hash change
        var removeMsg = function() {
            try { msg.remove(); } catch(e) {}
            window.removeEventListener('hashchange', removeMsg);
        };
        window.addEventListener('hashchange', removeMsg);
        // Also remove on Back key (keyCode 8 or 461)
        var keyHandler = function(e) {
            if (e.keyCode === 8 || e.keyCode === 461 || e.keyCode === 10009) {
                removeMsg();
                document.removeEventListener('keydown', keyHandler, true);
            }
        };
        document.addEventListener('keydown', keyHandler, true);
    }

    function streamMagnet(magnetURI, videoEl) {
        log('Streaming magnet:', magnetURI.substring(0, 80) + '...');
        loadWebTorrentLib(function(err) {
            if (err) {
                log('Cannot stream — library failed to load');
                showDisabledMessage();
                return;
            }
            ensureStreamingServer(function(err) {
                if (err) {
                    log('Cannot start streaming server:', err.message);
                    if (overlayEl) overlayEl.textContent = 'Torrent streaming unavailable';
                    showHonestCard('Torrent streaming is not available in this browser. Use debrid or a streaming server.');
                    return;
                }
                var client = getClient();

                // Destroy previous torrent if any
                if (activeTorrent) {
                    try { activeTorrent.destroy(); } catch(e) {}
                    activeTorrent = null;
                }

                createOverlay();
                overlayEl.textContent = 'Connecting to peers...';

                // Check if torrent already added
                var existing = client.get(magnetURI);
                if (existing) {
                    handleTorrent(existing, videoEl);
                    return;
                }

                // client.add returns the torrent synchronously — keep a
                // reference so cleanup and the stall watchdog cover the
                // metadata phase too, not just post-ready.
                var torrent = client.add(magnetURI, {
                    announce: TRACKERS,
                    strategy: 'sequential'
                }, function(t) {
                    handleTorrent(t, videoEl);
                });
                activeTorrent = torrent;
                armPeerStallWatchdog();
            });
        });
    }

    function handleTorrent(torrent, videoEl) {
        activeTorrent = torrent;
        armPeerStallWatchdog();
        log('Torrent ready:', torrent.name, '| Files:', torrent.files.length);

        // Find largest file (the video)
        var videoFile = torrent.files[0];
        for (var i = 1; i < torrent.files.length; i++) {
            if (torrent.files[i].length > videoFile.length) {
                videoFile = torrent.files[i];
            }
        }
        log('Selected file:', videoFile.name, '(' + Math.round(videoFile.length / 1048576) + ' MB)');

        // Deselect all files, then select only the video file for sequential download
        torrent.files.forEach(function(f) { try { f.deselect(); } catch(e) {} });
        try { videoFile.select(); } catch(e) {}

        // Progressive streaming — first frame long before the file completes.
        function streamFailed(err) {
            if (err) log('Streaming failed:', err.message);
            if (overlayEl) overlayEl.textContent = "Can't stream this file";
            showHonestCard("Can't stream this file in the TV browser (codec/container). Try another source, or use debrid / a streaming server.");
        }
        try {
            if (typeof videoFile.streamTo === 'function') {
                videoFile.streamTo(videoEl, function(err) {
                    if (err) { streamFailed(err); return; }
                    log('Streaming started via streamTo');
                    videoEl.play().catch(function() {});
                });
            } else if (videoFile.streamURL) {
                log('streamTo unavailable — falling back to streamURL');
                videoEl.src = videoFile.streamURL;
                videoEl.play().catch(function() {});
            } else {
                streamFailed(new Error('no streamTo/streamURL on file'));
            }
        } catch(e) {
            streamFailed(e);
        }

        // Stats overlay update + peer recovery + memory pressure
        if (statsInterval) clearInterval(statsInterval);
        statsInterval = setInterval(function() {
            if (!activeTorrent || activeTorrent.destroyed) {
                clearInterval(statsInterval);
                statsInterval = null;
                return;
            }
            updateOverlayStats(torrent);

            // Peers showed up after the honest message — revert to live stats.
            if ((torrent.numPeers || 0) > 0) cancelPeerStallWatchdog();

            // Memory pressure check
            try {
                if (performance && performance.memory && performance.memory.usedJSHeapSize) {
                    var usedMB = performance.memory.usedJSHeapSize / 1048576;
                    if (usedMB > MAX_BUFFER_MB * 3) {
                        log('Memory pressure detected (' + Math.round(usedMB) + 'MB), reducing connections');
                        if (torrent.maxWebConns > 2) torrent.maxWebConns = 2;
                    }
                }
            } catch(e) {}
        }, 2000);

        torrent.on('error', function(err) {
            log('Torrent error:', err.message);
        });

        torrent.on('done', function() {
            log('Torrent download complete');
            if (overlayEl) overlayEl.textContent = 'Download complete | Seeding';
        });
    }

    // ─── Video Source Interception ─────────────────────────────────
    // Poll for video element src changes — more reliable on VIDAA than MutationObserver
    setInterval(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) return;

        var video = document.querySelector('video');
        if (!video) return;

        var src = video.currentSrc || video.src || '';
        if (!src || src === lastInterceptedSrc) return;
        if (!isMagnet(src)) return;

        lastInterceptedSrc = src;
        log('Magnet URI detected in video source');

        if (!isEnabled()) {
            showDisabledMessage();
            return;
        }

        // Clear the invalid magnet src from video element
        video.pause();
        video.removeAttribute('src');
        video.load();

        streamMagnet(src, video);
    }, 500);

    // Also try to intercept via core state
    setInterval(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) return;
        try {
            var state = window.core && window.core.getState('player');
            if (!state) return;
            var streamUrl = null;
            if (state.stream && state.stream.url) streamUrl = state.stream.url;
            else if (state.stream && state.stream.infoHash) {
                // Torrent stream detected via infoHash — construct magnet
                streamUrl = 'magnet:?xt=urn:btih:' + state.stream.infoHash;
                if (state.stream.fileIdx !== undefined) streamUrl += '&so=' + state.stream.fileIdx;
            }
            if (!streamUrl || !isMagnet(streamUrl)) return;
            if (streamUrl === lastInterceptedSrc) return;

            lastInterceptedSrc = streamUrl;
            log('Magnet/infoHash detected in core state');

            var video = document.querySelector('video');
            if (!video) return;

            if (!isEnabled()) {
                showDisabledMessage();
                return;
            }

            video.pause();
            video.removeAttribute('src');
            video.load();

            streamMagnet(streamUrl, video);
        } catch(e) {}
    }, 1000);

    // ─── Cleanup on Navigation Away from Player ───────────────────
    var wasInPlayer = false;
    setInterval(function() {
        var hash = window.location.hash || '';
        var inPlayer = hash.indexOf('#/player/') === 0;
        if (wasInPlayer && !inPlayer) {
            log('Left player — cleaning up');
            destroyClient();
            lastInterceptedSrc = '';
        }
        wasInPlayer = inPlayer;
    }, 1000);

    // ─── Info / Red Button Shows Overlay ──────────────────────────
    // Some Hisense projector remotes (55Q6QV, M2 Pro, PX3-Pro, C2) have no
    // Info / Display button at all — only the four colour keys. Accept Red
    // (403) as an alias so those users can still see the torrent stats.
    document.addEventListener('keydown', function(e) {
        if (!activeTorrent) return;
        var isInfo = e.keyCode === 457 || e.keyCode === 73;
        var isRed = e.keyCode === 403;
        if (!isInfo && !isRed) return;
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) return;
        showOverlay();
    }, true);

    // ─── Settings Toggle Registration ────────────────────────────────
    // Register with the unified VIDAA settings tab system
    var wtRegInterval = setInterval(function() {
        if (!window.__registerVidaaSettingsItem) return;
        clearInterval(wtRegInterval);
        window.__registerVidaaSettingsItem({
            id: 'webtorrent-toggle',
            type: 'toggle',
            label: 'Torrent Streaming',
            description: 'Stream magnet links directly in the browser via WebTorrent',
            lsKey: LS_KEY,
            onToggle: function(nowEnabled) {
                setEnabled(nowEnabled);
                log('WebTorrent toggled:', nowEnabled ? 'ON' : 'OFF');
                if (nowEnabled && !clientLoaded) {
                    loadWebTorrentLib(function(err) {
                        if (err) log('Failed to pre-load library');
                    });
                }
            }
        });
        log('WebTorrent registered with VIDAA settings tab');
    }, 200);

    // ─── Programmatic API ─────────────────────────────────────────
    window.__toggleWebTorrent = function() {
        var nowEnabled = !isEnabled();
        setEnabled(nowEnabled);
        log('WebTorrent toggled programmatically:', nowEnabled ? 'ON' : 'OFF');
        if (nowEnabled && !clientLoaded) {
            loadWebTorrentLib(function(err) {
                if (err) log('Failed to pre-load library');
            });
        }
        return nowEnabled;
    };

    window.__getWebTorrentStatus = function() {
        return {
            enabled: isEnabled(),
            libraryLoaded: clientLoaded,
            clientActive: !!(window.__webtorrentClient && !window.__webtorrentClient.destroyed),
            activeTorrent: activeTorrent ? {
                name: activeTorrent.name,
                progress: Math.round((activeTorrent.progress || 0) * 100),
                downloadSpeed: activeTorrent.downloadSpeed,
                peers: activeTorrent.numPeers
            } : null
        };
    };

    log('WebTorrent patch loaded (enabled:', isEnabled(), ')');
})();
