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

    var RT = window.__vidaaRuntime;
    var esc = window.__vidaaUI.esc; // shared kernel esc (also escapes quotes)

    // safeCall is deliberately LOCAL: unlike UI.safe it folds empty-string
    // results into null, which the device-info rows below rely on.
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
            if (RT.store.getBool(keys[label], false)) on.push(label);
        }
        return on.length ? on.join(', ') : 'none';
    }

    // Shared streaming-server reachability probe — the runtime kernel owns
    // the implementation (GET /settings, AbortController timeout). The old
    // `__probeStremioServer` cross-patch alias was removed in P1.7:
    // consumers call RT.probeServer directly.
    function checkServer(cb) {
        RT.probeServer(window.__STREMIO_SERVER_URL__ || '', cb);
    }

    // ── Device section of the unified diagnostics panel (044). The big,
    // screenshot-friendly rows live on; the chrome (tabs, close, Back/
    // Escape) belongs to the shell.
    RT.when(function() { return !!window.__vidaaRegisterDiagnostic; }, function() {
        window.__vidaaRegisterDiagnostic({
            id: 'device',
            label: 'Device',
            render: function(body) {
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

                function row(label, value, color) {
                    return '<div style="display:flex;justify-content:space-between;gap:18px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:17px;">'
                        + '<span style="color:rgba(255,255,255,0.55);">' + esc(label) + '</span>'
                        + '<span style="font-weight:700;color:' + (color || '#fff') + ';text-align:right;word-break:break-all;">' + esc(value) + '</span></div>';
                }

                var handoffColor = api.sendExists ? '#4ade80' : '#f87171';
                body.innerHTML = '<div style="font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:14px;">Photograph this tab to share when reporting a buffering issue.</div>'
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

                // Async server reachability — update the placeholder when it
                // resolves (guarded: the section body may have been switched).
                checkServer(function(s) {
                    if (!body.isConnected) return;
                    var slot = body.querySelector('#vidaa-diag-server');
                    if (!slot) return;
                    slot.innerHTML = row('URL', s.url)
                        + row('Reachable', s.reachable ? 'YES' : 'NO', s.reachable ? '#4ade80' : '#f87171')
                        + row('Status', s.note, s.reachable ? '#4ade80' : '#f87171');
                });
            }
        });
    });

    // Legacy entry point: Settings rows and the Green→Red combo call this.
    window.__showVidaaDiagnostic = function() {
        if (window.__vidaaDiagnostics) window.__vidaaDiagnostics.show('device');
    };

    // In-player color-button combo: Green (404) then Red (403) within 1.5s.
    // Declared as a sequence combo — the dispatcher fires it before any
    // plain Red handler and suppresses the rest of the press.
    window.__vidaaKeys.on('green+red', function() {
        window.__showVidaaDiagnostic();
    }, { window: 1500, priority: 500, suppress: true });

    // Settings ▸ VIDAA launchable item: REMOVED (P1.7) — blob.js's
    // "Diagnostics" row already opens this same panel (and is the entry
    // the settings ORDER lists); two rows for one feature appended
    // unorderly at the bottom of the section.
})();
