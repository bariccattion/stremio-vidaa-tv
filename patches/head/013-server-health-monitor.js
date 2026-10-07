// Server health monitoring
(function() {
    window.__SERVER_HEALTH__ = { status: 'unknown', latency: null, version: null };

    function makeTimeoutSignal(ms) {
        try {
            if (typeof AbortController !== 'undefined') {
                var ctrl = new AbortController();
                setTimeout(function() { ctrl.abort(); }, ms);
                return ctrl.signal;
            }
        } catch(e) {}
        return undefined;
    }

    function checkHealth() {
        if ((window.location.hash || '').indexOf('#/player/') === 0) return;
        var url = window.__STREMIO_SERVER_URL__;
        if (!url) return;
        var signal = makeTimeoutSignal(5000);
        var start = Date.now();
        fetch(url + '/settings', { signal: signal }).then(function(r) {
            return r.json();
        }).then(function(data) {
            window.__SERVER_HEALTH__ = {
                status: 'online',
                latency: Date.now() - start,
                version: data.serverVersion || data.version || null
            };
        }).catch(function() {
            var start2 = Date.now();
            fetch(url + '/heartbeat', { signal: makeTimeoutSignal(5000) }).then(function() {
                window.__SERVER_HEALTH__ = { status: 'online', latency: Date.now() - start2, version: null };
            }).catch(function() {
                window.__SERVER_HEALTH__ = { status: 'offline', latency: null, version: null };
            });
        });
    }

    setInterval(checkHealth, 10000);
    setTimeout(checkHealth, 3000);
})();
