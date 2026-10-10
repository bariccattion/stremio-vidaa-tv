// #17 — Force Stereo Downmix (split from the former 032 god-module; the settingsStore lives in kernel/settings-store.js)
// Downmixes surround audio to stereo using Web Audio API: a slight gain
// boost plus compression makes dialogue easier to hear on basic TV speakers
// (the boost applies to the whole mix — a plain GainNode cannot target the
// center channel alone).
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_force_stereo';
    var log = RT.logger('audio');

    function isEnabled() {
        return RT.store.getBool(LS_KEY, false);
    }

    // The chain factory forces the context destination to 2ch; undo it when
    // our chain goes away so delay-only users keep the natural channel mix
    // (the destination mutation otherwise persists after detach — P0.9).
    function restoreDestination() {
        var c = window.__vidaaAudioGraph.context && window.__vidaaAudioGraph.context();
        if (!c) return;
        try {
            c.destination.channelCountMode = 'max';
            c.destination.channelInterpretation = 'speakers';
        } catch(e) {}
    }

    function applyStereoDownmix(video) {
        if (!video) return;
        var G = window.__vidaaAudioGraph;
        if (!G.ensure(video)) {
            log('Failed to apply stereo downmix: audio graph unavailable');
            return;
        }
        var ok = G.attach('stereo', function(ctx) {
            // Force stereo on destination
            ctx.destination.channelCount = 2;
            ctx.destination.channelCountMode = 'explicit';
            ctx.destination.channelInterpretation = 'speakers';

            // Loudness boost + compression for dialogue clarity on basic speakers
            var gainNode = ctx.createGain();
            gainNode.gain.value = 1.15;
            gainNode.channelCount = 2;
            gainNode.channelCountMode = 'explicit';
            gainNode.channelInterpretation = 'speakers';

            // Create a compressor to even out the stereo mix
            var compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 12;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.15;
            compressor.channelCount = 2;
            compressor.channelCountMode = 'explicit';

            gainNode.connect(compressor);
            return { in: gainNode, out: compressor };
        });
        if (ok) {
            log('Stereo downmix applied — routing through 2ch gain + compressor');
            showToast('Stereo downmix active');
        } else {
            log('Failed to apply stereo downmix');
        }
    }

    function showToast(msg) {
        RT.toast(msg, {
            id: 'stereo-toast',
            at: 'top',
            ms: 2600,
            fadeMs: 2000,
            extra: 'top:40px;right:30px;left:auto;transform:none;background:rgba(123,91,245,0.85);padding:10px 22px;font-size:0.9rem;z-index:99999;pointer-events:none;transition:opacity 0.5s;max-width:none;'
        });
    }

    // Watch for player route and video element
    var wasInPlayer = false;
    RT.poll(function() {
        var inPlayer = RT.inPlayer();

        if (wasInPlayer && !inPlayer) {
            log('Left player — cleaning up audio context');
            window.__vidaaAudioGraph.teardown();
        }

        if (inPlayer && isEnabled()) {
            var video = (window.__vidaaRuntime.dom && window.__vidaaRuntime.dom.currentVideo)
                ? window.__vidaaRuntime.dom.currentVideo()
                : document.querySelector('video');
            // Re-apply on engine video swaps too, not just missing chains:
            // a chain bound to a detached <video> processes silence (P0.9).
            if (video && video.readyState >= 1
                && (window.__vidaaAudioGraph.boundVideo() !== video || !window.__vidaaAudioGraph.hasChain('stereo'))) {
                applyStereoDownmix(video);
            }
        }

        wasInPlayer = inPlayer;
    }, 1500, { quiet: true });

    // Register settings toggle
    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'stereo-downmix-toggle',
            lsKey: LS_KEY,
            defaultValue: false,
            title: 'Force Stereo',
            description: 'Downmix surround sound to stereo with dialogue boost',
            onToggle: function(nowEnabled) {
                log('Force stereo toggled:', nowEnabled ? 'ON' : 'OFF');
                // Detach only OUR chain — audio-delay may still be live.
                if (!nowEnabled) {
                    window.__vidaaAudioGraph.detach('stereo');
                    restoreDestination();
                }
            }
        });
    }

    log('Force stereo patch loaded (enabled:', isEnabled(), ')');
})();
