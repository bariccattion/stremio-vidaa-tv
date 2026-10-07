// ═══════════════════════════════════════════════════════════════════════
// Honest stall messaging — replaces the old lies with the truth.
// ═══════════════════════════════════════════════════════════════════════
// Shown when a stream is clearly stalling and NO working escape exists
// (native handoff failed AND no streaming server). Deliberately NON-blocking
// and dismissible: a fullscreen overlay that traps the remote is a known
// projector regression, so this is a small corner card with a focusable button.
// We NEVER auto-skip or block the stream (project rule: never silently block).
// Toggleable; OFF by default to avoid surprising users who recover on their own.
(function() {
    'use strict';
    var LS_KEY = 'stremio_honest_stall_msg';
    var lastShownAt = 0;

    function enabled() {
        try { return localStorage.getItem(LS_KEY) === 'true'; } catch(e) { return false; }
    }
    function serverReady() {
        var u = window.__STREMIO_SERVER_URL__ || '';
        return !!(u && u !== 'http://127.0.0.1:11470');
    }

    window.__showHonestStallMessage = function() {
        if (document.getElementById('dv-honest-stall')) return;
        var now = Date.now();
        if (now - lastShownAt < 15000) return; // throttle
        lastShownAt = now;

        var card = document.createElement('div');
        card.id = 'dv-honest-stall';
        // Corner card — explicitly NOT fullscreen, never traps the remote.
        card.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);max-width:520px;width:auto;background:rgba(20,20,20,0.96);color:#fff;padding:16px 20px;border-radius:12px;font-family:PlusJakartaSans,sans-serif;z-index:99999;display:flex;flex-direction:column;gap:10px;text-align:center;line-height:1.45;box-shadow:0 8px 30px rgba(0,0,0,0.5);';

        var msg = document.createElement('div');
        msg.style.cssText = 'font-size:14px;color:rgba(255,255,255,0.92);';
        msg.textContent = 'This 4K stream is too heavy for the TV’s built-in browser. Try a 1080p or MP4 version of this title'
            + (serverReady() ? ', or use your Stremio streaming server to transcode it.' : ', or set up a Stremio streaming server (Settings ▸ Server).');
        card.appendChild(msg);

        var btn = document.createElement('button');
        btn.textContent = 'Got it';
        btn.style.cssText = 'background:rgba(255,255,255,0.16);color:#fff;border:none;border-radius:8px;padding:7px 18px;font-size:13px;font-family:inherit;font-weight:600;cursor:pointer;align-self:center;';
        btn.setAttribute('tabindex', '0');
        btn.onfocus = function() { this.style.outline = '2px solid #fff'; };
        btn.onblur = function() { this.style.outline = 'none'; };
        btn.onclick = function() { card.remove(); };
        card.appendChild(btn);

        document.body.appendChild(card);
        setTimeout(function() { btn.focus(); }, 60);
        setTimeout(function() { if (card.parentNode) card.remove(); }, 14000);
    };

    // Toggleable per project convention.
    var reg = setInterval(function() {
        if (!window.__registerVidaaSettingsItem) return;
        clearInterval(reg);
        window.__registerVidaaSettingsItem({
            id: 'honest-stall-message-toggle',
            type: 'toggle',
            label: 'Honest Stall Advice',
            description: 'When a stream keeps stalling and there is no working fallback (the TV player won’t open and no streaming server is set), show a small, dismissible note explaining the real cause and what actually helps (a lighter source, or a streaming server). Never blocks or skips the stream. OFF by default.',
            lsKey: LS_KEY,
            defaultValue: false
        });
    }, 200);

    // Expose the gate so other code can decide whether to call us.
    window.__honestStallEnabled = enabled;
})();
