// ═══════════════════════════════════════════════════════════════════════
// Server URL manager — configure the streaming server from Settings,
// no launch URL (?server=) needed. The primary setup path:
//   Settings → STREMIO TV → "Streaming Server: …" → type the address →
//   Save & Test (pings it with a timeout) → saved for future sessions.
// Plus an EXPLICIT "Auto-Detect" button that sweeps the LAN for a Stremio
// server on port 11470 (with short per-probe timeouts).
//
// HARD RULES (project): the auto-detect scan is strictly manual — it NEVER
// runs in the background or on startup; the overlay is corner-anchored and
// always dismissible (never traps the remote); ES5 only.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var DEFAULT_URL = 'http://127.0.0.1:11470';
    var SCAN_TIMEOUT_MS = 1200;   // per-candidate probe timeout during the LAN sweep
    var SCAN_CONCURRENCY = 32;    // candidates probed in parallel
    var TEST_TIMEOUT_MS = 3000;   // Save & Test probe timeout

    function normalizeUrl(url) {
        url = (url || '').trim();
        if (!url) return '';
        if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
        return url.replace(/\/+$/, '');
    }

    function isDefaultUrl(url) {
        return !url || url === DEFAULT_URL;
    }

    // ── Save. Patch 042's __setStremioServerUrl (localStorage + window global
    // + WASM-core push) is the normal path and always loads before this patch;
    // the fallback here only covers the localStorage/global part. ──────────
    function setServerUrl(url) {
        if (typeof window.__setStremioServerUrl === 'function') return window.__setStremioServerUrl(url);
        url = normalizeUrl(url);
        if (!url) return false;
        try { localStorage.setItem('stremio_server_url', url); } catch (e) {}
        window.__STREMIO_SERVER_URL__ = url;
        return true;
    }

    // ── Probe. Same contract as patch 041's shared probe (GET /settings with
    // an AbortController timeout); kept as a guarded fallback so this patch
    // stays self-contained. ─────────────────────────────────────────────────
    function probe(url, cb, timeoutMs) {
        if (typeof window.__probeStremioServer === 'function') { window.__probeStremioServer(url, cb, timeoutMs); return; }
        url = (url || '').replace(/\/+$/, '');
        if (!url) { cb({ url: url, reachable: false, note: 'no URL' }); return; }
        var done = false;
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var t = setTimeout(function() { if (ctrl) { try { ctrl.abort(); } catch (e) {} } if (!done) { done = true; cb({ url: url, reachable: false, note: 'timed out' }); } }, timeoutMs || 2500);
        try {
            fetch(url + '/settings', ctrl ? { signal: ctrl.signal } : undefined)
                .then(function(r) { return r.ok ? r.json().catch(function() { return {}; }) : Promise.reject(new Error('HTTP ' + r.status)); })
                .then(function(data) {
                    if (done) return; done = true; clearTimeout(t);
                    var v = data && (data.serverVersion || data.version || (data.values && data.values.serverVersion));
                    cb({ url: url, reachable: true, note: v ? ('v' + v) : 'online' });
                })
                .catch(function(e) { if (done) return; done = true; clearTimeout(t); cb({ url: url, reachable: false, note: (e && e.message) || 'unreachable' }); });
        } catch (e) {
            if (!done) { done = true; clearTimeout(t); cb({ url: url, reachable: false, note: 'fetch error' }); }
        }
    }

    // ── URL parsing / candidate building for the LAN sweep. ────────────────
    function parseUrlParts(url) {
        var m = /^https?:\/\/([^\/?#]+)/i.exec(url || '');
        if (!m) return null;
        var hostport = m[1].split('@').pop();
        var colon = hostport.lastIndexOf(':');
        var host = colon > 0 ? hostport.slice(0, colon) : hostport;
        var port = colon > 0 ? parseInt(hostport.slice(colon + 1), 10) : NaN;
        if (isNaN(port) || port <= 0) port = 11470;
        var subnet = null;
        var ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
        if (ipv4) subnet = ipv4[1] + '.' + ipv4[2] + '.' + ipv4[3];
        return { host: host, port: port, subnet: subnet };
    }

    function candidateUrl(host, port) {
        var u = normalizeUrl(host);
        var m = /^(https?:\/\/)([^\/?#]+)([\/?#].*)?$/i.exec(u);
        if (!m) return u;
        if (/:\d+$/.test(m[2])) return u;
        return m[1] + m[2] + ':' + port + (m[3] || '');
    }

    function buildCandidates() {
        var out = [];
        var seen = {};
        function add(url) { if (url && !seen[url]) { seen[url] = true; out.push(url); } }
        var cur = parseUrlParts(window.__STREMIO_SERVER_URL__ || '');
        var port = (cur && cur.port) || 11470;
        function sweep(subnet) {
            if (!subnet) return;
            for (var i = 1; i <= 254; i++) add('http://' + subnet + '.' + i + ':' + port);
        }
        // The configured server's own subnet first — the most common case is
        // the helper device's DHCP lease moving to a different address. Then
        // the two most common home-router defaults.
        if (cur && cur.subnet) sweep(cur.subnet);
        sweep('192.168.1');
        sweep('192.168.0');
        return out;
    }

    // One reachability probe during the sweep: does ANYTHING answer on this
    // port? A bare "settled" latch (not just AbortController) guarantees the
    // worker moves on even on engines without AbortController support.
    function sweepOne(url, cb) {
        var settled = false;
        function done(hit) { if (settled) return; settled = true; clearTimeout(timer); cb(hit); }
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = setTimeout(function() { if (ctrl) { try { ctrl.abort(); } catch (e) {} } done(false); }, SCAN_TIMEOUT_MS);
        try {
            fetch(url + '/heartbeat', ctrl ? { signal: ctrl.signal } : undefined)
                .then(function() { done(true); })
                .catch(function() { done(false); });
        } catch (e) { done(false); }
    }

    // ── window.__autoDetectStremioServer(opts, onProgress, onDone) ─────────
    // Sweeps candidate hosts for a live Stremio server. STRICTLY manual —
    // nothing here runs on a timer or at startup; only callers invoke it.
    //   opts.extraCandidates: [hosts] tried first (tests / advanced callers)
    //   onProgress({checked, total, subnet})
    //   onDone({url, note} | null)   — null = nothing found / cancelled
    // Returns { cancel() }.
    window.__autoDetectStremioServer = function(opts, onProgress, onDone) {
        opts = opts || {};
        onProgress = onProgress || function() {};
        onDone = onDone || function() {};

        var stop = { cancelled: false, finished: false };

        var candidates = [];
        var seen = {};
        function add(url) { if (url && !seen[url]) { seen[url] = true; candidates.push(url); } }

        var extras = opts.extraCandidates || [];
        for (var xi = 0; xi < extras.length; xi++) add(candidateUrl(extras[xi], 11470));
        buildCandidates().forEach(add);

        var total = candidates.length;
        var checked = 0;
        var nextIdx = 0;
        var confirming = 0;
        var currentSubnetLabel = '';
        var winner = null;

        function finish(result) {
            if (stop.finished) return;
            stop.finished = true;
            stop.cancelled = true;
            onDone(result);
        }
        function report() { onProgress({ checked: checked, total: total, subnet: currentSubnetLabel }); }

        function worker() {
            if (stop.cancelled || stop.finished) return;
            if (nextIdx >= candidates.length) {
                // All candidates dispatched; finish once the last in-flight
                // probes (sweep + confirmation) have settled.
                if (confirming === 0 && checked >= total) finish(winner);
                return;
            }
            var url = candidates[nextIdx++];
            var parts = parseUrlParts(url);
            currentSubnetLabel = parts ? (parts.host.replace(/\.\d+$/, '.x') + ':' + parts.port) : '';
            sweepOne(url, function(hit) {
                if (stop.cancelled || stop.finished) return;
                checked++;
                report();
                if (!hit) { worker(); return; }
                // Something answered on this port — confirm it is actually a
                // Stremio server (GET /settings) and grab its version.
                confirming++;
                probe(url, function(res) {
                    confirming--;
                    if (!stop.cancelled && !stop.finished && res.reachable) { winner = { url: res.url, note: res.note }; finish(winner); return; }
                    worker();
                });
            });
        }

        for (var w = 0; w < SCAN_CONCURRENCY; w++) worker();

        return { cancel: function() { stop.cancelled = true; finish(null); } };
    };

    // ═══════════════════════════════════════════════════════════════════
    // The Settings overlay: edit URL, Save & Test, Auto-Detect, Reset.
    // ═══════════════════════════════════════════════════════════════════
    window.__showServerUrlManager = function() {
        var existing = document.getElementById('dv-server-url-manager');
        if (existing) { existing.remove(); return; }

        var scan = null;

        var card = document.createElement('div');
        card.id = 'dv-server-url-manager';
        // Corner-anchored, scrollable, NOT fullscreen — never traps the remote.
        card.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);width:min(620px,92vw);max-height:80vh;overflow:auto;background:rgba(14,14,20,0.98);color:#fff;padding:22px 24px;border-radius:16px;font-family:PlusJakartaSans,sans-serif;z-index:100001;box-shadow:0 12px 50px rgba(0,0,0,0.7);';

        var title = document.createElement('div');
        title.style.cssText = 'font-size:20px;font-weight:800;margin-bottom:8px;';
        title.textContent = 'Streaming Server';
        card.appendChild(title);

        var status = document.createElement('div');
        status.id = 'dv-server-url-status';
        status.style.cssText = 'font-size:14px;min-height:20px;margin-bottom:12px;font-weight:600;line-height:1.5;';
        card.appendChild(status);

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'http://192.168.1.x:11470';
        input.value = isDefaultUrl(window.__STREMIO_SERVER_URL__) ? '' : window.__STREMIO_SERVER_URL__;
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.35);color:#fff;font-size:16px;font-family:Consolas,monospace;margin-bottom:8px;';
        input.setAttribute('tabindex', '0');
        card.appendChild(input);

        var hint = document.createElement('div');
        hint.style.cssText = 'font-size:12.5px;color:rgba(255,255,255,0.55);line-height:1.55;margin-bottom:14px;';
        hint.textContent = 'Runs on the device with Stremio installed (phone / PC), on the same Wi-Fi. The address is saved and retried automatically every session. Auto-Detect searches the network for it — only when you press the button.';
        card.appendChild(hint);

        function mkButton(label, primary) {
            var b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'background:' + (primary ? '#7b5bf5' : 'rgba(255,255,255,0.12)') + ';color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-family:inherit;font-weight:600;cursor:pointer;text-align:center;';
            b.setAttribute('tabindex', '0');
            b.onfocus = function() { this.style.outline = '2px solid #a78bfa'; };
            b.onblur = function() { this.style.outline = 'none'; };
            return b;
        }
        function setStatus(text, color) {
            status.textContent = text;
            status.style.color = color || 'rgba(255,255,255,0.7)';
        }

        // ── Save & Test — saves immediately (future sessions auto-reconnect),
        // then pings the server with a timeout and reports honestly. ────────
        var saveBtn = mkButton('Save & Test', true);
        saveBtn.onclick = function() {
            var url = normalizeUrl(input.value);
            if (!url) { setStatus('Type the server address first, or press Auto-Detect.', '#fbbf24'); return; }
            setServerUrl(url);
            setStatus('Checking ' + url + ' …', '#fbbf24');
            saveBtn.disabled = true;
            saveBtn.style.opacity = '0.5';
            var t0 = Date.now();
            probe(url, function(res) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
                if (res.reachable) {
                    setStatus('✓ Connected — Stremio Server ' + res.note + ' (' + (Date.now() - t0) + ' ms). Saved for future sessions.', '#4ade80');
                } else {
                    setStatus('✗ Not reachable (' + res.note + '). The address is still saved — it will be retried on next launch.', '#f87171');
                }
            }, TEST_TIMEOUT_MS);
        };

        // ── Auto-Detect — explicit user action only. ────────────────────────
        var detectBtn = mkButton('Auto-Detect');
        var resetBtn = mkButton('Reset to Default');
        function setScanning(on) {
            detectBtn.textContent = on ? 'Stop Scan' : 'Auto-Detect';
            saveBtn.disabled = on;
            saveBtn.style.opacity = on ? '0.5' : '1';
            resetBtn.disabled = on;
            resetBtn.style.opacity = on ? '0.5' : '1';
        }
        detectBtn.onclick = function() {
            if (scan) { scan.cancel(); return; }
            setStatus('Scanning the local network for a Stremio server …', '#fbbf24');
            setScanning(true);
            scan = window.__autoDetectStremioServer({}, function(p) {
                var label = p.subnet ? ' (' + p.subnet + ')' : '';
                setStatus('Scanning the local network for a Stremio server … ' + p.checked + '/' + p.total + label, '#fbbf24');
            }, function(res) {
                scan = null;
                setScanning(false);
                if (res && res.url) {
                    input.value = res.url;
                    setServerUrl(res.url);
                    setStatus('✓ Found streaming server at ' + res.url + ' (' + res.note + ') — saved for future sessions.', '#4ade80');
                } else {
                    setStatus('Scan stopped — no Stremio server found. Make sure Stremio is running on a device on the same Wi-Fi, then type its address above.', '#fbbf24');
                }
            });
        };

        resetBtn.onclick = function() {
            setServerUrl(DEFAULT_URL);
            input.value = '';
            setStatus('Reset to the built-in default (no external streaming server).', 'rgba(255,255,255,0.7)');
        };

        var closeBtn = mkButton('Close');
        closeBtn.onclick = function() { closeCard(); };

        function closeCard() {
            if (scan) { scan.cancel(); scan = null; }
            if (card.parentNode) card.remove();
        }

        // Remote-friendly Back: closes the card — except while typing in the
        // input, where Backspace must keep working as text editing.
        card.addEventListener('keydown', function(e) {
            var k = e.keyCode;
            var typing = (e.target === input);
            if (typing && (k === 8 || (k >= 32 && k <= 126) || k === 229)) return;
            if (k === 8 || k === 27 || k === 461 || k === 10009 || k === 88) {
                if (e.preventDefault) e.preventDefault();
                closeCard();
            }
        });

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;';
        row.appendChild(saveBtn);
        row.appendChild(detectBtn);
        row.appendChild(resetBtn);
        row.appendChild(closeBtn);
        card.appendChild(row);
        document.body.appendChild(card);
        setTimeout(function() { input.focus(); }, 60);

        // Current state, probed honestly on open.
        var cur = window.__STREMIO_SERVER_URL__;
        if (isDefaultUrl(cur)) {
            setStatus('No streaming server configured (using the built-in default).', 'rgba(255,255,255,0.7)');
        } else {
            setStatus('Current: ' + cur + ' — checking …', '#fbbf24');
            probe(cur, function(res) {
                if (res.reachable) setStatus('Current: ' + cur + ' — ✓ online (' + res.note + ')', '#4ade80');
                else setStatus('Current: ' + cur + ' — ✗ offline (' + res.note + '). Update the address below, or Auto-Detect.', '#f87171');
            }, TEST_TIMEOUT_MS);
        }
    };
})();
