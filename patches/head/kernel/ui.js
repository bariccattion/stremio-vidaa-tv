// ═══════════════════════════════════════════════════════════════════════
// VIDAA UI kernel — the shared UI chrome toolbox.
//
// One home for the primitives patches were copy-pasting: esc(), the safe
// invoker, the button factory, the modal factory (moved here from the
// diagnostics blob so the kernel diagnostics panel no longer depends on a
// feature patch), the shared toast shapes, and the transient overlay
// (show → auto-fade) behind the resolution pill, torrent status card and
// audio-delay readout.
//
// Globals: window.__vidaaUI, plus legacy aliases window.esc,
// __createVidaaActionButton, __createVidaaModal, __closeVidaaModalById.
// Like every kernel module: feature-check before use from feature patches.
(function() {
    var RT = window.__vidaaRuntime;
    var UI = {};
    window.__vidaaUI = UI;

    // ── XSS escape for dynamic innerHTML values ──────────────────────
    // DOM-based: escapes exactly what a browser would render in a text
    // node. Quotes are escaped too so the output is also safe inside
    // double-quoted attributes.
    UI.esc = function(s) {
        var d = document.createElement('div');
        d.textContent = (s == null ? '' : s);
        return d.innerHTML.replace(/"/g, '&quot;');
    };
    window.esc = UI.esc; // back-compat: bare esc() global of the former kernel/esc.js

    // ── safe invoker ─────────────────────────────────────────────────
    // Diagnostics-collector idiom: run fn, hand back the fallback on throw.
    UI.safe = function(fn, fallback) {
        try { return fn(); } catch (e) { return (fallback !== undefined) ? fallback : null; }
    };

    // ── button factory ───────────────────────────────────────────────
    // Two looks: the modal chrome (default: padding 10px 16px, radius 10,
    // PlusJakartaSans 700) and opts.small (compact in-player: 13px, weight
    // 600, inherited font). opts.primary/danger/success/bg pick the fill,
    // opts.color overrides the text color (light-on-dark banners).
    // Focus outlines come from the template's global button:focus CSS —
    // per-button focus handlers are not needed and must not be re-added.
    UI.button = function(label, opts) {
        opts = opts || {};
        var b = document.createElement('button');
        if (opts.id) b.id = opts.id;
        b.type = 'button';
        b.textContent = label;
        var solid = !!(opts.bg || opts.primary || opts.danger || opts.success);
        var bg = opts.bg
            || (opts.primary ? '#7b5bf5' : opts.danger ? '#d34d4d' : opts.success ? '#2d8f5f' : '')
            || (opts.small ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)');
        var shape = opts.small
            ? 'border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-family:inherit;font-weight:600;'
            : (solid ? 'border:none;' : 'border:1px solid rgba(255,255,255,0.14);')
              + 'border-radius:10px;padding:10px 16px;font-family:PlusJakartaSans,sans-serif;font-weight:700;';
        b.style.cssText = 'background:' + bg + ';color:' + (opts.color || '#fff') + ';cursor:pointer;text-align:center;' + shape;
        b.setAttribute('tabindex', '0');
        return b;
    };
    window.__createVidaaActionButton = function(label, opts) { return UI.button(label, opts); };

    // ── modal factory ────────────────────────────────────────────────
    // The VIDAA modal chrome: dark scrim + panel, header with title and
    // action buttons, optional helpText, scrollable body, footer row.
    // Backdrop click and the Close button both fire config.onClose.
    function closeModalById(id) {
        var existing = document.getElementById(id);
        if (existing) existing.remove();
    }
    UI.closeModal = closeModalById;

    UI.modal = function(config) {
        closeModalById(config.id);

        var modal = document.createElement('div');
        modal.id = config.id;
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:100002;display:flex;align-items:center;justify-content:center;padding:24px;';

        var panel = document.createElement('div');
        panel.style.cssText = 'width:min(' + (config.width || '920px') + ', 92vw);' +
            (config.maxHeight ? 'max-height:' + config.maxHeight + ';' : '') +
            'background:#12121a;border:1px solid rgba(255,255,255,0.12);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,0.55);display:flex;flex-direction:column;padding:20px;gap:14px;';

        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
        header.innerHTML = '<div style="font-family:PlusJakartaSans,sans-serif;font-size:1.3rem;font-weight:700;color:#fff;">' + config.title + '</div>';

        var actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:10px;align-items:center;';

        var closeBtn = UI.button(config.closeLabel || 'Close');
        closeBtn.onclick = function() {
            closeModalById(config.id);
            if (config.onClose) config.onClose();
        };
        actions.appendChild(closeBtn);

        if (config.headerButtons && config.headerButtons.length) {
            for (var i = 0; i < config.headerButtons.length; i++) {
                actions.insertBefore(config.headerButtons[i], closeBtn);
            }
        }
        header.appendChild(actions);

        panel.appendChild(header);

        if (config.helpText) {
            var help = document.createElement('div');
            help.style.cssText = 'font-family:PlusJakartaSans,sans-serif;font-size:0.95rem;line-height:1.5;color:rgba(255,255,255,0.7);';
            help.textContent = config.helpText;
            panel.appendChild(help);
        }

        var body = document.createElement('div');
        body.style.cssText = config.bodyStyle || '';
        panel.appendChild(body);

        if (config.footerButtons && config.footerButtons.length) {
            var footer = document.createElement('div');
            footer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
            for (var j = 0; j < config.footerButtons.length; j++) footer.appendChild(config.footerButtons[j]);
            panel.appendChild(footer);
        }

        modal.appendChild(panel);
        modal.onclick = function(e) {
            if (e.target === modal) {
                closeModalById(config.id);
                if (config.onClose) config.onClose();
            }
        };
        document.body.appendChild(modal);

        return {
            modal: modal,
            panel: panel,
            body: body,
            closeBtn: closeBtn,
            close: function() {
                closeModalById(config.id);
                if (config.onClose) config.onClose();
            }
        };
    };
    window.__closeVidaaModalById = closeModalById;
    window.__createVidaaModal = UI.modal;

    // ── shared stream-advice copy (P1.7) ─────────────────────────────
    // The trailing "what actually helps" clause of stall/limit messages —
    // one wording everywhere instead of three drifting copies. Gated on
    // server availability so bare-TV users never get a dead-end suggestion.
    UI.serverAdvice = function(serverReady) {
        return serverReady
            ? ', or use your Stremio streaming server to transcode it.'
            : ', or set up a Stremio streaming server (Settings ▸ Server).';
    };

    // ── shared toast shapes ──────────────────────────────────────────
    // The two combos patches kept re-wrapping around RT.toast: a top
    // notice (5 s default) and a centered status flash.
    UI.toastTop = function(text, opts) {
        opts = opts || {};
        RT.toast(text, { at: 'top', id: opts.id, sticky: opts.sticky, ms: opts.ms || 5000 });
    };
    UI.toastCenter = function(text, opts) {
        opts = opts || {};
        RT.toast(text, { at: 'center', bg: opts.bg, ms: opts.ms || 2500, extra: opts.extra });
    };

    // ── transient overlay ────────────────────────────────────────────
    // The show → auto-fade pattern: one element per id, text updates reset
    // the hide clock, hiding is a fade (the element stays; pointer-events
    // are none in the caller's cssText). setText() refreshes content
    // WITHOUT showing — the resolution pill depends on that distinction.
    UI.transient = function(id, cssText, hideMs, fadeCss) {
        var el = null;
        var timer = null;
        function ensure() {
            if (el && el.isConnected) return el;
            var found = document.getElementById(id);
            if (found) { el = found; return el; }
            el = document.createElement('div');
            el.id = id;
            el.style.cssText = cssText;
            document.body.appendChild(el);
            return el;
        }
        function armHide() {
            if (timer) clearTimeout(timer);
            timer = setTimeout(function() {
                if (el && el.isConnected) {
                    el.style.transition = fadeCss || 'opacity 0.5s';
                    el.style.opacity = '0';
                }
            }, hideMs);
        }
        function show(text) {
            ensure();
            if (text != null) el.textContent = text;
            // Snap visible (cancel any in-flight fade); the hide timer
            // re-arms the transition for the fade-out.
            el.style.transition = 'none';
            el.style.display = 'block';
            el.style.opacity = '1';
            armHide();
            return el;
        }
        return {
            show: show,
            setText: function(text) {
                ensure();
                if (text != null) el.textContent = text;
                return el;
            },
            touch: function() { if (el && el.isConnected) show(); },
            hideNow: function() {
                if (timer) clearTimeout(timer);
                if (el && el.isConnected) el.style.opacity = '0';
            },
            remove: function() {
                if (timer) clearTimeout(timer);
                if (el) { try { el.remove(); } catch (e) {} }
                el = null;
            },
            el: function() { return el; }
        };
    };
})();
