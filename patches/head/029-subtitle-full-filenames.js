// #14 — Full subtitle filenames in picker
// Stremio truncates subtitle track names in the picker, losing useful info like
// source, codec, and release group. This patch intercepts addon subtitle responses,
// caches full labels, and patches the subtitle picker DOM to show them.
(function() {
    var fullSubLabels = {};

    // Intercept fetch responses that contain subtitle data from addons
    var origFetch = window.fetch;
    window.fetch = function(url, opts) {
        var result = origFetch.apply(this, arguments);
        try {
            if (typeof url === 'string' && url.indexOf('/subtitles/') !== -1) {
                result.then(function(response) {
                    var cloned = response.clone();
                    cloned.json().then(function(data) {
                        if (data && data.subtitles && Array.isArray(data.subtitles)) {
                            for (var i = 0; i < data.subtitles.length; i++) {
                                var sub = data.subtitles[i];
                                var id = sub.id || sub.url || ('sub_' + i);
                                var fullLabel = '';
                                if (sub.filename) fullLabel = sub.filename;
                                else if (sub.title) fullLabel = sub.title;
                                else if (sub.lang) fullLabel = sub.lang;
                                if (fullLabel) {
                                    // Clean up filename: remove extension, replace dots/underscores
                                    fullLabel = fullLabel.replace(/\.(srt|ass|ssa|sub|vtt|idx)$/i, '');
                                    fullSubLabels[id] = fullLabel;
                                }
                            }
                            console.log('[subs] Cached', Object.keys(fullSubLabels).length, 'full subtitle labels');
                        }
                    }).catch(function() {});
                }).catch(function() {});
            }
        } catch(e) {}
        return result;
    };

    // Expose for debugging
    window.__fullSubLabels = fullSubLabels;

    // Patch subtitle picker DOM to show full filenames
    var patchObserver = new MutationObserver(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) return;
        if (Object.keys(fullSubLabels).length === 0) return;

        // Find subtitle picker elements
        var options = document.querySelectorAll('[class*="track"], [class*="Track"], [class*="subtitle"] [class*="option"], [class*="subtitlesPicker"] [class*="row"]');
        for (var i = 0; i < options.length; i++) {
            if (options[i].getAttribute('data-full-label')) continue;
            var text = (options[i].textContent || '').trim();
            // Try to find a matching full label
            for (var id in fullSubLabels) {
                var full = fullSubLabels[id];
                // Match if the truncated text is a prefix of the full label, or if the language matches
                if (full.toLowerCase().indexOf(text.toLowerCase()) === 0 ||
                    text.toLowerCase().indexOf(full.substring(0, 10).toLowerCase()) === 0) {
                    options[i].setAttribute('data-full-label', full);
                    options[i].setAttribute('title', full);
                    // Show a truncated but longer version
                    if (full.length > 60) {
                        options[i].textContent = full.substring(0, 57) + '...';
                    } else {
                        options[i].textContent = full;
                    }
                    break;
                }
            }
        }
    });

    // Activate observer when in player
    setInterval(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') === 0) {
            patchObserver.observe(document.body, { childList: true, subtree: true });
        } else {
            patchObserver.disconnect();
            fullSubLabels = {};
            window.__fullSubLabels = fullSubLabels;
        }
    }, 2000);
})();
