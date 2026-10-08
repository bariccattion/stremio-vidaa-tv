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
    // Every registered toggle with a defaultValue returns to that default;
    // legacy tweak keys that carry values (not booleans) are listed once
    // here. `overrides` win last (Safe Mode's conservative profile),
    // `exclude` protects keys (Reset Tweaks keeps the server URL).
    window.__vidaaResetTweaks = function(opts) {
        opts = opts || {};
        var overrides = opts.overrides || {};
        var exclude = opts.exclude || {};
        function write(key, value) {
            if (exclude[key] || overrides[key] !== undefined) return;
            RT.store.set(key, value);
        }
        for (var i = 0; i < registeredItems.length; i++) {
            var item = registeredItems[i];
            if (item.lsKey && item.defaultValue !== undefined) write(item.lsKey, item.defaultValue);
        }
        write('stremio_audio_delay', '0');           // audio-offset value (ms)
        write('stremio_720p_mode', 'auto');           // 720p mode cycler value
        RT.store.remove('stremio_sub_drift_data');    // learned drift cache
        for (var k in overrides) RT.store.set(k, overrides[k]);
    };

    log('settingsStore ready (registry + schema-derived reset)');
})();
