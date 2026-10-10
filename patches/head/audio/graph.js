// ═══════════════════════════════════════════════════════════════════════
// VIDAA audio graph — the ONE Web Audio pipeline for the audio features.
//
// Browsers allow a single createMediaElementSource() per <video>, so the
// AudioContext, the source node and the per-video bookkeeping live here
// once. force-stereo and audio-delay attach their node chains into one
// linear pipeline (source → chain₁ → … → chainₙ → destination) instead of
// each owning a competing graph — enabling both at once used to make the
// second feature throw and retry forever.
//
// Global: window.__vidaaAudioGraph. Feature-check before use.
(function() {
    var ctx = null;
    var source = null;
    var attachedVideo = null;
    var chains = [];   // [{ id, in, out }] in attach order

    function rebuild() {
        try { if (source) source.disconnect(); } catch(e) {}
        var node = source;
        for (var j = 0; j < chains.length; j++) {
            try { node.connect(chains[j].in); } catch(e) { return; }
            node = chains[j].out;
            // Clear stale edges from this chain's output before the next
            // link (or the destination) is connected below.
            try { node.disconnect(); } catch(e) {}
        }
        try { if (node && ctx) node.connect(ctx.destination); } catch(e) {}
    }

    // An AudioContext created outside a user gesture (our polls) can start
    // 'suspended'; once createMediaElementSource reroutes the video's audio
    // into it, a suspended context is TOTAL SILENCE. Keep trying to resume —
    // at every ensure() and on every statechange (P0.9).
    function resumeAudio() {
        if (!ctx || typeof ctx.resume !== 'function') return;
        if (ctx.state !== 'suspended') return;
        try {
            var p = ctx.resume();
            if (p && typeof p.catch === 'function') p.catch(function() {});
        } catch(e) {}
    }

    // Ensure a live context + source for this video. Switching videos tears
    // the old graph down first (one MediaElementSource per element, ever).
    function ensure(video) {
        if (!video) return null;
        if (ctx && source && attachedVideo === video && video.isConnected) {
            resumeAudio();
            return { ctx: ctx, source: source };
        }
        teardown();
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            ctx.onstatechange = function() { resumeAudio(); };
            resumeAudio();
            source = ctx.createMediaElementSource(video);
            attachedVideo = video;
            rebuild();
            return { ctx: ctx, source: source };
        } catch(e) {
            teardown();
            return null;
        }
    }

    // makeChain(ctx) → { in: AudioNode, out: AudioNode }. Attaching an id
    // that already exists replaces its chain. Returns success.
    function attach(id, makeChain) {
        if (!ctx) return false;
        detach(id);
        try {
            var c = makeChain(ctx);
            if (!c || !c.in || !c.out) return false;
            chains.push({ id: id, in: c.in, out: c.out });
            rebuild();
            return true;
        } catch(e) {
            return false;
        }
    }

    // Remove one feature's chain (the others keep playing).
    function detach(id) {
        for (var i = 0; i < chains.length; i++) {
            if (chains[i].id === id) {
                var c = chains.splice(i, 1)[0];
                try { c.in.disconnect(); } catch(e) {}
                try { c.out.disconnect(); } catch(e) {}
                rebuild();
                return;
            }
        }
    }

    // Full teardown — leaving the player, or the source video is gone.
    function teardown() {
        for (var i = 0; i < chains.length; i++) {
            try { chains[i].in.disconnect(); } catch(e) {}
            try { chains[i].out.disconnect(); } catch(e) {}
        }
        chains = [];
        if (source) { try { source.disconnect(); } catch(e) {} source = null; }
        if (ctx) { try { ctx.close(); } catch(e) {} ctx = null; }
        attachedVideo = null;
    }

    window.__vidaaAudioGraph = {
        ensure: ensure,
        attach: attach,
        detach: detach,
        teardown: teardown,
        resume: resumeAudio,
        // Consumers gate on the BOUND video, not just chain presence: the
        // engine recreates the <video> on every load, and a chain bound to
        // a detached element processes silence (P0.9).
        boundVideo: function() { return attachedVideo; },
        context: function() { return ctx; },
        hasChain: function(id) {
            for (var i = 0; i < chains.length; i++) if (chains[i].id === id) return true;
            return false;
        }
    };
})();
