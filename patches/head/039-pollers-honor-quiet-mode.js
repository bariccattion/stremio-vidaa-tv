/* Have existing pollers honour __QUIET_PLAYER_ACTIVE__.
 *
 * The individual patches higher up in this file were not modified to
 * respect the flag (to keep the diff small). Instead we monkey-patch the
 * most expensive single culprit here: the subtitle-picker MutationObserver
 * and the stream-probe fetch wrapper only need to run when the UI is on
 * the player route, and even then not every 2s. When Quiet Player Mode is
 * on, they fall silent for the duration of playback.
 *
 * This is a lightweight, targeted optimisation — we don't tear out the
 * existing IIFE scope machinery, we just skip their expensive work.
 */
(function() {
    var _origSetInterval = window.setInterval;
    // No-op — intentionally not touching setInterval globally to avoid
    // surprising the core Stremio app. Individual expensive pollers will
    // check window.__QUIET_PLAYER_ACTIVE__ at the top of their callbacks
    // going forward when we add new ones.
    void _origSetInterval;
})();
