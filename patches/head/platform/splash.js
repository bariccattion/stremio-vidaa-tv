// Splash screen — remove when core is ready
(function() {
    var bar = document.getElementById('splash-bar');
    var progress = 0;
    var tick = setInterval(function() {
        progress = Math.min(progress + Math.random() * 15, 90);
        if (bar) bar.style.width = progress + '%';
    }, 400);
    var safetyTimer = null;
    var check = setInterval(function() {
        if (window.core && typeof window.core.getState === 'function') {
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
    }, 300);
    // Safety: remove after 30s regardless
    safetyTimer = setTimeout(function() {
        clearInterval(check);
        clearInterval(tick);
        var splash = document.getElementById('splash');
        if (splash) splash.remove();
    }, 30000);
})();
