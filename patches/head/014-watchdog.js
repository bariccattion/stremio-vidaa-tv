// Watchdog — auto-recover from UI freeze
(function() {
    var log = window.__vidaaRuntime.logger('watchdog');
    window.__WATCHDOG_PAUSE__ = false;
    var lastTick = Date.now();
    setInterval(function() { lastTick = Date.now(); }, 1000);
    setInterval(function() {
        if (window.__WATCHDOG_PAUSE__) { lastTick = Date.now(); return; }
        if (Date.now() - lastTick > 15000) {
            log.error('UI freeze detected (>15s), reloading');
            location.reload();
        }
    }, 5000);
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            window.__WATCHDOG_PAUSE__ = true;
        } else {
            lastTick = Date.now();
            window.__WATCHDOG_PAUSE__ = false;
        }
    });
})();
