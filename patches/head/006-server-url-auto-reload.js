// Mirror the core's streaming server URL to localStorage (all screens).
//
// The core is the source of truth: whenever profile.settings.streamingServerUrl
// changes (native Settings > Server > Edit URL, account profile sync, etc.),
// mirror it to localStorage + window.__STREMIO_SERVER_URL__ so the patch layer
// (health monitor, heartbeat, Green-key overlay) probes the right server and —
// critically — so the boot-time sync (patch 005) doesn't push a STALE
// localStorage URL back into the core and silently revert the user's change.
// The reload dispatch only fires for genuine user-visible changes; when the
// core merely caught up to what localStorage already had (patch 005 push at
// boot), writing would be a no-op and reloading would be redundant.
(function() {
    var lastKnownUrl = null;
    var watchDelay = 0;
    setInterval(function() {
        if (++watchDelay < 5) return; // Skip first 10 seconds to let server-sync finish
        if (!window.core) return;
        window.core.getState('ctx').then(function(state) {
            if (!state || !state.profile || !state.profile.settings) return;
            var url = state.profile.settings.streamingServerUrl;
            if (lastKnownUrl === null) { lastKnownUrl = url; return; }
            if (url !== lastKnownUrl) {
                lastKnownUrl = url;
                var stored = null;
                try { stored = localStorage.getItem('stremio_server_url'); } catch(e) {}
                window.__STREMIO_SERVER_URL__ = url;
                if (stored !== url) {
                    try { localStorage.setItem('stremio_server_url', url); } catch(e) {}
                    window.core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } }, 'streaming_server').then(function() {
                        console.log('[server-watch] URL changed ->', url, '; mirrored to localStorage; streaming server reloaded');
                    }).catch(function(e) {
                        console.error('[server-watch] Reload failed:', e);
                    });
                }
            }
        }).catch(function() {});
    }, 2000);
})();
