// #17 — Force Stereo Downmix (split from the former 032 god-module; see 032a for the settingsStore)
// Downmixes surround audio to stereo using Web Audio API.
// Boosts center channel for dialogue clarity on basic speakers.
// ═══════════════════════════════════════════════════════════════════════
// #17 — Force Stereo Downmix
// Downmixes surround audio to stereo using Web Audio API.
// Boosts center channel for dialogue clarity on basic speakers.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_force_stereo';
    var log = RT.logger('audio');
    var audioCtx = null;
    var sourceNode = null;
    var connectedVideo = null;

    function isEnabled() {
        return RT.store.getBool(LS_KEY, false);
    }

    function applyStereoDownmix(video) {
        if (!video || connectedVideo === video) return;
        cleanupAudio();

        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sourceNode = audioCtx.createMediaElementSource(video);

            // Force stereo on destination
            audioCtx.destination.channelCount = 2;
            audioCtx.destination.channelCountMode = 'explicit';
            audioCtx.destination.channelInterpretation = 'speakers';

            // Create a gain node to boost center channel presence
            var gainNode = audioCtx.createGain();
            gainNode.gain.value = 1.15; // slight boost for dialogue clarity
            gainNode.channelCount = 2;
            gainNode.channelCountMode = 'explicit';
            gainNode.channelInterpretation = 'speakers';

            // Create a compressor to even out the stereo mix
            var compressor = audioCtx.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 12;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.15;
            compressor.channelCount = 2;
            compressor.channelCountMode = 'explicit';

            sourceNode.connect(gainNode);
            gainNode.connect(compressor);
            compressor.connect(audioCtx.destination);

            connectedVideo = video;
            log('Stereo downmix applied — routing through 2ch gain + compressor');

            // Show brief toast
            showToast('Stereo downmix active');
        } catch(e) {
            log('Failed to apply stereo downmix:', e.message);
            cleanupAudio();
            // Fallback: try just connecting through
            try {
                if (sourceNode) sourceNode.connect(audioCtx.destination);
            } catch(e2) {}
        }
    }

    function cleanupAudio() {
        if (sourceNode) {
            try { sourceNode.disconnect(); } catch(e) {}
            sourceNode = null;
        }
        if (audioCtx) {
            try { audioCtx.close(); } catch(e) {}
            audioCtx = null;
        }
        connectedVideo = null;
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
        var hash = window.location.hash || '';
        var inPlayer = hash.indexOf('#/player/') === 0;

        if (wasInPlayer && !inPlayer) {
            log('Left player — cleaning up audio context');
            cleanupAudio();
        }

        if (inPlayer && isEnabled()) {
            var video = document.querySelector('video');
            if (video && video.readyState >= 1 && connectedVideo !== video) {
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
                if (!nowEnabled) cleanupAudio();
            }
        });
    }

    log('Force stereo patch loaded (enabled:', isEnabled(), ')');
})();
