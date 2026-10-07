// #8 — Fix subtitle size on start
// Stremio core resets subtitle size on each video load.
// This patch persists the user's subtitle size preference and force-applies it
// via setProp when the player initialises.
(function() {
    var SIZE_KEY = 'stremio_subtitle_size';

    function getSavedSize() {
        try { var v = parseInt(localStorage.getItem(SIZE_KEY), 10); return (v && v >= 50 && v <= 250) ? v : null; } catch(e) { return null; }
    }

    // Monitor subtitle size changes in core state and persist them
    var lastAppliedSize = null;
    var lastPlayerHash = '';

    setInterval(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) { lastPlayerHash = ''; return; }

        // On new player session, apply saved size
        if (hash !== lastPlayerHash) {
            lastPlayerHash = hash;
            lastAppliedSize = null;

            // Apply saved subtitle size after a short delay for core to initialise
            var savedSize = getSavedSize();
            if (savedSize !== null && window.core) {
                setTimeout(function() {
                    try {
                        window.core.dispatch({
                            action: 'Player',
                            args: { action: 'SetProp', args: { propName: 'subtitleSize', propValue: savedSize } }
                        }, 'player');
                        console.log('[subs] Applied saved subtitle size:', savedSize);
                        lastAppliedSize = savedSize;
                    } catch(e) { console.log('[subs] Failed to apply subtitle size:', e.message); }
                }, 2000);
            }
        }

        // Watch for user changes to subtitle size
        if (window.core && typeof window.core.getState === 'function') {
            window.core.getState('player').then(function(state) {
                if (!state) return;
                var size = null;
                // Try multiple paths where subtitle size might live
                try { size = state.subtitleSize || (state.settings && state.settings.subtitleSize); } catch(e) {}
                if (size && size >= 50 && size <= 250 && size !== lastAppliedSize) {
                    lastAppliedSize = size;
                    try { localStorage.setItem(SIZE_KEY, String(size)); } catch(e) {}
                }
            }).catch(function() {});
        }
    }, 3000);
})();
