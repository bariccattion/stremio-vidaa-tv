(function() {
    var LS_KEY = 'stremio_auto_rebuffer';
    var PREFIX = '[rebuffer]';
    var CHECK_INTERVAL = 2000;   // ms between currentTime checks
    var STALL_THRESHOLD = 8000;  // ms of no progress = stall
    var MAX_RETRIES = 3;

    function isEnabled() {
        return localStorage.getItem(LS_KEY) !== 'false';
    }

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift(PREFIX);
        console.log.apply(console, args);
    }

    function showToast(msg) {
        var existing = document.getElementById('__rebuffer-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = '__rebuffer-toast';
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);' +
            'background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;border-radius:8px;' +
            'font-size:14px;z-index:99999;pointer-events:none;';
        document.body.appendChild(toast);
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 5000);
    }

    function inPlayerRoute() {
        return window.location.hash.indexOf('#/player/') !== -1;
    }

    var stallTimer = 0;
    var lastTime = null;
    var retries = 0;
    var monitorInterval = null;
    var activeVideo = null;

    function resetStall() {
        stallTimer = 0;
        retries = 0;
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
            var b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'background:' + color + ';color:#fff;border:none;border-radius:8px;' +
                'padding:8px 14px;font-size:13px;font-family:inherit;font-weight:600;cursor:pointer;';
            b.setAttribute('tabindex', '0');
            b.onfocus = function() { this.style.outline = '2px solid #fff'; };
            b.onblur = function() { this.style.outline = 'none'; };
            return b;
        }

        var hasNative = false;
        try { hasNative = typeof omi_platform !== 'undefined' && typeof omi_platform.sendPlatformMessage === 'function'; } catch(e) {}

        if (hasNative) {
            var nativeBtn = mkBtn('Native Player', '#7b5bf5');
            nativeBtn.onclick = function() {
                if (!window.__launchNativePlayer) { toast.remove(); return; }
                // H5: keep the toast until we know whether the native player
                // actually opened. On failure, resume browser playback + advise.
                nativeBtn.textContent = 'Trying…';
                nativeBtn.disabled = true;
                var v = (typeof video !== 'undefined' && video) ? video : document.querySelector('video');
                var src = v ? v.currentSrc || v.src : null;
                Promise.resolve(window.__launchNativePlayer(src)).then(function(opened) {
                    if (opened) {
                        toast.remove();
                    } else {
                        toast.remove();
                        if (typeof window.__recoverAfterFailedHandoff === 'function') {
                            window.__recoverAfterFailedHandoff(v);
                        }
                    }
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

    function attemptRebuffer(video) {
        retries++;
        log('Stall detected (retry', retries, '/ ' + MAX_RETRIES + ')');

        if (retries > MAX_RETRIES) {
            log('Max retries reached — offering recovery options');
            showRecoveryToast(video);
            // Reset so we try again if the user keeps waiting — never leave them stuck.
            resetStall();
            return;
        }

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
    }

    function checkStall() {
        if (!inPlayerRoute()) return;

        var video = document.querySelector('video');
        if (!video) { lastTime = null; return; }

        // New video element
        if (video !== activeVideo) {
            activeVideo = video;
            lastTime = null;
            resetStall();
            video.addEventListener('playing', resetStall);
            video.addEventListener('seeked', resetStall);
        }

        if (video.paused || video.ended || video.readyState < 2) {
            lastTime = video.currentTime;
            return;
        }

        if (lastTime === null) {
            lastTime = video.currentTime;
            return;
        }

        if (video.currentTime === lastTime) {
            stallTimer += CHECK_INTERVAL;
            if (stallTimer >= STALL_THRESHOLD) {
                attemptRebuffer(video);
                stallTimer = 0; // reset timer between retries
            }
        } else {
            // Progress made — reset
            if (stallTimer > 0) log('Stall cleared — playback resumed');
            stallTimer = 0;
            retries = 0;
        }

        lastTime = video.currentTime;
    }

    function startMonitor() {
        if (monitorInterval) return;
        monitorInterval = setInterval(checkStall, CHECK_INTERVAL);
        log('Stall monitor started');
    }

    function stopMonitor() {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
        lastTime = null;
        resetStall();
        log('Stall monitor stopped');
    }

    function onHashChange() {
        if (!isEnabled()) return;
        if (inPlayerRoute()) {
            startMonitor();
        } else {
            stopMonitor();
        }
    }

    function init() {
        if (!isEnabled()) {
            log('Auto-rebuffer disabled (set localStorage stremio_auto_rebuffer=true to enable)');
            return;
        }
        window.addEventListener('hashchange', onHashChange);
        onHashChange();
        log('Auto-rebuffer on stall initialised');
    }

    if (window.__registerCommunityToggle) {
        window.__registerCommunityToggle({
            id: 'auto-rebuffer-toggle',
            lsKey: LS_KEY,
            title: 'Auto-Rebuffer on Stall',
            description: 'Detects playback stalls and automatically attempts to resume without user intervention',
            onToggle: function(nowEnabled) {
                log('Toggled:', nowEnabled ? 'ON' : 'OFF');
                if (nowEnabled) {
                    window.addEventListener('hashchange', onHashChange);
                    onHashChange();
                } else {
                    stopMonitor();
                    window.removeEventListener('hashchange', onHashChange);
                }
            }
        });
    }

    init();
})();
