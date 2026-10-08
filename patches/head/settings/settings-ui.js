// ═══════════════════════════════════════════════════════════════════════
// Vidaa TV settings section — rows built here, mounted by a thin seam.
// ═══════════════════════════════════════════════════════════════════════
// The settings.chunk.js edit (patches/chunk-edits/settings.chunk.js.json,
// op0) is now MINIMAL: it appends a "Vidaa TV" section whose `options`
// call window.__vidaaSettingsRows(g, p). Everything below — toggle rows,
// the audio-offset choice row, action rows, the SolidJS reactivity glue —
// lives in this plain, lintable, testable patch file.
//
// Rows render FROM the settingsStore registry (032a): registering an item
// is all a new toggle needs. The ORDER list preserves the section's
// historical layout; registered-but-unlisted items append at the bottom.
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;

    function buildRows(g, p) {
        // g.animations() is the reactive dependency the Animations toggle
        // uses. Toggle it off/on to force SolidJS to re-evaluate every
        // checked()/label() in this section.
        function forceRerender() {
            var a = g.animations();
            g.setAnimations(!a);
            setTimeout(function() { g.setAnimations(a); }, 50);
        }

        function makeToggle(label, lsKey, onToggle, defaultOn) {
            return {
                label: label,
                options: [{
                    checked: function() { g.animations(); return RT.store.getBool(lsKey, !!defaultOn); },
                    onClick: function() {
                        var now = !RT.store.getBool(lsKey, !!defaultOn);
                        RT.store.set(lsKey, now);
                        forceRerender();
                        if (onToggle) onToggle(now);
                    }
                }]
            };
        }

        function makeAction(labelOrGetter, onClick, disabled) {
            return {
                get label() {
                    return typeof labelOrGetter === 'function' ? labelOrGetter() : labelOrGetter;
                },
                disabled: disabled,
                onClick: function() {
                    onClick();
                    forceRerender();
                }
            };
        }

        // choice items (e.g. the audio offset): one selected value out of N.
        function makeChoice(item) {
            return {
                label: function() { g.animations(); return item.getLabel ? item.getLabel() : item.label; },
                disabled: item.isDisabled ? function() { return item.isDisabled(); } : undefined,
                options: item.options.map(function(opt) {
                    return {
                        label: opt.label,
                        selected: function() { g.animations(); return opt.isSelected(); },
                        onClick: function() { opt.onSelect(); forceRerender(); }
                    };
                })
            };
        }

        function rowFor(item) {
            if (item.type === 'choice') return makeChoice(item);
            if (item.type === 'toggle') {
                return makeToggle(item.label, item.lsKey, item.onToggle, item.defaultValue === true);
            }
            // button / action rows
            return makeAction(item.label, function() {
                if (item.onClick) item.onClick();
                if (item.onToggle) item.onToggle();
            });
        }

        // Special rows owned by this UI (feature entry points exposed as
        // globals by their own patches).
        var SPECIALS = {
            '@720p-mode': function() {
                return makeAction(function() {
                    return window.__get720pModeLabel ? '720p Mode: ' + window.__get720pModeLabel() : '720p Mode';
                }, function() {
                    if (window.__cycle720pMode) window.__cycle720pMode();
                });
            },
            '@playback-diagnostics': function() {
                return makeAction('Playback Diagnostics', function() {
                    if (window.__showPlaybackDiagnostics) window.__showPlaybackDiagnostics();
                });
            },
            '@safe-mode': function() {
                return makeAction('Apply Safe Playback Mode', function() {
                    if (window.__applyPlaybackSafeMode) window.__applyPlaybackSafeMode();
                });
            },
            '@reset-tweaks': function() {
                return makeAction(function() {
                    return window.__getResetVidaaTweaksLabel ? window.__getResetVidaaTweaksLabel() : 'Reset VIDAA Tweaks';
                }, function() {
                    if (window.__triggerResetVidaaTweaks) window.__triggerResetVidaaTweaks();
                });
            },
            '@exit': function() {
                return makeAction('Exit Stremio', function() {
                    if (window.__exitApp) window.__exitApp(); else window.dispatchEvent(new Event('quit'));
                }, function() { return 'Web' === p.name; });
            }
        };

        // Historical layout of the section. Registry ids resolve through
        // the settingsStore; '@…' ids resolve to the specials above.
        var ORDER = [
            'quiet-player-toggle',
            'auto-native-mkv-toggle',
            'auto-native-player-toggle',
            'stereo-downmix-toggle',
            'audio-delay-toggle',
            'audio-delay-offset',
            'autoplay-best-toggle',
            'mark-season-toggle',
            'sub-drift-toggle',
            '@720p-mode',
            'webtorrent-toggle',
            'low-memory-toggle',
            'auto-rebuffer-toggle',
            'stream-stats-toggle',
            'playback-warning-toggle',
            '@playback-diagnostics',
            '@safe-mode',
            '@reset-tweaks',
            'show-vidaa-diagnostics',
            '@exit'
        ];

        var items = window.__vidaaSettingsItems || [];
        var byId = {};
        for (var i = 0; i < items.length; i++) byId[items[i].id] = items[i];

        var rows = [];
        var listed = {};
        for (var o = 0; o < ORDER.length; o++) {
            var id = ORDER[o];
            listed[id] = true;
            if (SPECIALS[id]) { rows.push(SPECIALS[id]()); continue; }
            if (byId[id]) rows.push(rowFor(byId[id]));
        }
        // Registered but not in ORDER: append at the bottom — a new
        // registration shows up without touching any other artifact.
        for (var u = 0; u < items.length; u++) {
            if (!listed[items[u].id]) rows.push(rowFor(items[u]));
        }
        return rows;
    }

    // Called once by the settings.chunk.js seam when the Settings screen
    // data structure is built (lazily, long after every patch has loaded).
    window.__vidaaSettingsRows = buildRows;
})();
