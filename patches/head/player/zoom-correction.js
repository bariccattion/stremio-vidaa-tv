    // 720p Zoom Correction
    // Auto mode detects 720p VIDAA viewports and scales the UI only.
    // Player layout stays untouched unless users explicitly opt into legacy player zoom.
    (function() {
        var RT = window.__vidaaRuntime;
        var log = RT.logger('zoom');
        var MODE_KEY = 'stremio_720p_mode';
        var ZOOM_KEY = 'stremio_720p_zoom';
        var PLAYER_ZOOM_KEY = 'stremio_zoom_disable_in_player';
        var UI_ZOOM_SCALE = '65%';
        var VALID_MODES = {
            'auto': true,
            'ui-only': true,
            'ui-and-player': true,
            'off': true
        };
        var MODE_LABELS = {
            'auto': 'Auto',
            'ui-only': 'UI Only',
            'ui-and-player': 'UI + Player',
            'off': 'Off'
        };

        function readStoredMode() {
            var mode = RT.store.get(MODE_KEY, null);
            return VALID_MODES[mode] ? mode : null;
        }

        function inferLegacyMode() {
            var zoomEnabled = RT.store.getBool(ZOOM_KEY, true);
            var playerZoomDisabled = RT.store.getBool(PLAYER_ZOOM_KEY, true);
            if (!zoomEnabled) return 'off';
            return playerZoomDisabled ? 'auto' : 'ui-and-player';
        }

        function getModeLabel(mode) {
            return MODE_LABELS[mode] || MODE_LABELS.auto;
        }

        function get720pMode() {
            return readStoredMode() || inferLegacyMode();
        }

        function syncLegacyZoomKeys(mode) {
            if (mode === 'off') {
                RT.store.set(ZOOM_KEY, false);
                RT.store.set(PLAYER_ZOOM_KEY, true);
                return;
            }
            RT.store.set(ZOOM_KEY, true);
            RT.store.set(PLAYER_ZOOM_KEY, mode === 'ui-and-player' ? false : true);
        }

        function set720pMode(mode) {
            if (!VALID_MODES[mode]) mode = 'auto';
            RT.store.set(MODE_KEY, mode);
            syncLegacyZoomKeys(mode);
        }

        function shouldTreatAs720pContext() {
            var mode = get720pMode();
            if (mode === 'off') return false;
            if (mode === 'ui-only' || mode === 'ui-and-player') return true;
            return !!window.screen720p;
        }

        function shouldZoomPlayerRoute() {
            return get720pMode() === 'ui-and-player';
        }

        function removeModal(id) {
            var existing = document.getElementById(id);
            if (existing) existing.remove();
        }

        function focusFallback(refs) {
            for (var i = 0; i < refs.length; i++) {
                if (refs[i] && typeof refs[i].focus === 'function') {
                    refs[i].focus();
                    return;
                }
            }
        }

        function setUiZoom(active) {
            var nextZoom = active ? UI_ZOOM_SCALE : '';
            if (document.body.style.zoom !== nextZoom) {
                document.body.style.zoom = nextZoom;
            }
            document.body.setAttribute('data-vidaa-ui-zoom', active ? 'true' : 'false');
        }

        function shouldApplyUiZoom() {
            if (!shouldTreatAs720pContext()) return false;
            if (RT.inPlayer() && !shouldZoomPlayerRoute()) return false;
            return true;
        }

        function refreshZoom(reason) {
            var shouldApply = shouldApplyUiZoom();
            setUiZoom(shouldApply);
            log((shouldApply ? 'Applied' : 'Removed') + ' UI zoom' + (reason ? ' (' + reason + ')' : ''));
        }

        function nextMode(mode) {
            if (mode === 'auto') return 'ui-only';
            if (mode === 'ui-only') return 'ui-and-player';
            if (mode === 'ui-and-player') return 'off';
            return 'auto';
        }

        window.__get720pMode = get720pMode;
        window.__get720pModeLabel = function() {
            return getModeLabel(get720pMode());
        };

        window.__applyZoom = function() {
            refreshZoom('settings-on');
        };
        window.__removeZoom = function() {
            setUiZoom(false);
            log('Removed UI zoom (settings-off)');
        };
        window.__refreshZoom = refreshZoom;
        window.__set720pMode = function(mode) {
            set720pMode(mode);
            refreshZoom('mode-change:' + mode);
        };
        window.__cycle720pMode = function() {
            var mode = nextMode(get720pMode());
            set720pMode(mode);
            refreshZoom('mode-cycle:' + mode);
            if (window.__showVidaaToast) {
                window.__showVidaaToast('720p Mode: ' + getModeLabel(mode), 1800);
            }
            return mode;
        };
        window.__show720pModePicker = window.__cycle720pMode;

        function performResetVidaaTweaks() {
            // One reset implementation since P1.7: the kernel settingsStore's
            // wipe mode (delete every stremio_* tweak key, keep the server
            // URL). This used to be a private delete-all loop that drifted
            // from the kernel's schema-derived reset.
            if (window.__vidaaResetTweaks) {
                window.__vidaaResetTweaks({ mode: 'wipe', exclude: { stremio_server_url: true } });
            }
            try { sessionStorage.removeItem('stremio_install_banner_dismissed_session'); } catch (e) {}
            location.reload();
        }

        var resetVidaaTweaksArmedUntil = 0;
        var resetVidaaTweaksTimer = null;

        function disarmResetVidaaTweaks() {
            resetVidaaTweaksArmedUntil = 0;
            if (resetVidaaTweaksTimer) {
                clearTimeout(resetVidaaTweaksTimer);
                resetVidaaTweaksTimer = null;
            }
        }

        window.__getResetVidaaTweaksLabel = function() {
            return Date.now() < resetVidaaTweaksArmedUntil ? 'Confirm Reset VIDAA Tweaks' : 'Reset VIDAA Tweaks';
        };

        window.__triggerResetVidaaTweaks = function() {
            if (Date.now() < resetVidaaTweaksArmedUntil) {
                disarmResetVidaaTweaks();
                performResetVidaaTweaks();
                return true;
            }
            resetVidaaTweaksArmedUntil = Date.now() + 10000;
            if (resetVidaaTweaksTimer) clearTimeout(resetVidaaTweaksTimer);
            resetVidaaTweaksTimer = setTimeout(disarmResetVidaaTweaks, 10050);
            if (window.__showVidaaToast) {
                window.__showVidaaToast('Press again to confirm reset', 2200);
            }
            return false;
        };
        window.__resetVidaaTweaks = window.__triggerResetVidaaTweaks;

        window.addEventListener('hashchange', function() {
            refreshZoom('route-change');
        });

        setTimeout(function() {
            window.screen720p = false;
            setUiZoom(false);
            syncLegacyZoomKeys(get720pMode());

            // ?nozoom=1 URL param forces off
            var params = new URLSearchParams(window.location.search);
            if (params.get('nozoom') === '1') {
                set720pMode('off');
                log('Zoom disabled via ?nozoom=1');
                return;
            }

            // Original auto-detect: Hisense firmware + 720p viewport
            try {
                if (Hisense_GetFirmWareVersion() && window.innerHeight === 720) {
                    window.screen720p = true;
                }
            } catch (e) {}

            refreshZoom('detect');
        }, 2000);
    })();
