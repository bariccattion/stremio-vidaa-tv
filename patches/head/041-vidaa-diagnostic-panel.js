// ═══════════════════════════════════════════════════════════════════════
// VIDAA Diagnostic — one-tap, screenshot-friendly device/feature report.
// ═══════════════════════════════════════════════════════════════════════
// The TV has no clipboard, so users photograph this panel. It surfaces the
// facts needed to diagnose buffering / native-handoff issues PER DEVICE:
//   • device model / firmware / chipset (Hisense_* APIs, safe fallbacks)
//   • whether omi_platform AND omi_platform.sendPlatformMessage actually exist
//     on THIS device — the key datum that proves/disproves the native handoff
//   • whether the configured streaming server is reachable (short-timeout fetch)
//   • failing stream container/codec/resolution/bitrate (window.__STREAM_INFO__)
//   • which buffering-related toggles are currently ON
//
// Reachable two ways (projector remotes have NO number keys — color keys only):
//   • Settings ▸ VIDAA item ("Run Diagnostic")
//   • In-player combo: Green (404) then Red (403) within 1.5s. This combo does
//     not collide with the single-press bindings (Yellow=405 native,
//     Blue=406 transcode, Red/Info=stream info, Green=server health) because it
//     requires the two-key sequence Green→Red specifically.
(function() {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function safeCall(fn) {
        try {
            if (typeof fn === 'function') {
                var v = fn();
                return (v === undefined || v === null || v === '') ? null : v;
            }
        } catch(e) {}
        return null;
    }

    function getDeviceInfo() {
        var H = window.Hisense_GetModelName ? window : (window.parent || window);
        function pick(name) {
            try { return safeCall(window[name]) || safeCall(H[name]); } catch(e) { return null; }
        }
        return {
            model: pick('Hisense_GetModelName') || (window.__VIDAA_CAPS__ && window.__VIDAA_CAPS__.model) || 'unknown',
            firmware: pick('Hisense_GetFirmWareVersion') || pick('Hisense_GetFirmwareVersion') || 'unknown',
            chipset: pick('Hisense_GetChipSetName') || pick('Hisense_GetChipsetName') || (window.__VIDAA_CAPS__ && window.__VIDAA_CAPS__.chipset) || 'unknown'
        };
    }

    function nativeApiStatus() {
        var omiExists = false, sendExists = false;
        try { omiExists = (typeof omi_platform !== 'undefined') && !!omi_platform; } catch(e) {}
        try { sendExists = omiExists && typeof omi_platform.sendPlatformMessage === 'function'; } catch(e) {}
        return { omiExists: omiExists, sendExists: sendExists };
    }

    function activeToggles() {
        var keys = {
            'Auto Native (MKV)': 'stremio_auto_native_player_mkv',
            'Auto Native (all)': 'stremio_auto_native_player',
            'Mark Watched on Handoff': 'stremio_native_handoff',
            'Playback Warning': 'stremio_playback_warning',
            'Honest Stall Advice': 'stremio_honest_stall_msg',
            'Force Stereo': 'stremio_force_stereo'
        };
        var on = [];
        for (var label in keys) {
            try { if (localStorage.getItem(keys[label]) === 'true') on.push(label); } catch(e) {}
        }
        return on.length ? on.join(', ') : 'none';
    }

    // Shared streaming-server reachability probe — used by the diagnostic AND
    // the helper-server setup flow so both behave identically. Probes
    // `GET <url>/settings` with a short AbortController timeout.
    if (!window.__probeStremioServer) {
        window.__probeStremioServer = function(url, cb, timeoutMs) {
            url = (url || '').replace(/\/+$/, '');
            if (!url) { cb({ url: '(none configured)', reachable: false, note: 'no URL' }); return; }
            var done = false;
            var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var t = setTimeout(function() { if (ctrl) { try { ctrl.abort(); } catch(e) {} } if (!done) { done = true; cb({ url: url, reachable: false, note: 'timed out' }); } }, timeoutMs || 2500);
            try {
                fetch(url + '/settings', ctrl ? { signal: ctrl.signal } : undefined)
                    .then(function(r) { return r.ok ? r.json().catch(function() { return {}; }) : Promise.reject(new Error('HTTP ' + r.status)); })
                    .then(function(data) {
                        if (done) return; done = true; clearTimeout(t);
                        var v = data && (data.serverVersion || data.version || (data.values && data.values.serverVersion));
                        cb({ url: url, reachable: true, note: v ? ('v' + v) : 'online' });
                    })
                    .catch(function(e) { if (done) return; done = true; clearTimeout(t); cb({ url: url, reachable: false, note: (e && e.message) || 'unreachable' }); });
            } catch(e) {
                if (!done) { done = true; clearTimeout(t); cb({ url: url, reachable: false, note: 'fetch error' }); }
            }
        };
    }
    function checkServer(cb) {
        window.__probeStremioServer(window.__STREMIO_SERVER_URL__ || '', cb);
    }

    window.__showVidaaDiagnostic = function() {
        var existing = document.getElementById('vidaa-diagnostic');
        if (existing) { existing.remove(); return; }

        var dev = getDeviceInfo();
        var api = nativeApiStatus();
        var si = window.__STREAM_INFO__ || {};
        var container = si.container || (function() {
            try {
                var v = document.querySelector('video');
                var src = v ? (v.currentSrc || v.src || '') : '';
                var p = src.split('?')[0].toLowerCase();
                var m = p.match(/\.(mkv|mp4|m4v|webm|m3u8|mpd|mov)$/);
                return m ? m[1] : 'unknown';
            } catch(e) { return 'unknown'; }
        })();
        var res = (si.width || '?') + 'x' + (si.height || '?');
        var bitrate = si.bitrate ? (Math.round(si.bitrate / 1000) + ' kbps') : 'unknown';

        var panel = document.createElement('div');
        panel.id = 'vidaa-diagnostic';
        // BIG, centered, high-contrast — screenshot-friendly. Scrollable, not a
        // remote-trapping modal: the close button is the first focusable element.
        panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(720px,92vw);max-height:88vh;overflow:auto;background:#0c0c12;color:#fff;padding:28px 32px;border-radius:16px;font-family:PlusJakartaSans,monospace;z-index:100001;box-shadow:0 12px 50px rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.08);';

        function row(label, value, color) {
            return '<div style="display:flex;justify-content:space-between;gap:18px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:17px;">'
                + '<span style="color:rgba(255,255,255,0.55);">' + esc(label) + '</span>'
                + '<span style="font-weight:700;color:' + (color || '#fff') + ';text-align:right;word-break:break-all;">' + esc(value) + '</span></div>';
        }

        var handoffColor = api.sendExists ? '#4ade80' : '#f87171';
        var html = '<div style="font-size:24px;font-weight:800;margin-bottom:6px;">VIDAA Diagnostic</div>'
            + '<div style="font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:18px;">Photograph this screen to share when reporting a buffering issue.</div>'
            + '<div style="font-size:13px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin:14px 0 4px;">Device</div>'
            + row('Model', dev.model)
            + row('Firmware', dev.firmware)
            + row('Chipset', dev.chipset)
            + '<div style="font-size:13px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin:14px 0 4px;">Native player handoff</div>'
            + row('omi_platform present', api.omiExists ? 'YES' : 'NO', api.omiExists ? '#4ade80' : '#f87171')
            + row('sendPlatformMessage', api.sendExists ? 'YES (bridge present)' : 'NO', handoffColor)
            + '<div style="font-size:12px;color:rgba(255,255,255,0.45);padding:6px 0;line-height:1.4;">Note: even when the bridge is present, no confirmed VIDAA firmware acts on the play-video messages — the handoff is verified only by the browser actually backgrounding.</div>'
            + '<div style="font-size:13px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin:14px 0 4px;">Streaming server</div>'
            + '<div id="vidaa-diag-server">' + row('Server', 'checking…', '#fbbf24') + '</div>'
            + '<div style="font-size:13px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin:14px 0 4px;">Failing stream</div>'
            + row('Container', container)
            + row('Codec', si.videoCodec || 'unknown')
            + row('Resolution', res)
            + row('Bitrate', bitrate)
            + '<div style="font-size:13px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin:14px 0 4px;">Buffering toggles ON</div>'
            + row('Active', activeToggles());

        panel.innerHTML = html;

        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.cssText = 'margin-top:20px;width:100%;background:#7b5bf5;color:#fff;border:none;border-radius:10px;padding:12px;font-size:16px;font-family:inherit;font-weight:700;cursor:pointer;';
        closeBtn.setAttribute('tabindex', '0');
        closeBtn.onfocus = function() { this.style.outline = '3px solid #a78bfa'; };
        closeBtn.onblur = function() { this.style.outline = 'none'; };
        closeBtn.onclick = function() { panel.remove(); };
        // Insert close button as the FIRST child so spatial nav lands on it,
        // but visually keep it at the bottom via appendChild ordering.
        panel.appendChild(closeBtn);

        document.body.appendChild(panel);
        setTimeout(function() { closeBtn.focus(); }, 60);

        // Async server reachability — update the placeholder when it resolves.
        checkServer(function(s) {
            var slot = document.getElementById('vidaa-diag-server');
            if (!slot) return;
            slot.innerHTML = row('URL', s.url)
                + row('Reachable', s.reachable ? 'YES' : 'NO', s.reachable ? '#4ade80' : '#f87171')
                + row('Status', s.note, s.reachable ? '#4ade80' : '#f87171');
        });
    };

    // In-player color-button combo: Green (404) then Red (403) within 1.5s.
    var greenAt = 0;
    document.addEventListener('keydown', function(e) {
        if (e.keyCode === 404) { greenAt = Date.now(); return; }
        if (e.keyCode === 403) {
            if (greenAt && (Date.now() - greenAt) < 1500) {
                greenAt = 0;
                // Combo fired: suppress the single-press Red handler (quality
                // indicator) so we don't pop an overlay underneath the diagnostic.
                e.stopImmediatePropagation();
                e.preventDefault();
                window.__showVidaaDiagnostic();
            }
        }
    }, true); // capture phase so we intercept before the single-press handlers act

    // Settings ▸ VIDAA launchable item.
    var reg = setInterval(function() {
        if (!window.__registerVidaaSettingsItem) return;
        clearInterval(reg);
        window.__registerVidaaSettingsItem({
            id: 'vidaa-diagnostic-item',
            type: 'button',
            label: 'Run VIDAA Diagnostic',
            description: 'Shows a big, screenshot-friendly panel with your TV model/firmware/chipset, whether the native-player bridge exists on this device, whether your streaming server is reachable, and the failing stream’s details. In the player you can also press Green then Red. Photograph it to report buffering issues.',
            onClick: function() { window.__showVidaaDiagnostic(); },
            onToggle: function() { window.__showVidaaDiagnostic(); }
        });
    }, 200);
})();
