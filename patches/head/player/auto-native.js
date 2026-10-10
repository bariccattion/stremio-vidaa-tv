/* Auto Native Player — two modes.
 *
 * Root cause: the VIDAA webview (Opera-based) mis-handles the MKV
 * container. The same HEVC stream inside MP4 or HLS plays cleanly —
 * the Jellyfin project independently identified and patched this on
 * their web frontend. Real-Debrid links are overwhelmingly MKV for
 * anything 4K HDR/DV, which is exactly when the webview buffers.
 *
 * The native VIDAA player (reached via omi_platform.sendPlatformMessage)
 * uses the hardware MediaTek decoder and handles MKV fine. Two toggles,
 * recommended to try in this order:
 *
 *   1. "Auto Native Player for MKV only"  (recommended)
 *      Lets MP4/HLS streams play in the browser (subtitles/stream
 *      switching work) and hands MKV streams off to native. Targets
 *      the exact container issue without giving up Stremio features
 *      unnecessarily.
 *
 *   2. "Auto Native Player" (all streams)
 *      Nuclear option — every stream goes to native, regardless of
 *      container. Use if mode 1 still buffers, or if your streams
 *      are all MKV anyway.
 *
 * Both are off by default on non-VIDAA devices via the hasNative gate.
 */
(function() {
    var RT = window.__vidaaRuntime;
    var log = RT.logger('auto-native');
    var LS_KEY_ALL = 'stremio_auto_native_player';
    var LS_KEY_MKV = 'stremio_auto_native_player_mkv';
    function modeAll() { return RT.store.getBool(LS_KEY_ALL, false); }
    function modeMkvOnly() { return RT.store.getBool(LS_KEY_MKV, false); }

    function hasNative() { return !!window.__hasNativePlayer && window.__hasNativePlayer(); }

    function isMkvUrl(url) {
        if (!url) return false;
        // Match .mkv anywhere in the URL path (before a query string).
        // RD URLs typically look like:
        //   https://xx.download.real-debrid.com/d/HASH/Name.4K.HDR.x265.mkv
        // Also catches .mkv.torrent-like variants, but those are rare.
        var pathPart = url.split('?')[0].toLowerCase();
        return pathPart.indexOf('.mkv') !== -1;
    }

    function shouldHandoff(url) {
        if (!url) return false;
        if (url.indexOf('blob:') === 0) return false;      // WebTorrent streams (legacy blob)
        if (url.indexOf('magnet:') === 0) return false;    // raw magnet
        // WebTorrent stream URLs (torrents/webtorrent-streaming.js):
        // <origin>/webtorrent/... served by the app service worker — the TV's
        // native player app can't fetch them (it isn't controlled by the SW),
        // so handing off just breaks playback.
        if (url.indexOf('/webtorrent/') !== -1) return false;
        if (url.indexOf('http:') !== 0 && url.indexOf('https:') !== 0) return false;
        if (modeAll()) return true;
        if (modeMkvOnly() && isMkvUrl(url)) return true;
        return false;
    }

    // Player-entry watcher: must run on every route (handoff decisions
    // happen on entry), and auto-native handoff stays live in Quiet
    // Player Mode — hence no route gate and quiet:false. The URL memo is
    // the kernel's SHARED one (P1.3): any launch path's attempt is
    // respected here, and a failed attempt clears it for a retry.
    RT.poll(function() {
        if (!modeAll() && !modeMkvOnly()) return;
        if (!RT.inPlayer()) { window.__nativeHandoff.clearLastUrl(); return; }
        if (!hasNative()) return;

        var video = document.querySelector('video');
        if (!video) return;

        var src = video.currentSrc || video.src || '';
        if (!shouldHandoff(src)) return;
        if (src === window.__nativeHandoff.lastUrl()) return;

        // Give the browser a moment to resolve the final src (some players
        // set a blob: then swap to the real URL).
        if (video.readyState < 1) return;

        window.__nativeHandoff.setLastUrl(src);
        log('Handing off to native player:', src.substring(0, 100));

        // Pause the browser player to free the decoder before we launch the native one.
        try { video.pause(); } catch(e) {}
        // H5: act on the verified result — the wrapper un-pauses and advises
        // on failure; allow re-attempt on the next src by clearing the memo.
        // (A duplicate launch while one is in flight resolves false
        // immediately — the kernel guard, P1.3.)
        if (window.__handoffAndRecover) {
            window.__handoffAndRecover(video, src, function(opened) {
                if (!opened) window.__nativeHandoff.clearLastUrl();
            });
        }
    }, 1500, { quiet: false });

    RT.onRegistryReady(function() {
        window.__registerVidaaSettingsItem({
            id: 'auto-native-mkv-toggle',
            type: 'toggle',
            label: 'Auto Native Player for MKV',
            description: 'Recommended for projector owners. The VIDAA webview struggles with MKV containers (the container — not the codec — is the actual cause of 4K buffering on Real-Debrid). When ON, any MKV stream opens in the VIDAA native player with the hardware decoder. MP4 and HLS streams still play in the browser so Stremio subtitles work.',
            lsKey: LS_KEY_MKV,
            defaultValue: false
        });
        window.__registerVidaaSettingsItem({
            id: 'auto-native-player-toggle',
            type: 'toggle',
            label: 'Auto Native Player (all streams)',
            description: 'Nuclear option — open every stream in the VIDAA native player regardless of container. Use only if "Auto Native Player for MKV" alone is not enough. Stremio subtitles will not transfer and you cannot switch streams mid-play.',
            lsKey: LS_KEY_ALL,
            defaultValue: false
        });
    });
})();
