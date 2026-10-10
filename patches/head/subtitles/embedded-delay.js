// Embedded-subtitle delay — shift NATIVE <track> cues.
// Upstream's subtitle DELAY stepper only drives `extraSubtitlesDelay`
// (addon/extra subs rendered by the DOM overlay); embedded container text
// tracks (MP4 mov_text, WebVTT-in-WebM, HLS subtitle renditions) render
// natively and have no delay control at all. VTTCue.startTime/endTime are
// mutable, so we shift every cue of every text track by the configured
// offset and re-apply to cues that load later (HLS adds cues progressively).
//
// Control surface mirrors audio/delay.js: `[` / `]` in the player adjust
// ∓25 ms (the plain-bracket pair of Shift+[ / Shift+] for audio), a
// settings toggle + offset row persist the preference, and a transient
// overlay shows the current value. Unlike audio, negative offsets are
// perfectly physical here — cues may move earlier (clamped at 0).
//
// Application is IDEMPOTENT per cue: each cue carries its applied offset
// (__vidaaSubOffset), so re-running with the same target is a no-op and
// changing the target shifts by the delta only. Applied via: delay
// changes, textTracks addtrack, per-track cuechange (late cues), and a
// light player-route poll (engine video swaps reset the cue set).
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var log = RT.logger('subs-delay');
    var LS_KEY = 'stremio_embedded_sub_delay';
    var ENABLED_KEY = 'stremio_embedded_sub_delay_enabled';
    var MIN_DELAY = -2000;
    var MAX_DELAY = 2000;
    var STEP = 25; // ms per press

    var readout = window.__vidaaUI.transient('embedded-sub-delay-overlay',
        'position:fixed;top:56%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:#fff;padding:12px 28px;border-radius:10px;font-family:PlusJakartaSans,sans-serif;font-size:1.2rem;font-weight:700;z-index:99999;pointer-events:none;transition:opacity 0.4s;text-align:center;',
        1500, 'opacity 0.4s');

    function isEnabled() {
        return RT.store.getBool(ENABLED_KEY, false);
    }
    function getDelay() {
        var v = parseInt(RT.store.get(LS_KEY, null), 10);
        return isNaN(v) ? 0 : Math.max(MIN_DELAY, Math.min(MAX_DELAY, v));
    }
    function setDelay(ms) {
        ms = Math.max(MIN_DELAY, Math.min(MAX_DELAY, ms));
        RT.store.set(LS_KEY, String(ms));
        return ms;
    }

    // ── cue shifting (idempotent per cue) ───────────────────────────
    function applyToCueList(cues, targetMs) {
        if (!cues || cues.length === 0) return 0;
        var shifted = 0;
        var deltaSec = 0;
        // CueList is live; iterate by index (ES5, no iterator).
        for (var i = 0; i < cues.length; i++) {
            var cue = cues[i];
            if (!cue || typeof cue.startTime !== 'number' || typeof cue.endTime !== 'number') continue;
            var prevMs = (typeof cue.__vidaaSubOffset === 'number') ? cue.__vidaaSubOffset : 0;
            if (prevMs === targetMs) continue;               // already there
            deltaSec = (targetMs - prevMs) / 1000;
            cue.startTime = Math.max(0, cue.startTime + deltaSec);
            cue.endTime = Math.max(cue.startTime, cue.endTime + deltaSec);
            cue.__vidaaSubOffset = targetMs;
            shifted++;
        }
        return shifted;
    }

    function applyToVideo(video, targetMs) {
        if (!video || !video.textTracks) return 0;
        var total = 0;
        for (var t = 0; t < video.textTracks.length; t++) {
            total += applyToCueList(video.textTracks[t].cues, targetMs);
        }
        return total;
    }

    // ── video discovery + late-cue hooks ────────────────────────────
    var activeVideo = null;

    function hookTrack(track) {
        if (!track || track.__vidaaDelayHooked) return;
        track.__vidaaDelayHooked = true;
        try {
            track.addEventListener('cuechange', function() {
                // Cues often materialize lazily; re-apply on activity.
                applyToCueList(track.cues, getDelay());
            });
        } catch (e) {}
    }

    function hookVideo(video) {
        if (!video || !video.textTracks || video.__vidaaSubDelayHooked) return;
        video.__vidaaSubDelayHooked = true;
        try {
            video.textTracks.addEventListener('addtrack', function(ev) {
                hookTrack(ev.track);
                applyToCueList(ev.track && ev.track.cues, getDelay());
            });
            for (var i = 0; i < video.textTracks.length; i++) hookTrack(video.textTracks[i]);
        } catch (e) {}
    }

    if (RT.dom && RT.dom.onVideoAdded) {
        RT.dom.onVideoAdded(function(video) {
            activeVideo = video;
            hookVideo(video);
        });
    }

    // ── apply on change + belt-and-braces poll (video swaps, late cues) ──
    window.__setEmbeddedSubDelay = function(ms) {
        var applied = setDelay(ms);
        var video = (RT.dom && RT.dom.currentVideo) ? RT.dom.currentVideo()
            : document.querySelector('video');
        var shifted = applyToVideo(video, applied);
        log('Embedded sub delay:', applied + 'ms (' + shifted + ' cue(s) shifted)');
        return applied;
    };
    window.__getEmbeddedSubDelay = getDelay;

    function showOverlay(ms) {
        var sign = ms >= 0 ? '+' : '';
        readout.show('Subtitles: ' + sign + ms + 'ms');
    }

    // Plain brackets — the pair of the audio delay's Shift+[ / Shift+].
    window.__vidaaKeys.on(['bracketLeft', 'bracketRight'], function(e) {
        var current = getDelay();
        var next = (e.keyCode === 219) ? setDelay(current - STEP) : setDelay(current + STEP);
        showOverlay(next);
        var video = (RT.dom && RT.dom.currentVideo) ? RT.dom.currentVideo()
            : document.querySelector('video');
        applyToVideo(video, next);
    }, {
        route: 'player',
        suppress: true,
        when: function(e) {
            if (!isEnabled()) return false;
            var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
            return tag !== 'input' && tag !== 'textarea';
        }
    });

    // Player-route poll (quiet — pure UI timing, no playback criticality):
    // catches engine video swaps (fresh cue set) and late cue material that
    // dodged the event hooks.
    RT.poll(function() {
        var video = (RT.dom && RT.dom.currentVideo) ? RT.dom.currentVideo()
            : document.querySelector('video');
        if (!video) { activeVideo = null; return; }
        if (video !== activeVideo) {
            activeVideo = video;
            hookVideo(video);
        }
        if (!isEnabled()) return;
        applyToVideo(video, getDelay());
    }, 1500, { route: 'player', quiet: true });

    // ── settings rows (audio/delay.js pattern) ──────────────────────
    if (window.__registerVidaaSettingsItem) {
        window.__registerVidaaSettingsItem({
            id: 'embedded-sub-delay-toggle',
            type: 'toggle',
            label: 'Embedded Subtitle Delay',
            description: '[ / ] in the player shift EMBEDDED subtitles earlier/later (the pair of Shift+[ / ] for audio). Works on subtitles that come inside the file; addon subtitles already have their own Delay option.',
            lsKey: ENABLED_KEY,
            defaultValue: false,
            onToggle: function(nowEnabled) {
                log('toggled:', nowEnabled ? 'ON' : 'OFF');
                if (!nowEnabled) { setDelay(0); }
            }
        });
        window.__registerVidaaSettingsItem({
            id: 'embedded-sub-delay-offset',
            type: 'choice',
            label: 'Embedded Subs Offset',
            lsKey: LS_KEY,
            getLabel: function() {
                var d = getDelay();
                return 'Embedded Subs Offset: ' + (d >= 0 ? '+' : '') + d + 'ms';
            },
            isDisabled: function() { return !isEnabled(); },
            options: [-1000, -500, -250, -75, 0, 75, 250, 500, 1000].map(function(ms) {
                return {
                    label: (ms >= 0 ? '+' : '') + ms + 'ms',
                    isSelected: function() { return getDelay() === ms; },
                    onSelect: function() { window.__setEmbeddedSubDelay(ms); showOverlay(ms); }
                };
            })
        });
    }

    log('Embedded sub delay loaded (enabled:', isEnabled(), ', offset:', getDelay() + 'ms)');
})();
