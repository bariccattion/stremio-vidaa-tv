// ═══════════════════════════════════════════════════════════════════════
// Server URL autodetect + native-dialog integration.
//
// The server URL is edited in the NATIVE Settings > Server > Edit URL dialog
// (a settings.chunk.js edit keeps it a plain field: local value, committed
// ONCE on Confirm; kernel/server-url.js then mirrors the commit to
// localStorage so future sessions auto-reconnect). This patch adds the
// extras around that native field — no custom input UI of our own:
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

    var RT = window.__vidaaRuntime;

    var SCAN_TIMEOUT_MS = 1200;   // per-candidate probe timeout during the LAN sweep
    var SCAN_CONCURRENCY = 32;    // candidates probed in parallel
    var TEST_TIMEOUT_MS = 3000;   // Confirm-time ping timeout

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
    // port? The runtime's fetchTimeout settles exactly once (with or without
    // AbortController support) so the worker always moves on.
    function sweepOne(url, cb) {
        RT.fetchTimeout(url + '/heartbeat', SCAN_TIMEOUT_MS)
            .then(function() { cb(true); }, function() { cb(false); });
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
                RT.probeServer(url, function(res) {
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
    function toast(text, sticky) {
        window.__vidaaUI.toastTop(text, { id: 'dv-server-toast', sticky: sticky });
    }

    // ── Confirm-time ping (called by the chunk-edited native dialog right
    // after it commits the URL). Pure feedback — the URL is already saved. ──
    // /settings can fail for reasons that don't affect usability (older
    // server builds, response shapes) — fall back to a /heartbeat liveness
    // check, the same one the health monitor uses, before reporting failure.
    function heartbeatOk(url, cb) {
        RT.fetchTimeout(url + '/heartbeat', TEST_TIMEOUT_MS)
            .then(function(r) { cb(r.ok); }, function() { cb(false); });
    }

    // TV browsers can block fetch checks from an https page to an http LAN
    // server (mixed content) while <video> playback still works. Exposed for
    // tests.
    window.__mixedContentHint = function(pageProtocol, serverUrl) {
        if (pageProtocol === 'https:' && /^http:\/\//i.test(serverUrl)) {
            return ' Note: TV browsers can block checks from an https page to an http server while playback still works — for full server integration, install the app via the http installer.';
        }
        return '';
    };

    window.__serverDialogTest = function(url) {
        if (!url) return;
        var t0 = Date.now();
        toast('Checking ' + url + ' …', true);
        RT.probeServer(url, function(res) {
            if (res.reachable) {
                toast('✓ Streaming server reachable (' + res.note + ', ' + (Date.now() - t0) + ' ms)');
                return;
            }
            heartbeatOk(url, function(ok) {
                if (ok) {
                    toast('✓ Streaming server reachable (heartbeat, ' + (Date.now() - t0) + ' ms)');
                    return;
                }
                var hint = window.__mixedContentHint(window.location.protocol, url);
                toast('⚠ Could not verify ' + url + ' (' + res.note + '). The address is saved and will be retried.' + hint);
            });
        }, TEST_TIMEOUT_MS);
    };

    // ── Auto-Detect (called by the "Auto-Detect" button in the native
    // dialog). Fills the dialog's field with the winner via input.value —
    // the VIDAA keyboard fix (platform/keyboard-fix.js) fires the synthetic
    // input event, so the dialog's local value mirrors it; the user still
    // presses Confirm. ──
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
