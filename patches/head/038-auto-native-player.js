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
    var LS_KEY_ALL = 'stremio_auto_native_player';
    var LS_KEY_MKV = 'stremio_auto_native_player_mkv';
    function modeAll() { return localStorage.getItem(LS_KEY_ALL) === 'true'; }
    function modeMkvOnly() { return localStorage.getItem(LS_KEY_MKV) === 'true'; }

    function hasNative() {
        try { return typeof omi_platform !== 'undefined' && typeof omi_platform.sendPlatformMessage === 'function'; } catch(e) { return false; }
    }

    function inPlayerRoute() {
        return (window.location.hash || '').indexOf('#/player/') === 0;
    }

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
        if (url.indexOf('blob:') === 0) return false;      // WebTorrent streams
        if (url.indexOf('magnet:') === 0) return false;    // raw magnet
        if (url.indexOf('http:') !== 0 && url.indexOf('https:') !== 0) return false;
        if (modeAll()) return true;
        if (modeMkvOnly() && isMkvUrl(url)) return true;
        return false;
    }

    var lastHandedOffUrl = '';
    setInterval(function() {
        if (!modeAll() && !modeMkvOnly()) return;
        if (!inPlayerRoute()) { lastHandedOffUrl = ''; return; }
        if (!hasNative()) return;

        var video = document.querySelector('video');
        if (!video) return;

        var src = video.currentSrc || video.src || '';
        if (!shouldHandoff(src)) return;
        if (src === lastHandedOffUrl) return;

        // Give the browser a moment to resolve the final src (some players
        // set a blob: then swap to the real URL).
        if (video.readyState < 1) return;

        lastHandedOffUrl = src;
        console.log('[auto-native] Handing off to native player:', src.substring(0, 100));

        // Pause the browser player to free the decoder before we launch the native one.
        try { video.pause(); } catch(e) {}
        if (window.__launchNativePlayer) {
            // H5: act on the verified result. If the native player did not
            // actually open, un-pause and resume browser playback so we never
            // leave the user with a silently-frozen paused video. Also allow
            // re-attempt on the next src by clearing lastHandedOffUrl.
            Promise.resolve(window.__launchNativePlayer(src)).then(function(opened) {
                if (!opened) {
                    lastHandedOffUrl = '';
                    if (typeof window.__recoverAfterFailedHandoff === 'function') {
                        window.__recoverAfterFailedHandoff(video);
                    }
                }
            });
        }
    }, 1500);

    var reg = setInterval(function() {
        if (!window.__registerVidaaSettingsItem) return;
        clearInterval(reg);
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
    }, 200);
})();
