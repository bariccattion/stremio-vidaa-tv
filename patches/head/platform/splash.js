// Splash screen — remove when core is ready.
// Scheduler-owned timers since P1.4 (quiet:false — the boot signal must
// never be silenced; Quiet Mode can only be active on the player route
// anyway, which is not where a splash lives).
(function() {
    var RT = window.__vidaaRuntime;
    function coreUsable() {
        if (RT && typeof RT.coreUsable === 'function') return RT.coreUsable();
        return !!(window.core && typeof window.core.getState === 'function');
    }
    var bar = document.getElementById('splash-bar');
    var progress = 0;
    var tick = RT.poll(function() {
        progress = Math.min(progress + Math.random() * 15, 90);
        if (bar) bar.style.width = progress + '%';
    }, 400, { quiet: false });
    var safetyTimer = null;
    var check = RT.poll(function() {
        if (coreUsable()) {
            clearInterval(check);
            clearInterval(tick);
            if (safetyTimer) clearTimeout(safetyTimer);
            if (bar) bar.style.width = '100%';
            setTimeout(function() {
                var splash = document.getElementById('splash');
                if (splash) {
                    splash.style.transition = 'opacity 0.3s';
                    splash.style.opacity = '0';
                    setTimeout(function() { splash.remove(); }, 300);
                }
            }, 200);
        }
    }, 300, { quiet: false });
    // Safety: remove after 30s regardless
    safetyTimer = setTimeout(function() {
        clearInterval(check);
        clearInterval(tick);
        var splash = document.getElementById('splash');
        if (splash) splash.remove();
    }, 30000);
})();
