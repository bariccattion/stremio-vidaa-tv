// #22 — Auto-Rebuffer on Stall (refactored onto the kernel stall
// coordinator, P1.2). Detection (frozen currentTime ≥8 s while playing)
// lives in kernel/playback-health.js; this patch only declares the
// recovery strategy: seek +1 s (up to 3 attempts), then pause+re-seek,
// then the recovery toast with a Native Player option. The coordinator
// re-invokes the strategy every 8 s while the stall persists (ladder
// semantics preserved) and closes the episode on progress.
(function() {
    var RT = window.__vidaaRuntime;
    var LS_KEY = 'stremio_auto_rebuffer';
    var log = RT.logger('rebuffer');
    var MAX_RETRIES = 3;

    function isEnabled() {
        return RT.store.getBool(LS_KEY, true);
    }

    function showRecoveryToast(video) {
        // Non-blocking corner toast with action buttons — user is never trapped.
        var existing = document.getElementById('__rebuffer-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = '__rebuffer-toast';
        toast.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);' +
            'background:rgba(0,0,0,0.9);color:#fff;padding:12px 18px;border-radius:10px;' +
            'font-size:14px;z-index:99999;display:flex;flex-direction:column;gap:10px;' +
            'font-family:PlusJakartaSans,sans-serif;max-width:440px;text-align:center;';

        var msg = document.createElement('div');
        msg.textContent = 'Playback keeps stalling. You can pick another stream — or try one of these.';
        toast.appendChild(msg);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';

        function mkBtn(label, color) {
            return window.__vidaaUI.button(label, { bg: color, small: true });
        }

        var hasNative = window.__hasNativePlayer ? window.__hasNativePlayer() : false;

        if (hasNative) {
            var nativeBtn = mkBtn('Native Player', '#7b5bf5');
            nativeBtn.onclick = function() {
                if (!window.__handoffAndRecover) { toast.remove(); return; }
                // H5: keep the toast until we know whether the native player
                // actually opened. On failure, the wrapper resumes browser
                // playback + advises.
                nativeBtn.textContent = 'Trying…';
                nativeBtn.disabled = true;
                var v = video || document.querySelector('video');
                var src = v ? v.currentSrc || v.src : null;
                window.__handoffAndRecover(v, src, function() {
                    toast.remove();
                });
            };
            row.appendChild(nativeBtn);
        }

        var dismiss = mkBtn('Keep Trying', 'rgba(255,255,255,0.12)');
        dismiss.onclick = function() { toast.remove(); };
        row.appendChild(dismiss);

        toast.appendChild(row);
        document.body.appendChild(toast);
        // Auto-hide after 12s
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 12000);
    }

    // Ladder bookkeeping per stall episode (the coordinator assigns each
    // episode a fresh id; retries reset with it).
    var episodeId = null;
    var retries = 0;

    function ladderStep(video, ep) {
        if (ep.id !== episodeId) {
            episodeId = ep.id;
            retries = 0;
        }
        retries++;
        log('Stall detected (attempt', retries + ')');

        if (retries <= MAX_RETRIES) {
            // Try seeking forward 1 second first (less disruptive than reload)
            try {
                var seekTarget = video.currentTime + 1;
                if (video.duration && seekTarget < video.duration) {
                    log('Seeking forward 1 second to', seekTarget);
                    video.currentTime = seekTarget;
                } else {
                    // Pause and re-seek to current position to trigger re-buffer.
                    // Avoid video.load() — it resets the source entirely, which
                    // kills torrent streams and forces a full re-download.
                    log('Pause + re-seek to trigger rebuffer');
                    var pos = video.currentTime;
                    video.pause();
                    video.currentTime = pos;
                    var p = video.play();
                    if (p && p.catch) p.catch(function(e) { log('play() rejected:', e.message); });
                }
            } catch (e) {
                log('Rebuffer attempt error:', e.message);
            }
            return;
        }

        // Exhausted: offer recovery options — re-offered roughly every 32 s
        // (every 4th post-exhaustion invocation) while the stall persists,
        // matching the old ~32 s cycle. Never leaves the user stuck.
        if ((retries - MAX_RETRIES) % 4 === 1) {
            log('Max retries reached — offering recovery options');
            showRecoveryToast(video);
        }
    }

    if (RT.stall) {
        RT.stall.register({
            id: 'auto-rebuffer',
            phase: 'recover',
            priority: 200,
            type: '*',           // frozen, start (t≈0) and early alike
            when: isEnabled,
            act: function(video, ep) {
                ladderStep(video, ep);
                return true;     // claimed — re-invoked while the stall persists
            }
        });
        log('registered on the stall coordinator');
    } else {
        log.error('stall coordinator unavailable — auto-rebuffer inactive');
    }

    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'auto-rebuffer-toggle',
            lsKey: LS_KEY,
            defaultValue: true,
            title: 'Auto-Rebuffer on Stall',
            description: 'Detects playback stalls and automatically attempts to resume without user intervention',
            onToggle: function(nowEnabled) {
                log('Toggled:', nowEnabled ? 'ON' : 'OFF');
            }
        });
    }

    log('Auto-rebuffer strategy initialised');
})();
