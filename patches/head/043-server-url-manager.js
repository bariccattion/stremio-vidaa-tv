// ═══════════════════════════════════════════════════════════════════════
// Server URL autodetect + native-dialog integration.
//
// The server URL is edited in the NATIVE Settings > Server > Edit URL dialog
// (a settings.chunk.js edit keeps it a plain field: local value, committed
// ONCE on Confirm; patch 006 then mirrors the commit to localStorage so
// future sessions auto-reconnect). This patch adds the extras around that
// native field — no custom input UI of our own:
//   • "Auto-Detect" button inside the native dialog (the chunk edit calls
//     window.__serverDialogAutoDetect): sweeps the LAN for a Stremio server
//     on port 11470 with short per-probe timeouts, fills the field with the
//     winner; the user still presses Confirm to apply.
//   • Reachability ping with timeout after Confirm (the chunk edit calls
//     window.__serverDialogTest), reported as a toast.
//
// HARD RULES (project): the scan is strictly manual — it NEVER runs on
// startup or in the background; toasts never trap the remote; ES5 only.
// ═══════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    var SCAN_TIMEOUT_MS = 1200;   // per-candidate probe timeout during the LAN sweep
    var SCAN_CONCURRENCY = 32;    // candidates probed in parallel
    var TEST_TIMEOUT_MS = 3000;   // Confirm-time ping timeout

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
        var u = (host || '').trim();
        if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
        u = u.replace(/\/+$/, '');
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

    // ── Toast — non-interactive feedback, never traps the remote. ──────────
    var toastEl = null;
    var toastHideTimer = null;
    function toast(text, sticky) {
        try {
            if (!toastEl || !toastEl.parentNode) {
                toastEl = document.createElement('div');
                toastEl.id = 'dv-server-toast';
                toastEl.style.cssText = 'position:fixed;top:40px;left:50%;transform:translateX(-50%);background:rgba(123,91,245,0.95);color:#fff;padding:10px 22px;border-radius:8px;font-family:PlusJakartaSans,sans-serif;font-size:0.92rem;z-index:100000;max-width:80%;text-align:center;line-height:1.4;';
                document.body.appendChild(toastEl);
            }
            toastEl.textContent = text;
            if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
            if (!sticky) toastHideTimer = setTimeout(function() {
                if (toastEl && toastEl.parentNode) toastEl.remove();
                toastEl = null;
            }, 5000);
        } catch (e) {}
    }

    // ── Confirm-time ping (called by the chunk-edited native dialog right
    // after it commits the URL). Pure feedback — the URL is already saved. ──
    window.__serverDialogTest = function(url) {
        if (!url) return;
        var t0 = Date.now();
        toast('Checking ' + url + ' …', true);
        probe(url, function(res) {
            if (res.reachable) {
                toast('✓ Streaming server reachable (' + res.note + ', ' + (Date.now() - t0) + ' ms)');
            } else {
                toast('✗ Streaming server not reachable (' + res.note + '). The address is saved and will be retried.');
            }
        }, TEST_TIMEOUT_MS);
    };

    // ── Auto-Detect (called by the "Auto-Detect" button in the native
    // dialog). Fills the dialog's field with the winner via input.value —
    // the VIDAA keyboard fix (patch 003) fires the synthetic input event, so
    // the dialog's local value mirrors it; the user still presses Confirm. ──
    var activeScan = null;
    window.__serverDialogAutoDetect = function(opts) {
        if (activeScan) { activeScan.cancel(); return; }
        toast('Scanning the local network for a Stremio server …', true);
        activeScan = window.__autoDetectStremioServer(opts || {}, function(p) {
            var label = p.subnet ? ' (' + p.subnet + ')' : '';
            toast('Scanning the local network for a Stremio server … ' + p.checked + '/' + p.total + label, true);
        }, function(res) {
            activeScan = null;
            if (res && res.url) {
                var filled = false;
                try {
                    var input = document.querySelector('input[type=text]');
                    if (input) { input.value = res.url; filled = true; }
                } catch (e) {}
                toast(filled
                    ? '✓ Found streaming server at ' + res.url + ' (' + res.note + ') — press Confirm to save'
                    : '✓ Found streaming server at ' + res.url + ' (' + res.note + ') — type this address and confirm');
            } else {
                toast('No Stremio server found on the network. Make sure Stremio is running on a device on the same Wi-Fi.');
            }
        });
    };
})();
