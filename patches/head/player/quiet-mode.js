/* Quiet Player Mode toggle.
 *
 * During playback, the v7 patch layer historically ran ~15 always-on
 * setIntervals. Cumulatively they can steal enough CPU on a MediaTek
 * VIDAA SoC to starve the <video> element's decoder thread, causing the
 * classic "5 seconds of playback then buffer" pattern on high-bitrate 4K
 * streams. When this toggle is ON, every poller registered through the
 * runtime scheduler (window.__vidaaRuntime.poll) skips its tick while the
 * user is on a player route — see kernel/runtime.js. Safety-critical
 * timers (the freeze watchdog) and playback-critical watchers (magnet
 * interception, auto-native handoff, stall monitor, subtitle pickers) deliberately stay
 * live and are registered with quiet:false. The core Stremio intervals
 * are left alone.
 *
 * Off by default — only helps users who are actually buffering.
 */
(function() {
    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_quiet_player';
    function isEnabled() { return RT.store.getBool(LS_KEY, false); }

    // Public flag — read by the runtime poller scheduler (RT.poll).
    window.__isQuietPlayerModeActive = function() {
        if (!isEnabled()) return false;
        return (window.location.hash || '').indexOf('#/player/') === 0;
    };

    function applyQuiet() {
        window.__QUIET_PLAYER_ACTIVE__ = window.__isQuietPlayerModeActive();
    }
    applyQuiet();
    window.addEventListener('hashchange', applyQuiet);
    // Scheduler-owned since P1.4, quiet:false — this IS the quiet machinery;
    // it must never silence itself.
    RT.poll(applyQuiet, 2000, { quiet: false });

    // Register Settings toggle.
    RT.onRegistryReady(function() {
        window.__registerVidaaSettingsItem({
            id: 'quiet-player-toggle',
            type: 'toggle',
            label: 'Quiet Player Mode',
            description: 'Pauses the VIDAA layer’s background polling (server mirror and health checks, memory monitors, quality indicator refresh, subtitle persistence watchers, title cache) while a video is playing, freeing CPU for the video decoder. Playback-critical features keep running. Turn ON if streams buffer even with Real-Debrid.',
            lsKey: LS_KEY,
            defaultValue: false
        });
    });
})();
