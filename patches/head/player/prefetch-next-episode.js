// #15 — Prefetch next episode
// When the user is watching an episode, extract the next episode info and fire
// a background fetch to warm the streaming server cache, reducing load time
// when they advance to the next episode.
(function() {
    var RT = window.__vidaaRuntime;
    var log = RT.logger('prefetch');
    var prefetchedUrl = '';
    var lastPlayerHash = '';

    // Quiet Player Mode (scheduler-level) skips the prefetch entirely — the
    // background fetch competes with the main stream's bandwidth.
    RT.poll(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) { lastPlayerHash = ''; prefetchedUrl = ''; return; }
        if (hash === lastPlayerHash) return;
        lastPlayerHash = hash;
        prefetchedUrl = '';

        // Wait for video to be playing for a bit before prefetching
        setTimeout(function() {
            if (!(RT.core && RT.core.getState)) return;

            RT.core.getState('player').then(function(state) {
                if (!state) return;

                // Look for next video/episode info in player state
                var nextVideo = null;
                try {
                    if (state.nextVideo) nextVideo = state.nextVideo;
                    else if (state.seriesInfo && state.seriesInfo.nextVideo) nextVideo = state.seriesInfo.nextVideo;
                    else if (state.nextEpisode) nextVideo = state.nextEpisode;
                } catch(e) {}

                if (!nextVideo) {
                    log('No next episode data found');
                    return;
                }

                // Extract stream URL for next episode
                var nextUrl = null;
                try {
                    if (nextVideo.stream && nextVideo.stream.url) nextUrl = nextVideo.stream.url;
                    else if (nextVideo.url) nextUrl = nextVideo.url;
                    else if (nextVideo.deepLinks && nextVideo.deepLinks.player) {
                        // We can navigate to this to load it, but for prefetch we need
                        // to trigger the streaming server to prepare the stream
                        var serverUrl = window.__STREMIO_SERVER_URL__;
                        if (serverUrl && serverUrl !== 'http://127.0.0.1:11470') {
                            // Try to construct a prefetch hint URL for the server
                            log('Next episode available via deepLink:', nextVideo.deepLinks.player);
                        }
                    }
                } catch(e) {}

                if (nextUrl && nextUrl !== prefetchedUrl) {
                    prefetchedUrl = nextUrl;
                    log('Warming cache for next episode:', nextUrl.substring(0, 80));

                    // Fire a HEAD request to warm the streaming server cache
                    // This triggers the server to start fetching/preparing the stream
                    try {
                        fetch(nextUrl, {
                            method: 'HEAD',
                            mode: 'no-cors'
                        }).then(function() {
                            log('Cache warm request sent successfully');
                        }).catch(function() {
                            // no-cors may "fail" but the request still goes out
                            log('Cache warm request sent (no-cors)');
                        });
                    } catch(e) {
                        log('Failed to send prefetch:', e.message);
                    }
                }
            }).catch(function() {});
        }, 15000); // Wait 15s into playback before prefetching next
    }, 5000, { quiet: true });
})();
