// Watchdog — auto-recover from UI freeze.
// KERNEL-FREE BY DESIGN (P1.9): raw setIntervals and a plain console
// logger with the uniform [vidaa:watchdog] prefix — this guard must keep
// running even if the kernel (runtime.js) itself failed to boot, so it
// takes no __vidaaRuntime dependency at all.
// Pauses: (a) on visibilitychange→hidden (normal backgrounding), and
// (b) during native-handoff verification (kernel/native-player.js sets
// __WATCHDOG_PAUSE__ — some VIDAA firmware backgrounds the page for >15 s
// without ever firing visibilitychange, which would otherwise read as a
// freeze and reload mid-handoff).
(function() {
    function fmt(args) {
        var out = ['[vidaa:watchdog]'];
        for (var i = 0; i < args.length; i++) out.push(args[i]);
        return out;
    }
    function log() { try { console.log.apply(console, fmt(arguments)); } catch (e) {} }
    function logError() { try { console.error.apply(console, fmt(arguments)); } catch (e) {} }

    window.__WATCHDOG_PAUSE__ = false;
    var lastTick = Date.now();
    setInterval(function() { lastTick = Date.now(); }, 1000);
    setInterval(function() {
        if (window.__WATCHDOG_PAUSE__) { lastTick = Date.now(); return; }
        if (Date.now() - lastTick > 15000) {
            logError('UI freeze detected (>15s), reloading');
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
