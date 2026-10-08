// Memory pressure monitoring
(function() {
    if (typeof performance === 'undefined' || !performance.memory) return;
    var RT = window.__vidaaRuntime;
    var log = RT.logger('memory');
    RT.poll(function() {
        var h = RT.heapPressure();
        if (!h) return;
        var pct = Math.round((h.used / h.limit) * 100);
        if (pct > 85) {
            log.warn('High usage: ' + Math.round(h.used / 1048576) + 'MB / ' + Math.round(h.limit / 1048576) + 'MB (' + pct + '%)');
        }
    }, 30000, { quiet: true });
})();
