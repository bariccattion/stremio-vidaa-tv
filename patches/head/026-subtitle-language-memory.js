// #7 — Remember subtitle language preference
// Stores the user's selected subtitle language and auto-selects matching track
// when a new video starts.
(function() {
    var LANG_KEY = 'stremio_subtitle_lang';

    function getSavedLang() {
        try { return localStorage.getItem(LANG_KEY) || null; } catch(e) { return null; }
    }

    var lastPlayerHash = '';
    var appliedForHash = '';

    setInterval(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) { lastPlayerHash = ''; return; }

        if (hash !== lastPlayerHash) {
            lastPlayerHash = hash;
            appliedForHash = '';
        }

        if (!window.core || typeof window.core.getState !== 'function') return;

        // Skip the expensive getState WASM bridge call once we've already
        // auto-selected a language for this player session. Saves CPU during
        // playback — the main reason this poller was stealing cycles on
        // MediaTek VIDAA SoCs.
        if (appliedForHash === lastPlayerHash) return;
        // Quiet Player Mode — user opted out of background pollers during
        // playback because their stream was buffering.
        if (window.__QUIET_PLAYER_ACTIVE__) return;

        window.core.getState('player').then(function(state) {
            if (!state) return;

            // Detect current subtitle selection and save it
            var currentLang = null;
            try {
                if (state.selectedSubtitleTrack) {
                    currentLang = state.selectedSubtitleTrack.lang || state.selectedSubtitleTrack.language || null;
                }
                // Also check subtitleTracks for the active one
                if (!currentLang && state.subtitleTracks && Array.isArray(state.subtitleTracks)) {
                    for (var i = 0; i < state.subtitleTracks.length; i++) {
                        if (state.subtitleTracks[i].selected || state.subtitleTracks[i].active) {
                            currentLang = state.subtitleTracks[i].lang || state.subtitleTracks[i].language;
                            break;
                        }
                    }
                }
            } catch(e) {}

            if (currentLang) {
                try { localStorage.setItem(LANG_KEY, currentLang); } catch(e) {}
            }

            // Auto-select saved language on new video (only once per player session)
            if (appliedForHash === lastPlayerHash) return;
            var savedLang = getSavedLang();
            if (!savedLang) return;

            var tracks = null;
            try { tracks = state.subtitleTracks; } catch(e) {}
            if (!tracks || !Array.isArray(tracks) || tracks.length === 0) return;

            // Find matching track
            for (var j = 0; j < tracks.length; j++) {
                var tLang = tracks[j].lang || tracks[j].language || '';
                if (tLang.toLowerCase() === savedLang.toLowerCase()) {
                    appliedForHash = lastPlayerHash;
                    try {
                        window.core.dispatch({
                            action: 'Player',
                            args: { action: 'SetProp', args: { propName: 'selectedSubtitleTrackId', propValue: tracks[j].id } }
                        }, 'player');
                        console.log('[subs] Auto-selected subtitle language:', savedLang, 'track:', tracks[j].id);
                    } catch(e) { console.log('[subs] Failed to auto-select subtitle:', e.message); }
                    return;
                }
            }
            // Partial match (e.g. "en" matches "eng")
            for (var k = 0; k < tracks.length; k++) {
                var tLang2 = (tracks[k].lang || tracks[k].language || '').toLowerCase();
                if (tLang2.indexOf(savedLang.toLowerCase().substring(0, 2)) === 0) {
                    appliedForHash = lastPlayerHash;
                    try {
                        window.core.dispatch({
                            action: 'Player',
                            args: { action: 'SetProp', args: { propName: 'selectedSubtitleTrackId', propValue: tracks[k].id } }
                        }, 'player');
                        console.log('[subs] Auto-selected subtitle (partial match):', tLang2, 'track:', tracks[k].id);
                    } catch(e) {}
                    return;
                }
            }
        }).catch(function() {});
    }, 3000);
})();
