/* Quiet Player Mode toggle.
 *
 * During playback, the v7 patch layer runs ~15 setIntervals and a
 * MutationObserver. Cumulatively they can steal enough CPU on a
 * MediaTek VIDAA SoC to starve the <video> element's decoder thread,
 * causing the classic "5 seconds of playback then buffer" pattern on
 * high-bitrate 4K streams. When this toggle is ON, all OUR polling
 * intervals that respect `window.__QUIET_PLAYER_ACTIVE__` will skip
 * their tick while the user is on a player route. The core Stremio
 * intervals are left alone.
 *
 * Off by default — only helps users who are actually buffering.
 */
(function() {
    var LS_KEY = 'stremio_quiet_player';
    function isEnabled() { return localStorage.getItem(LS_KEY) === 'true'; }

    // Public flag — checked by other patches' poll ticks.
    window.__isQuietPlayerModeActive = function() {
        if (!isEnabled()) return false;
        return (window.location.hash || '').indexOf('#/player/') === 0;
    };

    function applyQuiet() {
        window.__QUIET_PLAYER_ACTIVE__ = window.__isQuietPlayerModeActive();
    }
    applyQuiet();
    window.addEventListener('hashchange', applyQuiet);
    setInterval(applyQuiet, 2000);

    // Register Settings toggle.
    var reg = setInterval(function() {
        if (!window.__registerVidaaSettingsItem) return;
        clearInterval(reg);
        window.__registerVidaaSettingsItem({
            id: 'quiet-player-toggle',
            type: 'toggle',
            label: 'Quiet Player Mode',
            description: 'Pauses background checks (server health, memory poll, subtitle DOM scan, quality indicator refresh, DV stall watch) while a video is playing. Frees CPU for the video decoder. Turn ON if streams buffer even with Real-Debrid.',
            lsKey: LS_KEY,
            defaultValue: false
        });
    }, 200);
})();
