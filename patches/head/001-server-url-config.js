    // Configurable streaming server URL
    // Usage: ?server=http://192.168.1.50:11470
    // Saved to localStorage so you only need to pass it once.
    (function() {
        var params = new URLSearchParams(window.location.search);
        var server = params.get('server');
        if (server) {
            server = server.replace(/\/+$/, '');
            localStorage.setItem('stremio_server_url', server);
        }
        window.__STREMIO_SERVER_URL__ = localStorage.getItem('stremio_server_url') || 'http://127.0.0.1:11470';
    })();
