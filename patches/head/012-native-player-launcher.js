// ═══════════════════════════════════════════════════════════════════════
// Native player handoff — SINGLE consolidated, HONEST launcher.
// ═══════════════════════════════════════════════════════════════════════
// IMPORTANT (read before "fixing"): omi_platform.sendPlatformMessage is a real
// Opera/Vewd bridge, but its ONLY working message type on shipped VIDAA firmware
// is AllAppsUpdate (launcher refresh). The message types we send here
// (launchNativePlayer / openMediaPlayer / playVideo) are NOT acted on by any
// confirmed VIDAA firmware (issues #28, #29 — three users saw "nothing
// happens"). The send is fire-and-forget with NO acknowledgement.
//
// So we MUST NOT report success just because a message was dispatched. The only
// observable signal that a native app actually took the foreground is the
// browser document being backgrounded: visibilitychange->hidden, window blur,
// or pagehide. We listen for any of those within a short window. If none
// arrives we treat the handoff as FAILED. Per 2026 research there is NO
// guarantee VIDAA's Opera-based browser even fires these events on foreground
// loss (Opera TV historically allowed the Page Visibility API to be disabled),
// so we are deliberately CONSERVATIVE: failure is the default, success requires
// a positive signal.
//
// The launcher returns a Promise<boolean> reflecting the VERIFIED outcome.
// Callers MUST act on the resolved value (un-pause the browser <video>, show
// honest advice) — never assume success.
//
// This is the ONLY place __launchNativePlayer is defined. The previous three
// racing redefinitions (original / title-enhanced / watched-wrapper, each
// re-installed by setInterval + setTimeout) clobbered each other
// nondeterministically. They are consolidated here in deterministic order:
//   build payload+title -> fire-and-forget send -> verify backgrounding ->
//   (only if verified AND toggle on) optional watched-tracking.
(function() {
    'use strict';

    var HANDOFF_KEY = 'stremio_native_handoff';   // also the watched-tracking toggle key
    var DEFAULT_VERIFY_MS = 2000;                  // window to observe app backgrounding
    var DEFAULT_WATCHED_DELAY_MS = 30000;          // delay before marking watched (verified only)

    function hasNative() {
        try { return typeof omi_platform !== 'undefined' && typeof omi_platform.sendPlatformMessage === 'function'; } catch(e) { return false; }
    }

    function guessNativeMimeType(url) {
        var path = '';
        try { path = String(url || '').split('?')[0].toLowerCase(); } catch(e) {}
        if (path.indexOf('.mkv') !== -1) return 'video/x-matroska';
        if (path.indexOf('.m3u8') !== -1) return 'application/vnd.apple.mpegurl';
        if (path.indexOf('.mpd') !== -1) return 'application/dash+xml';
        if (path.indexOf('.webm') !== -1) return 'video/webm';
        if (path.indexOf('.mov') !== -1) return 'video/quicktime';
        if (path.indexOf('.mp4') !== -1 || path.indexOf('.m4v') !== -1) return 'video/mp4';
        return 'video/mp4';
    }
    window.__guessNativeMimeType = guessNativeMimeType;

    // Scrape a human title for the native player payload. Best-effort only.
    function getPlayerTitle() {
        try {
            var titleEls = document.querySelectorAll('[class*="title"], [class*="Title"]');
            for (var i = 0; i < titleEls.length; i++) {
                var txt = (titleEls[i].textContent || '').trim();
                if (txt.length > 3 && txt.length < 200 && txt.indexOf('Settings') === -1 && txt.indexOf('Stremio') === -1) {
                    return txt;
                }
            }
            var hash = window.location.hash || '';
            var match = hash.match(/[?&]title=([^&]+)/);
            if (match) return decodeURIComponent(match[1]);
            if (window.__STREAM_INFO__ && window.__STREAM_INFO__.title) return window.__STREAM_INFO__.title;
        } catch(e) {}
        return 'Stremio';
    }

    // Cache the title from detail pages so we have it when the player opens.
    setInterval(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/detail') === 0 || hash.indexOf('#/metadetails') === 0) {
            try {
                var h1s = document.querySelectorAll('h1, h2, [class*="title"], [class*="Title"], [class*="name"], [class*="Name"]');
                for (var i = 0; i < h1s.length; i++) {
                    var txt = (h1s[i].textContent || '').trim();
                    if (txt.length > 2 && txt.length < 200) {
                        window.__STREAM_INFO__ = window.__STREAM_INFO__ || {};
                        window.__STREAM_INFO__.title = txt;
                        break;
                    }
                }
            } catch(e) {}
        }
    }, 2000);

    // Returns a Promise<boolean> that resolves true ONLY if the document is
    // observed to background within `ms`. Conservative: no signal => false.
    function verifyBackgrounding(ms) {
        return new Promise(function(resolve) {
            var settled = false;
            function done(ok) {
                if (settled) return;
                settled = true;
                try { document.removeEventListener('visibilitychange', onVis); } catch(e) {}
                try { window.removeEventListener('blur', onBlur); } catch(e) {}
                try { window.removeEventListener('pagehide', onHide); } catch(e) {}
                clearTimeout(timer);
                resolve(ok);
            }
            function onVis() { if (document.visibilityState === 'hidden' || document.hidden === true) done(true); }
            function onBlur() { done(true); }
            function onHide() { done(true); }
            // If we're already hidden, that's a positive signal.
            if (document.visibilityState === 'hidden' || document.hidden === true) { resolve(true); return; }
            document.addEventListener('visibilitychange', onVis);
            window.addEventListener('blur', onBlur);
            window.addEventListener('pagehide', onHide);
            var timer = setTimeout(function() { done(false); }, ms);
        });
    }

    // Mark-as-watched — VERIFIED handoffs only, behind the existing toggle.
    // NOTE: we deliberately do NOT write any fake currentTime/progress. The old
    // code set currentTime = duration*0.9 which corrupted the resume point on
    // every (always-"true") handoff. That is removed entirely.
    function markAsWatched(handoff) {
        try {
            if (!window.core || !handoff || !handoff.hash) return;
            window.core.getState('player').then(function(playerState) {
                if (!playerState) return;
                var metaId = null, videoId = null;
                try {
                    if (playerState.metaItem) metaId = playerState.metaItem.id;
                    if (playerState.video) videoId = playerState.video.id;
                } catch(e) {}
                if (metaId) {
                    try {
                        window.core.dispatch({
                            action: 'Ctx',
                            args: { action: 'MarkAsWatched', args: { id: metaId, videoId: videoId, isWatched: true } }
                        }, 'ctx');
                        console.log('[watched] Marked as watched (VERIFIED handoff):', metaId, videoId);
                    } catch(e) {
                        console.log('[watched] MarkAsWatched dispatch failed:', e.message);
                    }
                }
            }).catch(function(e) {
                console.log('[watched] Failed to get player state:', e.message);
            });
        } catch(e) {}
    }

    function watchedTrackingEnabled() {
        try { return localStorage.getItem(HANDOFF_KEY) === 'true'; } catch(e) { return false; }
    }

    // Shared recovery helper for ALL auto/recovery call sites. When a handoff
    // fails (verified false), callers MUST un-pause the browser <video> so the
    // user isn't left staring at a frozen, paused player with no feedback, and
    // surface honest advice. Non-blocking, dismissible.
    var lastFailToastAt = 0;
    window.__recoverAfterFailedHandoff = function(video, opts) {
        opts = opts || {};
        // Best-effort resume of the browser player.
        try {
            video = video || document.querySelector('video');
            if (video && video.paused) {
                var p = video.play();
                if (p && typeof p.catch === 'function') p.catch(function() {});
            }
        } catch(e) {}
        if (opts.silent) return;
        // Throttle toasts so repeated stalls don't spam.
        var now = Date.now();
        if (now - lastFailToastAt < 6000) return;
        lastFailToastAt = now;
        var existing = document.getElementById('__handoff-fail-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = '__handoff-fail-toast';
        toast.className = 'dv-honest-toast';
        toast.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,0.95);color:#fff;padding:12px 18px;border-radius:10px;font-size:14px;z-index:99999;font-family:PlusJakartaSans,sans-serif;max-width:460px;text-align:center;line-height:1.4;display:flex;flex-direction:column;gap:8px;';
        var msg = document.createElement('div');
        msg.textContent = 'The TV’s built-in player didn’t open — resuming here. This stream may be too heavy for the TV browser; try a 1080p or MP4 version of this title.';
        toast.appendChild(msg);
        var btn = document.createElement('button');
        btn.textContent = 'OK';
        btn.style.cssText = 'background:rgba(255,255,255,0.14);color:#fff;border:none;border-radius:8px;padding:6px 16px;font-size:13px;font-family:inherit;font-weight:600;cursor:pointer;align-self:center;';
        btn.setAttribute('tabindex', '0');
        btn.onfocus = function() { this.style.outline = '2px solid #fff'; };
        btn.onblur = function() { this.style.outline = 'none'; };
        btn.onclick = function() { toast.remove(); };
        toast.appendChild(btn);
        document.body.appendChild(toast);
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 9000);
    };

    // The ONE launcher. Returns Promise<boolean> = verified opened?
    // opts: { verifyTimeoutMs, watchedDelayMs } (test/override hooks)
    window.__launchNativePlayer = function(url, opts) {
        opts = opts || {};
        var verifyMs = opts.verifyTimeoutMs != null ? opts.verifyTimeoutMs
            : (window.__NATIVE_VERIFY_TIMEOUT_MS__ != null ? window.__NATIVE_VERIFY_TIMEOUT_MS__ : DEFAULT_VERIFY_MS);
        var watchedDelay = opts.watchedDelayMs != null ? opts.watchedDelayMs : DEFAULT_WATCHED_DELAY_MS;

        if (!hasNative()) {
            console.log('[native] omi_platform unavailable — native player not supported on this device');
            return Promise.resolve(false);
        }
        if (!url) {
            var video = document.querySelector('video');
            url = video ? video.currentSrc || video.src : null;
        }
        if (!url) { console.log('[native] No stream URL found'); return Promise.resolve(false); }

        var title = getPlayerTitle() || 'Stremio';
        var mimeType = guessNativeMimeType(url);
        console.log('[native] Attempting native handoff (title:', title + '):', String(url).substring(0, 100));

        // Arm verification BEFORE sending so we don't miss a fast backgrounding.
        var verifyPromise = verifyBackgrounding(verifyMs);

        // Fire-and-forget — try every message type; swallow throws. Sending says
        // NOTHING about whether the native player actually opened.
        var messages = [
            {type: 'launchNativePlayer', url: url, title: title, mimeType: mimeType},
            {type: 'openMediaPlayer', url: url, title: title},
            {type: 'playVideo', url: url, mimeType: mimeType, title: title}
        ];
        for (var i = 0; i < messages.length; i++) {
            try {
                omi_platform.sendPlatformMessage(JSON.stringify(messages[i]));
                console.log('[native] Sent (unacked):', messages[i].type);
            } catch(e) {
                console.log('[native] Send threw:', messages[i].type, e.message);
            }
        }

        return verifyPromise.then(function(opened) {
            if (!opened) {
                console.warn('[native] No backgrounding signal within ' + verifyMs + 'ms — treating handoff as FAILED.');
                return false;
            }
            console.log('[native] Backgrounding observed — handoff VERIFIED.');
            // Only on a VERIFIED handoff, and only if the user enabled watched
            // tracking, record + (after delay) mark as watched. No resume-point
            // corruption ever.
            if (watchedTrackingEnabled()) {
                try {
                    var v = document.querySelector('video');
                    var handoff = {
                        hash: window.location.hash || '',
                        time: Date.now(),
                        duration: v ? v.duration : 0,
                        currentTime: v ? v.currentTime : 0
                    };
                    setTimeout(function() { markAsWatched(handoff); }, watchedDelay);
                } catch(e) {}
            }
            return true;
        });
    };

    // Yellow button (405) — launch native player with current stream.
    // Always bind; check omi_platform at press time so later-injected APIs still work.
    document.addEventListener('keydown', function(e) {
        if (e.keyCode !== 405) return;
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) return;

        function mkToast(text, bg) {
            var toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:' + (bg || 'rgba(0,0,0,0.9)') + ';color:white;padding:20px 40px;border-radius:12px;font-size:1.2rem;font-family:PlusJakartaSans,sans-serif;z-index:100000;pointer-events:none;text-align:center;max-width:500px;';
            toast.textContent = text;
            document.body.appendChild(toast);
            setTimeout(function() { toast.remove(); }, 3500);
            return toast;
        }

        if (!hasNative()) {
            mkToast('Native player not available on this device', 'rgba(180,60,60,0.92)');
            return;
        }

        // Honest flow: show a "trying" hint, then replace with the VERIFIED result.
        var tryToast = mkToast('Trying the TV’s player…', 'rgba(0,0,0,0.9)');
        var video = document.querySelector('video');
        var src = video ? video.currentSrc || video.src : null;
        window.__launchNativePlayer(src).then(function(opened) {
            try { tryToast.remove(); } catch(e) {}
            if (opened) {
                mkToast('Opening in native player…');
            } else {
                mkToast('Couldn’t open the TV’s player — see options', 'rgba(180,60,60,0.92)');
            }
        });
    });

    // User-toggleable: mark-as-watched after a VERIFIED native handoff. OFF by
    // default — since the handoff itself is unreliable on most VIDAA firmware,
    // we never touch library/watched state unless the user opts in.
    var watchedReg = setInterval(function() {
        if (!window.__registerVidaaSettingsItem) return;
        clearInterval(watchedReg);
        window.__registerVidaaSettingsItem({
            id: 'native-handoff-watched-toggle',
            type: 'toggle',
            label: 'Mark Watched After Native Handoff',
            description: 'When the TV’s native player is confirmed to open (the Stremio browser actually backgrounds), mark the title as watched in your library after ~30s. OFF by default — only enable if your TV genuinely opens streams in its built-in player.',
            lsKey: HANDOFF_KEY,
            defaultValue: false
        });
    }, 200);
})();
