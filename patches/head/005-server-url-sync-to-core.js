// Server URL sync — push ?server= URL into WASM core
(function() {
    var serverUrl = window.__STREMIO_SERVER_URL__;
    if (!serverUrl || serverUrl === 'http://127.0.0.1:11470') return;

    var attempts = 0;
    var interval = setInterval(function() {
        if (++attempts > 60) { clearInterval(interval); return; }
        if (!window.core) return;
        clearInterval(interval);

        window.core.getState('ctx').then(function(ctxState) {
            if (!ctxState || !ctxState.profile || !ctxState.profile.settings) return;
            var currentSettings = ctxState.profile.settings;
            if (currentSettings.streamingServerUrl === serverUrl) {
                console.log('[server-sync] URL already correct');
                return;
            }
            console.log('[server-sync] Syncing URL to WASM core:', serverUrl);
            var newSettings = {};
            for (var k in currentSettings) newSettings[k] = currentSettings[k];
            newSettings.streamingServerUrl = serverUrl;
            window.core.dispatch({ action: 'Ctx', args: { action: 'UpdateSettings', args: newSettings } }, 'ctx').then(function() {
                console.log('[server-sync] Settings updated, reloading streaming server');
                return window.core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } }, 'streaming_server');
            }).then(function() {
                console.log('[server-sync] Streaming server reloaded successfully');
            }).catch(function(e) {
                console.error('[server-sync] Error:', e);
            });
        }).catch(function(e) {
            console.error('[server-sync] Failed to get ctx state:', e);
        });
    }, 500);
})();
