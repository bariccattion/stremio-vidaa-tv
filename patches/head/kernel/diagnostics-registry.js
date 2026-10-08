// ═══════════════════════════════════════════════════════════════════════
// Diagnostics — one panel, one section registry, legacy entry points kept.
// ═══════════════════════════════════════════════════════════════════════
// Four overlapping diagnostic surfaces used to ship independently: the
// copyable debug blob (018), the playback blob (018), the screenshot-
// friendly device panel (041), plus the player HUDs (035/031). This module
// is the unified front door:
//
//   __vidaaDiagnostics.show(sectionId)   opens the panel on a section
//   __vidaaRegisterDiagnostic(cfg)       {id, label, render(bodyEl)}
//
// Sections register from wherever their data lives (018, 035, 041, and the
// torrent section below) — one tab bar navigates between them, the modal
// chrome is 018's __createVidaaModal, and Back/Escape always closes (the
// panel must never trap the remote). The in-player HUDs (035 stats, 031
// torrent overlay) stay HUDs — non-blocking by project rule — and share
// their data sources with the panel sections.
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var log = RT.logger('diagnostics');
    var PANEL_ID = 'vidaa-diagnostic-panel';
    var sections = [];
    var activeSection = null;
    var tabsBar = null;
    var sectionBody = null;

    window.__vidaaRegisterDiagnostic = function(cfg) {
        for (var i = 0; i < sections.length; i++) {
            if (sections[i].id === cfg.id) return;
        }
        sections.push(cfg);
    };

    // The registry just appeared — 018/035/041 queued their section
    // registrations behind RT.when; run them in this same script tick.
    RT.when.flush();

    function sectionById(id) {
        for (var i = 0; i < sections.length; i++) {
            if (sections[i].id === id) return sections[i];
        }
        return null;
    }

    function closePanel() {
        var el = document.getElementById(PANEL_ID);
        if (el) el.remove();
        activeSection = null;
        tabsBar = null;
        sectionBody = null;
    }

    // Back (VIDAA 461 / old 8 / 10009) and Escape close the panel while it
    // is open, and the press is suppressed so the app never navigates away
    // underneath the modal. Declared once — the `when` gate makes it live.
    window.__vidaaKeys.on(['back', 'escape'], function() {
        closePanel();
    }, {
        priority: 1000,
        suppress: true,
        when: function() { return !!document.getElementById(PANEL_ID); }
    });

    function refreshTabs() {
        if (!tabsBar) return;
        var buttons = tabsBar.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].style.background = (buttons[i].getAttribute('data-section') === activeSection)
                ? '#7b5bf5' : 'rgba(255,255,255,0.12)';
        }
    }

    function renderSection(id) {
        if (!sectionBody) return;
        activeSection = id;
        sectionBody.innerHTML = '';
        var sec = sectionById(id);
        if (!sec) {
            sectionBody.textContent = 'Unknown diagnostic section: ' + id;
        } else {
            try {
                sec.render(sectionBody);
            } catch (e) {
                log.error('section "' + id + '" render failed:', (e && e.message) || e);
                sectionBody.textContent = 'Section "' + id + '" failed to render.';
            }
        }
        refreshTabs();
    }

    function show(id) {
        var existing = document.getElementById(PANEL_ID);
        if (existing && activeSection === id) { closePanel(); return; } // toggle
        if (existing) existing.remove();

        var modalApi = window.__createVidaaModal({
            id: PANEL_ID,
            title: 'VIDAA Diagnostics',
            width: '920px',
            maxHeight: '88vh',
            helpText: 'Left/Right between tabs · Back closes · photograph or copy the data when reporting an issue.',
            onClose: closePanel
        });

        tabsBar = document.createElement('div');
        tabsBar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;';
        var ordered = sections.slice();
        for (var i = 0; i < ordered.length; i++) {
            (function(sec) {
                var b = document.createElement('button');
                b.type = 'button';
                b.textContent = sec.label;
                b.setAttribute('data-section', sec.id);
                b.setAttribute('tabindex', '0');
                b.style.cssText = 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-family:PlusJakartaSans,sans-serif;font-size:13px;font-weight:600;cursor:pointer;';
                b.onfocus = function() { this.style.outline = '2px solid #a78bfa'; };
                b.onblur = function() { this.style.outline = 'none'; };
                b.onclick = function() { renderSection(sec.id); };
                tabsBar.appendChild(b);
            })(ordered[i]);
        }
        modalApi.body.appendChild(tabsBar);

        sectionBody = document.createElement('div');
        sectionBody.style.cssText = 'min-height:320px;max-height:58vh;overflow:auto;';
        modalApi.body.appendChild(sectionBody);

        renderSection(id);
        // Spatial navigation lands on the active tab first; every section
        // remains reachable and the shell's Close button stays in the header.
        var activeBtn = tabsBar.querySelector('button[data-section="' + id + '"]');
        if (activeBtn) activeBtn.focus();
    }

    window.__vidaaDiagnostics = { show: show, close: closePanel, sections: sections };

    // ── Torrent section (data via the webtorrent-streaming patch's status API). ────
    window.__vidaaRegisterDiagnostic({
        id: 'torrent',
        label: 'Torrent',
        render: function(body) {
            var st = (typeof window.__getWebTorrentStatus === 'function') ? window.__getWebTorrentStatus() : null;
            var esc = window.__vidaaUI.esc;
            function line(label, value) {
                return '<div style="display:flex;justify-content:space-between;gap:18px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:15px;">'
                    + '<span style="color:rgba(255,255,255,0.55);">' + esc(label) + '</span>'
                    + '<span style="font-weight:700;text-align:right;">' + esc(value) + '</span></div>';
            }
            if (!st) {
                body.textContent = 'WebTorrent patch not loaded.';
                return;
            }
            var t = st.activeTorrent;
            body.innerHTML = line('Enabled', st.enabled ? 'yes' : 'no')
                + line('Library loaded', st.libraryLoaded ? 'yes' : 'no')
                + line('Client active', st.clientActive ? 'yes' : 'no')
                + (t
                    ? line('Torrent', String(t.name || '?'))
                        + line('Progress', (t.progress || 0) + '%')
                        + line('Download', Math.round((t.downloadSpeed || 0) / 1024) + ' KB/s')
                        + line('Peers', String(t.peers || 0))
                    : line('Active torrent', 'none'))
                + '<div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:10px;">Live per-second stats live in the player overlay (Info/Red key during a torrent stream).</div>';
        }
    });

    log('diagnostics panel ready');
})();
