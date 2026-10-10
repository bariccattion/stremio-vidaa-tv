// VIDAA Diagnostics — copyable debug blob for install/runtime reports
(function() {
    var RT = window.__vidaaRuntime;
    var UI = window.__vidaaUI;
    var safeRead = UI.safe;

    // Modal chrome, action buttons and the esc/toast helpers now live in
    // kernel/ui.js (__vidaaUI); this patch keeps only the diagnostics
    // content collectors and the legacy entry-point globals.

    function collectDiagnostics() {
        var trackedKeys = [
            'stremio_720p_mode',
            'stremio_720p_zoom',
            'stremio_zoom_disable_in_player',
            'stremio_stream_stats',
            'stremio_low_memory',
            'stremio_auto_rebuffer',
            'stremio_quiet_player',
            'stremio_auto_native_player_mkv',
            'stremio_auto_native_player',
            'stremio_install_banner_last_success_at',
            'stremio_install_banner_method'
        ];
        var settings = {};
        for (var i = 0; i < trackedKeys.length; i++) {
            settings[trackedKeys[i]] = safeRead(function(key) {
                return localStorage.getItem(key);
            }.bind(null, trackedKeys[i]), null);
        }

        return {
            build: window.__BUILD_COMMIT__ || null,
            patchVersion: window.__STREMIO_PATCH_VERSION__ || null,
            href: window.location.href,
            origin: window.location.origin,
            host: window.location.host,
            hash: window.location.hash,
            userAgent: navigator.userAgent,
            vidaaDetected: !!window.__VIDAA_DEVICE__,
            isVidaaHubDomain: window.location.hostname === 'vidaahub.com',
            installSource: safeRead(function() {
                var m = window.location.search.match(/[?&]install_source=([^&]+)/);
                return m ? decodeURIComponent(m[1]) : null;
            }, null),
            availableApis: {
                installApp: safeRead(function() { return typeof Hisense_installApp === 'function'; }, false),
                registryWrite: safeRead(function() { return typeof HiUtils_createRequest === 'function'; }, false),
                addInsecureDomain: safeRead(function() { return typeof Hisense_AddInsecureDomain === 'function'; }, false),
                getOSVersion: safeRead(function() { return typeof Hisense_GetOSVersion === 'function'; }, false),
                registerObserver: safeRead(function() { return typeof Hisense_RegisterObserver === 'function'; }, false)
            },
            viewport: {
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                screenWidth: safeRead(function() { return window.screen.width; }, null),
                screenHeight: safeRead(function() { return window.screen.height; }, null),
                screen720p: !!window.screen720p,
                uiZoomApplied: document.body && document.body.getAttribute('data-vidaa-ui-zoom') === 'true',
                zoomMode: safeRead(function() { return window.__get720pMode ? window.__get720pMode() : settings.stremio_720p_mode; }, null),
                zoomEnabled: settings.stremio_720p_zoom !== 'false',
                playerZoomDisabled: settings.stremio_zoom_disable_in_player !== 'false',
                playerRoute: (window.location.hash || '').indexOf('#/player/') === 0
            },
            serviceWorker: {
                controlled: !!navigator.serviceWorker && !!navigator.serviceWorker.controller
            },
            installBanner: {
                lastSuccessAt: settings.stremio_install_banner_last_success_at,
                method: settings.stremio_install_banner_method || null,
                dismissedSession: safeRead(function() { return sessionStorage.getItem('stremio_install_banner_dismissed_session'); }, null)
            },
            trackedSettings: settings,
            vidaaCaps: window.__VIDAA_CAPS__ || null,
            vidaaState: window.__VIDAA_STATE__ || null
        };
    }

    function copyBlob(textarea) {
        var text = textarea.value;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                var btn = document.getElementById('vidaa-diag-copy-btn');
                if (btn) btn.textContent = 'Copied';
            }).catch(function() {
                textarea.focus();
                textarea.select();
            });
            return;
        }
        textarea.focus();
        textarea.select();
    }

    window.__showVidaaToast = function(message, duration) {
        RT.toast(message, { at: 'bottom', ms: duration || 2200 });
    };

    function playbackTrackedSettings() {
        var trackedKeys = [
            'stremio_720p_mode',
            'stremio_force_stereo',
            'stremio_audio_delay_enabled',
            'stremio_webtorrent_enabled',
            'stremio_low_memory',
            'stremio_auto_rebuffer',
            'stremio_stream_stats',
            'stremio_playback_warning',
            'stremio_quiet_player',
            'stremio_auto_native_player_mkv',
            'stremio_auto_native_player'
        ];
        var settings = {};
        for (var i = 0; i < trackedKeys.length; i++) {
            settings[trackedKeys[i]] = safeRead(function(key) {
                return localStorage.getItem(key);
            }.bind(null, trackedKeys[i]), null);
        }
        return settings;
    }

    function collectPlaybackDiagnostics() {
        var video = document.querySelector('video');
        var bufferedSec = null;
        try {
            if (video && video.buffered && video.buffered.length) {
                bufferedSec = video.buffered.end(video.buffered.length - 1) - video.currentTime;
            }
        } catch (e) {}

        var quality = null;
        try {
            if (video && typeof video.getVideoPlaybackQuality === 'function') {
                quality = video.getVideoPlaybackQuality();
            }
        } catch (e) {}

        var diag = {
            build: window.__BUILD_COMMIT__ || null,
            patchVersion: window.__STREMIO_PATCH_VERSION__ || null,
            timestamp: new Date().toISOString(),
            href: window.location.href,
            hash: window.location.hash,
            playerRoute: (window.location.hash || '').indexOf('#/player/') === 0,
            playbackSettings: playbackTrackedSettings(),
            streamInfo: window.__STREAM_INFO__ || null,
            vidaaCaps: window.__VIDAA_CAPS__ || null,
            vidaaState: window.__VIDAA_STATE__ || null,
            video: video ? {
                currentSrc: video.currentSrc || video.src || null,
                currentSrcHost: safeRead(function() { return new URL(video.currentSrc || video.src).host; }, null),
                readyState: video.readyState,
                networkState: video.networkState,
                paused: video.paused,
                muted: video.muted,
                volume: video.volume,
                playbackRate: video.playbackRate,
                currentTime: video.currentTime,
                duration: video.duration,
                bufferedSec: bufferedSec,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight,
                error: video.error ? {
                    code: video.error.code,
                    message: video.error.message || null
                } : null,
                playbackQuality: quality ? {
                    droppedVideoFrames: quality.droppedVideoFrames,
                    totalVideoFrames: quality.totalVideoFrames,
                    corruptedVideoFrames: quality.corruptedVideoFrames,
                    creationTime: quality.creationTime
                } : null
            } : null,
            playerState: null
        };

        return Promise.resolve().then(function() {
            if (!(window.__vidaaRuntime.core && window.__vidaaRuntime.core.getState)) return diag;
            return window.__vidaaRuntime.core.getState('player').then(function(state) {
                if (!state) return diag;
                diag.playerState = {
                    paused: safeRead(function() { return state.paused; }, null),
                    loaded: safeRead(function() { return state.loaded; }, null),
                    buffering: safeRead(function() { return state.buffering; }, null),
                    time: safeRead(function() { return state.time; }, null),
                    duration: safeRead(function() { return state.duration; }, null),
                    selectedSubtitleTrackId: safeRead(function() { return state.selectedSubtitleTrack && state.selectedSubtitleTrack.id; }, null),
                    selectedSubtitleTrack: safeRead(function() { return state.selectedSubtitleTrack; }, null),
                    selectedAudioTrackId: safeRead(function() { return state.selectedAudioTrack && state.selectedAudioTrack.id; }, null),
                    selectedAudioTrack: safeRead(function() { return state.selectedAudioTrack; }, null),
                    stream: safeRead(function() { return state.stream; }, null)
                };
                return diag;
            }).catch(function(err) {
                diag.playerState = { error: err && err.message ? err.message : 'getState failed' };
                return diag;
            });
        });
    }

    // ── Diagnostics sections (rendered inside the unified panel, 044). ──
    // Content collectors stay here; the chrome (tabs, close, Back/Escape)
    // belongs to the diagnostics module. Legacy entry-point globals are
    // kept for the Settings rows and tests.
    RT.when(function() { return !!window.__vidaaRegisterDiagnostic; }, function() {
        window.__vidaaRegisterDiagnostic({
            id: 'debug-blob',
            label: 'Debug Blob',
            render: function(body) {
                var textarea = document.createElement('textarea');
                textarea.readOnly = true;
                textarea.style.cssText = 'width:100%;min-height:360px;max-height:56vh;resize:vertical;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.26);color:#dfe2ff;padding:16px;font-family:Consolas,\"Courier New\",monospace;font-size:13px;line-height:1.45;';
                textarea.value = JSON.stringify(collectDiagnostics(), null, 2);

                var copyBtn = UI.button('Copy Debug Blob', { id: 'vidaa-diag-copy-btn', primary: true });
                copyBtn.style.marginTop = '10px';
                copyBtn.onclick = function() { copyBlob(textarea); };

                body.appendChild(textarea);
                body.appendChild(copyBtn);
                textarea.focus();
                textarea.select();
            }
        });
        window.__vidaaRegisterDiagnostic({
            id: 'playback',
            label: 'Playback',
            render: function(body) {
                var textarea = document.createElement('textarea');
                textarea.readOnly = true;
                textarea.style.cssText = 'width:100%;min-height:360px;max-height:56vh;resize:vertical;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.26);color:#dfe2ff;padding:16px;font-family:Consolas,\"Courier New\",monospace;font-size:13px;line-height:1.45;';
                textarea.value = '{"status":"collecting"}';

                var copyBtn = UI.button('Copy Playback Blob', { id: 'vidaa-playback-diag-copy-btn', primary: true });
                copyBtn.style.marginTop = '10px';
                copyBtn.onclick = function() { copyBlob(textarea); };

                body.appendChild(textarea);
                body.appendChild(copyBtn);

                collectPlaybackDiagnostics().then(function(diag) {
                    if (!textarea.isConnected) return;
                    textarea.value = JSON.stringify(diag, null, 2);
                }).catch(function(err) {
                    if (!textarea.isConnected) return;
                    textarea.value = JSON.stringify({
                        error: err && err.message ? err.message : 'failed to collect playback diagnostics'
                    }, null, 2);
                });

                textarea.focus();
                textarea.select();
            }
        });
    });

    window.__showVidaaDiagnostics = function() {
        if (window.__vidaaDiagnostics) window.__vidaaDiagnostics.show('debug-blob');
    };

    window.__showPlaybackDiagnostics = function() {
        if (window.__vidaaDiagnostics) window.__vidaaDiagnostics.show('playback');
    };

    window.__applyPlaybackSafeMode = function(opts) {
        // Conservative profile via the settingsStore's schema-derived reset:
        // every registered toggle returns to its default, then the two
        // deliberate deviations (stats OFF, playback warning ON) are applied.
        if (typeof window.__vidaaResetTweaks === 'function') {
            window.__vidaaResetTweaks({
                overrides: {
                    stremio_stream_stats: 'false',
                    stremio_playback_warning: 'true'
                }
            });
        }
        if (opts && opts.reload === false) {
            if (window.__showVidaaToast) {
                window.__showVidaaToast('Safe Playback Mode applied', 1800);
            }
            return true;
        }
        location.reload();
        return true;
    };

    RT.onRegistryReady(function() {
        window.__registerVidaaSettingsItem({
            id: 'show-vidaa-diagnostics',
            type: 'action',
            label: 'Diagnostics',
            description: 'Opens the unified diagnostics panel on the copyable debug blob (install, viewport, and VIDAA runtime state) — other tabs cover playback, device, stats, and torrents.',
            onClick: function() {
                if (window.__showVidaaDiagnostics) window.__showVidaaDiagnostics();
            }
        });
    });
})();
