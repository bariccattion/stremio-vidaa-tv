    // VIDAA keyboard fix v5 — intercept programmatic input.value changes
    // The VIDAA system keyboard sets input.value directly without firing DOM events.
    // This script: (1) overrides the value setter to fire synthetic events,
    // (2) polls as fallback, (3) directly updates URL hash as nuclear option.
    (function() {
        window.__STREMIO_PATCH_VERSION__ = 5;

        // Layer 1: Override HTMLInputElement.prototype.value setter
        try {
            var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (desc && desc.set) {
                var origSet = desc.set;
                var origGet = desc.get;
                var guard = false;
                Object.defineProperty(HTMLInputElement.prototype, 'value', {
                    get: origGet,
                    set: function(v) {
                        var old = origGet.call(this);
                        origSet.call(this, v);
                        if (v !== old && !guard) {
                            guard = true;
                            try {
                                this.dispatchEvent(new Event('input', { bubbles: true }));
                            } catch(e) {}
                            guard = false;
                        }
                    },
                    configurable: true
                });
            }
        } catch(e) {}

        // Layer 2: Polling fallback (250ms — balanced for TV CPU)
        var _prev = '';
        setInterval(function() {
            try {
                var hash = window.location.hash || '';
                if (hash.indexOf('#/search') !== 0) { _prev = ''; return; }
                var el = document.querySelector('input[type="text"]')
                      || document.querySelector('input[placeholder]')
                      || document.querySelector('input');
                if (!el) return;
                var v = el.value || '';
                if (v === _prev) return;
                _prev = v;

                try {
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } catch(e) {}

                // Layer 3: Nuclear option — directly update URL hash
                if (v.length > 0) {
                    var encoded = encodeURIComponent(v);
                    if (hash.indexOf('query=' + encoded) === -1) {
                        window.location.hash = '#/search?query=' + encoded;
                    }
                }
            } catch(e) {}
        }, 250);
    })();
