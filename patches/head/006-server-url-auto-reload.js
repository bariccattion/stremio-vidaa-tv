// Auto-reload streaming server when URL changes in Settings UI
(function() {
    var lastKnownUrl = null;
    var watchDelay = 0;
    setInterval(function() {
        if (++watchDelay < 5) return; // Skip first 10 seconds to let server-sync finish
        if (!window.core) return;
        if ((window.location.hash || '').indexOf('#/settings') !== 0) return;
        window.core.getState('ctx').then(function(state) {
            if (!state || !state.profile || !state.profile.settings) return;
            var url = state.profile.settings.streamingServerUrl;
            if (lastKnownUrl === null) { lastKnownUrl = url; return; }
            if (url !== lastKnownUrl) {
                console.log('[server-watch] URL changed:', lastKnownUrl, '->', url);
                lastKnownUrl = url;
                window.__STREMIO_SERVER_URL__ = url;
                try { localStorage.setItem('stremio_server_url', url); } catch(e) {}
                window.core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } }, 'streaming_server').then(function() {
                    console.log('[server-watch] Streaming server reloaded');
                }).catch(function(e) {
                    console.error('[server-watch] Reload failed:', e);
                });
            }
        }).catch(function() {});
    }, 2000);
})();
