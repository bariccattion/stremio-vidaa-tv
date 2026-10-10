// ═══════════════════════════════════════════════════════════════════════
// Task #4 — Helping a TV-only user (no PC) with streams too heavy for the
// VIDAA browser. Two deliverables, RELIABILITY over cleverness:
//   (A) honest, NON-BLOCKING choice card on the no-escape stall path
//   (B) an easy, guided helper-server setup flow
//
// HARD RULES (project): never block / skip / auto-change a stream without the
// user choosing it; no fullscreen overlay that traps the remote (corner card,
// focusable buttons, Back support); everything dismissible.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;

    var CARD_TOGGLE_KEY = 'stremio_heavy_choice_card';

    function serverReady() {
        return RT.serverConfigured();
    }

    // ── Server URL setter — thin wrapper over the serverUrl module (001):
    // write-through localStorage + global + best-effort core push, plus the
    // mirror that reconciles the core afterwards.
    window.__setStremioServerUrl = function(url) {
        return window.__serverUrl ? window.__serverUrl.set(url) : false;
    };

    // ── Read the current title's streams from core and find a direct-play
    // friendly one (≤1080p, MP4/H.264, or moderate HEVC-in-MP4). Cheap label
    // heuristic on the standard Stremio addon naming convention — the label
    // predicates live in kernel/streams.js. Returns the stream object or null.
    var STR = window.__vidaaStreams;
    function streamText(s) { return STR.text(s); }
    function isHeavyStreamText(t) {
        return STR.is4k(t) || STR.isMkv(t);
    }
    function isDirectPlayText(t) {
        // Friendly: explicitly ≤1080p AND (mp4 or h264/avc/x264), OR an mp4 that
        // is not flagged 4K/HEVC-heavy.
        var lowRes = /1080p|720p|480p/.test(t);
        var isMp4 = STR.isMp4(t);
        var isH264 = STR.isH264(t);
        var heavy = isHeavyStreamText(t);
        if (heavy) return false;
        if (lowRes && (isMp4 || isH264)) return true;
        if (isMp4 && !STR.isHevc(t)) return true; // plain MP4
        return false;
    }

    // Direct-play finder (RT.core seam, P1.1): the real stream list is
    // meta_details.addonStreams. getState is a Promise — the OLD code
    // consumed it synchronously from the invalid 'streaming' field, so this
    // finder always returned null and the card's one-tap switch never
    // worked. Now each call kicks off an async refresh and returns the last
    // cached pick synchronously (the card renders at stall time, after the
    // coordinator's window has kept the cache warm).
    var directPlayCache = null;

    function flattenStreams(state) {
        var streams = [];
        if (state && Array.isArray(state.addonStreams)) {
            for (var g = 0; g < state.addonStreams.length; g++) {
                var content = state.addonStreams[g] && state.addonStreams[g].content;
                if (Array.isArray(content)) {
                    for (var c = 0; c < content.length; c++) streams.push(content[c]);
                }
            }
        }
        return streams;
    }

    function pickDirectPlay(streams) {
        if (!streams.length) return null;
        // Prefer a 1080p MP4/H.264 over anything else.
        var best = null, bestRank = -1;
        for (var i = 0; i < streams.length; i++) {
            var s = streams[i];
            if (!s || !(s.url || (s.deepLinks && s.deepLinks.player))) continue;
            var t = streamText(s);
            if (!isDirectPlayText(t)) continue;
            var rank = 0;
            if (/1080p/.test(t)) rank += 3; else if (/720p/.test(t)) rank += 2; else rank += 1;
            if (STR.isMp4(t)) rank += 1;
            if (STR.isH264(t)) rank += 1;
            if (rank > bestRank) { bestRank = rank; best = s; }
        }
        return best;
    }

    window.__findDirectPlayStream = function() {
        if (!(RT.core && RT.core.getState)) return null;
        RT.core.getState('meta_details').then(function(state) {
            directPlayCache = pickDirectPlay(flattenStreams(state));
        }).catch(function() {});
        return directPlayCache;
    };

    // ── Navigate from the player back to the streams list (metadetails) for the
    // SAME title. Robust: reconstruct the metadetails hash from the player hash
    // params (type/id/videoId); fall back to history.back(). Never auto-plays a
    // different stream — the user picks from the list.
    //
    // Accepts an optional `playerHash` so the caller can pass the hash captured
    // at the moment the stall was detected — this stays correct even if the app
    // has since navigated elsewhere (e.g. an unauthenticated redirect).
    window.__navigateToStreamsList = function(playerHash) {
        var hash = playerHash || window.location.hash || '';
        if (hash.indexOf('#/player/') === 0) {
            // #/player/<stream>/<streamTransportUrl>/<metaTransportUrl>/<type>/<id>/<videoId>
            var parts = hash.replace('#/player/', '').split('/');
            // type, id, videoId are the last three segments when present.
            if (parts.length >= 6) {
                var type = parts[3], id = parts[4], videoId = parts[5];
                if (type && id) {
                    var target = '#/metadetails/' + type + '/' + id + (videoId ? ('/' + videoId) : '');
                    window.location.hash = target;
                    return target;
                }
            }
            // Couldn't parse — robust fallback.
            try { window.history.back(); } catch(e) {}
            return null;
        }
        try { window.history.back(); } catch(e) {}
        return null;
    };

    function cardEnabled() {
        // Default ON: this is the user's lifeline when a stream won't play. Still
        // toggleable, and only ever appears on the explicit no-escape stall path.
        return RT.store.getBool(CARD_TOGGLE_KEY, true);
    }
    window.__heavyChoiceCardEnabled = cardEnabled;

    function mkButton(label, primary) {
        return window.__vidaaUI.button(label, { primary: primary, small: true });
    }

    function smallToast(text) {
        window.__vidaaUI.toastTop(text);
    }

    // ── (A) The non-blocking choice card. ──────────────────────────────────
    window.__showHeavyStreamChoiceCard = function() {
        if (document.getElementById('dv-heavy-choice')) return;

        // Capture the player hash NOW (when the stall is detected) so the
        // "back to streams" action stays correct even if the route changes later.
        var capturedPlayerHash = window.location.hash || '';

        var card = document.createElement('div');
        card.id = 'dv-heavy-choice';
        // Corner card — explicitly NOT fullscreen, never traps the remote.
        card.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);max-width:560px;width:auto;background:rgba(18,18,22,0.97);color:#fff;padding:18px 22px;border-radius:14px;font-family:PlusJakartaSans,sans-serif;z-index:99999;display:flex;flex-direction:column;gap:12px;text-align:center;line-height:1.45;box-shadow:0 10px 40px rgba(0,0,0,0.6);';

        var msg = document.createElement('div');
        msg.style.cssText = 'font-size:14px;color:rgba(255,255,255,0.92);';
        msg.textContent = 'This stream looks too heavy for the TV’s built-in browser. How would you like to handle it?';
        card.appendChild(msg);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';

        // 1) PRIMARY — show a version that plays here.
        var playsBtn = mkButton('Show me a version that plays here', true);
        playsBtn.onclick = function() {
            card.remove();
            var direct = null;
            try { direct = window.__findDirectPlayStream(); } catch(e) {}
            if (direct && (direct.url || (direct.deepLinks && direct.deepLinks.player))) {
                // One-tap switch is available AND user chose it (not silent).
                var name = (direct.title || direct.name || 'a lighter version').toString().substring(0, 60);
                smallToast('Switching to ' + name + ' — these play on this TV.');
                try {
                    if (direct.deepLinks && direct.deepLinks.player) {
                        window.location.hash = direct.deepLinks.player;
                    } else {
                        // No deepLink: no honest programmatic play exists (the
                        // old 'StreamClicked' core action never existed
                        // upstream) — send the user to the streams list.
                        window.__navigateToStreamsList(capturedPlayerHash);
                    }
                } catch(e) { window.__navigateToStreamsList(capturedPlayerHash); }
                return;
            }
            // Robust baseline: back to the streams list + guidance.
            window.__navigateToStreamsList(capturedPlayerHash);
            smallToast('Pick a 1080p or MP4 / H.264 source — those play on this TV.');
        };
        row.appendChild(playsBtn);

        // 2) Set up free helper for 4K (opens flow B).
        var helperBtn = mkButton('Set up free helper for 4K');
        helperBtn.onclick = function() {
            card.remove();
            if (typeof window.__showHelperServerSetup === 'function') window.__showHelperServerSetup();
        };
        row.appendChild(helperBtn);

        // 3) Keep trying this one — dismiss, leave playback ALONE.
        var keepBtn = mkButton('Keep trying this one');
        keepBtn.onclick = function() { card.remove(); };
        row.appendChild(keepBtn);

        card.appendChild(row);
        document.body.appendChild(card);
        setTimeout(function() { playsBtn.focus(); }, 60);
        // Auto-hide so it never lingers; does NOT touch playback.
        setTimeout(function() { if (card.parentNode) card.remove(); }, 20000);
    };

    // ── (B) The guided helper-server setup card. ───────────────────────────
    window.__showHelperServerSetup = function() {
        var existing = document.getElementById('dv-helper-setup');
        if (existing) { existing.remove(); return; }

        var card = document.createElement('div');
        card.id = 'dv-helper-setup';
        // Corner-anchored, scrollable, NOT fullscreen.
        card.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);width:min(620px,92vw);max-height:80vh;overflow:auto;background:rgba(14,14,20,0.98);color:#fff;padding:22px 24px;border-radius:16px;font-family:PlusJakartaSans,sans-serif;z-index:100001;box-shadow:0 12px 50px rgba(0,0,0,0.7);';

        var title = document.createElement('div');
        title.style.cssText = 'font-size:20px;font-weight:800;margin-bottom:8px;';
        title.textContent = 'Set up free helper for 4K';
        card.appendChild(title);

        var steps = document.createElement('div');
        steps.style.cssText = 'font-size:14px;color:rgba(255,255,255,0.82);line-height:1.6;margin-bottom:14px;text-align:left;';
        steps.innerHTML =
            '<div style="margin-bottom:6px;">Heavy 4K files play once a small free helper does the hard work. It is quick:</div>'
            + '<div>1. On your phone or PC <b>on the same Wi-Fi</b>, install Stremio (free) from stremio.com.</div>'
            + '<div>2. Open it — it quietly runs a streaming server in the background.</div>'
            + '<div>3. Find that device’s address (usually like <code>http://192.168.1.x:11470</code>) and type it below.</div>';
        card.appendChild(steps);

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'http://192.168.1.x:11470';
        input.value = (window.__STREMIO_SERVER_URL__ && window.__STREMIO_SERVER_URL__ !== 'http://127.0.0.1:11470') ? window.__STREMIO_SERVER_URL__ : '';
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.35);color:#fff;font-size:16px;font-family:Consolas,monospace;margin-bottom:12px;';
        input.setAttribute('tabindex', '0');
        // Same as settings/server-url-manager.js: keep the VIDAA keyboard
        // autocomplete out of URL fields.
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        card.appendChild(input);

        var status = document.createElement('div');
        status.id = 'dv-helper-status';
        status.style.cssText = 'font-size:14px;min-height:20px;margin-bottom:14px;font-weight:600;';
        card.appendChild(status);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;';

        var saveBtn = mkButton('Save & Check', true);
        saveBtn.onclick = function() {
            var url = (input.value || '').trim();
            if (!url) { status.style.color = '#fbbf24'; status.textContent = 'Type the helper’s address first.'; return; }
            if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
            window.__setStremioServerUrl(url);
            status.style.color = '#fbbf24';
            status.textContent = 'Checking ' + url.replace(/\/+$/, '') + ' …';
            saveBtn.disabled = true;
            RT.probeServer(url, function(res) {
                saveBtn.disabled = false;
                if (res.reachable) {
                    status.style.color = '#4ade80';
                    status.textContent = '✓ Connected — server is reachable (' + res.note + '). 4K transcoding is now available.';
                } else {
                    status.style.color = '#f87171';
                    status.textContent = '✗ Not reachable (' + res.note + '). Check the address and that both devices are on the same Wi-Fi.';
                }
            });
        };
        row.appendChild(saveBtn);

        var closeBtn = mkButton('Close');
        closeBtn.onclick = function() { card.remove(); };
        row.appendChild(closeBtn);

        card.appendChild(row);
        document.body.appendChild(card);
        setTimeout(function() { input.focus(); }, 60);
    };

    // ── Settings registration: choice-card toggle + helper-server launcher. ──
    RT.onRegistryReady(function() {
        window.__registerVidaaSettingsItem({
            id: 'heavy-stream-choice-card-toggle',
            type: 'toggle',
            label: 'Heavy-Stream Help Card',
            description: 'When a stream is too heavy for the TV browser and nothing else works, show a small dismissible card offering to find a lighter version, set up a 4K helper server, or keep trying. Never blocks or skips the stream. ON by default.',
            lsKey: CARD_TOGGLE_KEY,
            defaultValue: true
        });
        window.__registerVidaaSettingsItem({
            id: 'helper-server-setup-item',
            type: 'button',
            label: 'Set up helper server (for 4K)',
            description: 'Point this TV at a free Stremio streaming server (running on your phone or PC on the same Wi-Fi) so heavy 4K files get remuxed/transcoded and actually play. Step-by-step, with a reachability check.',
            onClick: function() { window.__showHelperServerSetup(); },
            onToggle: function() { window.__showHelperServerSetup(); }
        });
    });
})();
