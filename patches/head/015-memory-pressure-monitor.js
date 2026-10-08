// Memory pressure monitoring
(function() {
    if (typeof performance === 'undefined' || !performance.memory) return;
    var RT = window.__vidaaRuntime;
    var log = RT.logger('memory');
    RT.poll(function() {
        var used = performance.memory.usedJSHeapSize;
        var limit = performance.memory.jsHeapSizeLimit;
        var pct = Math.round((used / limit) * 100);
        if (pct > 85) {
            log.warn('High usage: ' + Math.round(used/1048576) + 'MB / ' + Math.round(limit/1048576) + 'MB (' + pct + '%)');
        }
    }, 30000, { quiet: true });
})();
