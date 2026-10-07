    window.__BUILD_COMMIT__ = 'b5e0f7d';
    // Register service worker with auto-update
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(function(reg) {
            reg.addEventListener('updatefound', function() {
                var newWorker = reg.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', function() {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            newWorker.postMessage('skipWaiting');
                            console.log('[sw] New version installed, refreshing...');
                            setTimeout(function() { location.reload(); }, 1000);
                        }
                    });
                }
            });
        }).catch(function() {});
    }
