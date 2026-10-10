// #14 — Full subtitle filenames in picker (rewritten, P0.5 2026-10-08)
// Stremio shortens subtitle track labels in the picker, losing useful info
// like source, codec, and release group. This patch intercepts addon
// subtitle responses, caches full labels, and rewrites the LABEL element
// of picker rows that provably show a truncated prefix of a cached label.
//
// DOM anchor (verified against Theater 1.10.0's built bundle): the player
// menus render through the shared settings-list component, whose rows are
// `.option-<hash>` elements containing a `.label-<hash>` text child (plus
// icon/tag/toggle siblings). The hashes are CSS-module hashes and WILL
// change on an upstream re-baseline — hence prefix matching on the stable
// `option-`/`label-` stems instead of exact classes.
//
// The rewrite is content-qualified, which is what makes it safe:
//   • only rows that HAVE a label child qualify (the seekbar's
//     `track-<hash>` element never does — the old `[class*="track"]`
//     selector corrupted the seekbar);
//   • the label text must be a non-empty (>=3 chars) case-insensitive
//     PREFIX of a cached full label that is meaningfully longer — so rows
//     from other menus (audio, speed, videos) can't match a subtitle
//     filename by accident, and the old `indexOf('') === 0` empty-text
//     bug class is impossible;
//   • only the label child's text is rewritten — never the row's
//     textContent, which would destroy the icon/tag siblings.
// Rows are marked with data-full-label/data-full-display; a marked row
// whose label element was recreated by a re-render gets self-healed from
// the stored display value.
(function() {
    var RT = window.__vidaaRuntime;
    var log = RT.logger('subs');
    var fullSubLabels = {};

    // Intercept fetch responses that contain subtitle data from addons
    RT.tapJsonFetch(function(u) {
        return u.indexOf('/subtitles/') !== -1;
    }, function(data) {
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
            log('Cached', Object.keys(fullSubLabels).length, 'full subtitle labels');
        }
    });

    // Expose for debugging and diagnostics
    window.__fullSubLabels = fullSubLabels;

    var DISPLAY_MAX = 60;

    function displayFor(full) {
        return full.length > DISPLAY_MAX ? full.substring(0, DISPLAY_MAX - 3) + '...' : full;
    }

    function patchRows() {
        if (Object.keys(fullSubLabels).length === 0) return;

        var rows = document.querySelectorAll('[class*="option-"]');
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var labelEl = row.querySelector('[class*="label-"]');
            if (!labelEl) continue;          // not a labeled row — never qualifies
            var text = (labelEl.textContent || '').replace(/^\s+|\s+$/g, '');
            if (!text) continue;             // label not filled yet — recheck later

            var appliedDisplay = row.getAttribute('data-full-display');
            if (appliedDisplay !== null) {
                // Self-heal: a re-render may have recreated the label span
                // under an already-marked row.
                if (labelEl.textContent !== appliedDisplay) {
                    labelEl.textContent = appliedDisplay;
                }
                continue;
            }

            var lower = text.toLowerCase();
            for (var id in fullSubLabels) {
                var full = fullSubLabels[id];
                if (full.length <= text.length + 1) continue;   // nothing to add
                if (full.toLowerCase().indexOf(lower) === 0) {
                    var display = displayFor(full);
                    labelEl.textContent = display;
                    row.setAttribute('data-full-label', full);
                    row.setAttribute('data-full-display', display);
                    log('Expanded picker label:', text, '->', display);
                    break;
                }
            }
        }
    }

    var patchObserver = new MutationObserver(patchRows);
    var observing = false;

    // Route-gate the observer; clear the cache when leaving the player (a
    // new video taps fresh addon responses). UI nicety, not playback-
    // critical — quiet:true lets Quiet Player Mode silence this poller.
    window.__vidaaRuntime.poll(function() {
        var inPlayer = RT.inPlayer();
        if (inPlayer && !observing) {
            observing = true;
            patchObserver.observe(document.body, { childList: true, subtree: true });
        } else if (!inPlayer && observing) {
            observing = false;
            patchObserver.disconnect();
        }
        if (!inPlayer) {
            fullSubLabels = {};
            window.__fullSubLabels = fullSubLabels;
        }
    }, 2000, { quiet: true });
})();
