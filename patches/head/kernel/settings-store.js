// ═══════════════════════════════════════════════════════════════════════
// settingsStore — the VIDAA settings registry + schema-derived reset.
// ═══════════════════════════════════════════════════════════════════════
// The one module that owns "what settings exist". Every feature registers
// its item here (id, type, lsKey, defaultValue, onToggle/onClick); the
// settings UI (032g) renders rows FROM this registry, and resets derive
// their key list from it — no more hand-maintained key lists scattered
// across patches. Split from the former 032 god-module.
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var log = RT.logger('settings');
    var registeredItems = [];

    // ─── Registry ───────────────────────────────────────────────────
    window.__vidaaSettingsItems = registeredItems;

    window.__registerVidaaSettingsItem = function(cfg) {
        for (var i = 0; i < registeredItems.length; i++) {
            if (registeredItems[i].id === cfg.id) return;
        }
        registeredItems.push(cfg);
        log('Registered item:', cfg.id);
    };

    // Backward-compat alias for the old community toggle API
    window.__registerCommunityToggle = function(cfg) {
        window.__registerVidaaSettingsItem({
            id: cfg.id,
            type: 'toggle',
            label: cfg.title,
            description: cfg.description,
            lsKey: cfg.lsKey,
            defaultValue: cfg.defaultValue,
            onToggle: cfg.onToggle,
            extraContent: cfg.extraContent
        });
    };

    // The registry just appeared — run every pending onRegistryReady caller
    // NOW (same script tick), not on the next 200ms when-tick.
    RT.when.flush();

    // ─── Schema-derived reset ───────────────────────────────────────
    // Two flavors, ONE implementation (P1.7 — zoom-correction used to ship
    // its own divergent delete-all reset):
    //   default       — every registered toggle returns to its defaultValue;
    //                   legacy value-keys are listed once here.
    //   {mode:'wipe'} — DELETE every `stremio_*` key (registered, legacy and
    //                   unknown alike); the "Reset VIDAA Tweaks" semantics.
    // `overrides` win last (Safe Mode's conservative profile), `exclude`
    // protects keys (both flavors keep the server URL).
    window.__vidaaResetTweaks = function(opts) {
        opts = opts || {};
        var overrides = opts.overrides || {};
        var exclude = opts.exclude || {};
        var wipe = opts.mode === 'wipe';
        function write(key, value) {
            if (exclude[key] || overrides[key] !== undefined) return;
            if (wipe) { RT.store.remove(key); return; }
            RT.store.set(key, value);
        }
        for (var i = 0; i < registeredItems.length; i++) {
            var item = registeredItems[i];
            if (item.lsKey && item.defaultValue !== undefined) write(item.lsKey, item.defaultValue);
        }
        if (wipe) {
            // Delete EVERY stremio_* key not excluded — catches legacy keys,
            // install stamps, and future keys the registry doesn't know.
            try {
                var doomed = [];
                for (var k = 0; k < localStorage.length; k++) {
                    var key = localStorage.key(k);
                    if (key && key.indexOf('stremio_') === 0 && !exclude[key]) doomed.push(key);
                }
                for (var d = 0; d < doomed.length; d++) RT.store.remove(doomed[d]);
            } catch (e) {}
        } else {
            write('stremio_audio_delay', '0');       // audio-offset value (ms)
            write('stremio_embedded_sub_delay', '0'); // embedded-subs offset (ms)
            write('stremio_720p_mode', 'auto');       // 720p mode cycler value
        }
        for (var o in overrides) RT.store.set(o, overrides[o]);
    };

    log('settingsStore ready (registry + schema-derived reset)');
})();
