// VIDAA Diagnostics — copyable debug blob for install/runtime reports
(function() {
    function safeRead(fn, fallback) {
        try { return fn(); } catch (e) { return fallback; }
    }

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
            'stremio_install_banner_last_success_at'
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
            availableApis: {
                installApp: safeRead(function() { return typeof Hisense_installApp === 'function'; }, false),
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
                dismissedSession: safeRead(function() { return sessionStorage.getItem('stremio_install_banner_dismissed_session'); }, null)
            },
            trackedSettings: settings,
            vidaaCaps: window.__VIDAA_CAPS__ || null,
            vidaaState: window.__VIDAA_STATE__ || null
        };
    }

    function closeDiagnosticsModal() {
        var existing = document.getElementById('vidaa-diagnostics-modal');
        if (existing) existing.remove();
    }

    function closeModalById(id) {
        var existing = document.getElementById(id);
        if (existing) existing.remove();
    }

    function createVidaaActionButton(label, opts) {
        opts = opts || {};
        var button = document.createElement('button');
        if (opts.id) button.id = opts.id;
        button.type = 'button';
        button.textContent = label;
        button.style.cssText = (
            opts.primary
                ? 'background:#7b5bf5;color:#fff;border:none;'
                : opts.danger
                    ? 'background:#d34d4d;color:#fff;border:none;'
                    : opts.success
                        ? 'background:#2d8f5f;color:#fff;border:none;'
                        : 'background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.14);'
        ) + 'border-radius:10px;padding:10px 16px;font-family:PlusJakartaSans,sans-serif;font-weight:700;cursor:pointer;';
        return button;
    }

    function createVidaaModal(config) {
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

        var closeBtn = createVidaaActionButton(config.closeLabel || 'Close');
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
    }

    window.__closeVidaaModalById = closeModalById;
    window.__createVidaaActionButton = createVidaaActionButton;
    window.__createVidaaModal = createVidaaModal;

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
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;left:50%;bottom:42px;transform:translateX(-50%);background:rgba(0,0,0,0.88);color:#fff;padding:12px 18px;border-radius:10px;font-size:1rem;font-family:PlusJakartaSans,sans-serif;z-index:100003;max-width:min(88vw, 720px);text-align:center;box-shadow:0 12px 30px rgba(0,0,0,0.4);';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function() {
            if (toast.parentNode) toast.remove();
        }, duration || 2200);
    };

    function playbackTrackedSettings() {
        var trackedKeys = [
            'stremio_720p_mode',
            'stremio_force_stereo',
            'stremio_audio_delay_enabled',
            'stremio_sub_drift_fix',
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
            if (!window.core || typeof window.core.getState !== 'function') return diag;
            return window.core.getState('player').then(function(state) {
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

    function closePlaybackDiagnosticsModal() {
        var existing = document.getElementById('vidaa-playback-diagnostics-modal');
        if (existing) existing.remove();
    }

    function closeSafeModeModal() {
        var existing = document.getElementById('vidaa-safe-mode-modal');
        if (existing) existing.remove();
    }

    window.__showVidaaDiagnostics = function() {
        closeDiagnosticsModal();
        var copyBtn = createVidaaActionButton('Copy Debug Blob', { id: 'vidaa-diag-copy-btn', primary: true });
        var modalApi = createVidaaModal({
            id: 'vidaa-diagnostics-modal',
            title: 'VIDAA Diagnostics',
            width: '920px',
            maxHeight: '88vh',
            helpText: 'Paste this into a GitHub issue if install, zoom, or playback behavior looks wrong on your VIDAA device.',
            headerButtons: [copyBtn]
        });

        var textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.style.cssText = 'width:100%;min-height:360px;max-height:60vh;resize:vertical;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.26);color:#dfe2ff;padding:16px;font-family:Consolas,\"Courier New\",monospace;font-size:13px;line-height:1.45;';
        textarea.value = JSON.stringify(collectDiagnostics(), null, 2);

        copyBtn.onclick = function() { copyBlob(textarea); };
        modalApi.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
    };

    window.__showPlaybackDiagnostics = function() {
        closePlaybackDiagnosticsModal();
        var copyBtn = createVidaaActionButton('Copy Playback Blob', { id: 'vidaa-playback-diag-copy-btn', primary: true });
        var modalApi = createVidaaModal({
            id: 'vidaa-playback-diagnostics-modal',
            title: 'Playback Diagnostics',
            width: '920px',
            maxHeight: '88vh',
            helpText: 'Use this when playback, buffering, subtitles, or aspect ratio are wrong. It captures the current video element, stream metadata, and saved playback settings.',
            headerButtons: [copyBtn]
        });

        var textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.style.cssText = 'width:100%;min-height:360px;max-height:60vh;resize:vertical;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.26);color:#dfe2ff;padding:16px;font-family:Consolas,\"Courier New\",monospace;font-size:13px;line-height:1.45;';
        textarea.value = '{"status":"collecting"}';

        copyBtn.onclick = function() { copyBlob(textarea); };
        modalApi.body.appendChild(textarea);

        collectPlaybackDiagnostics().then(function(diag) {
            textarea.value = JSON.stringify(diag, null, 2);
        }).catch(function(err) {
            textarea.value = JSON.stringify({
                error: err && err.message ? err.message : 'failed to collect playback diagnostics'
            }, null, 2);
        });

        textarea.focus();
        textarea.select();
    };

    window.__applyPlaybackSafeMode = function(opts) {
        try {
            localStorage.setItem('stremio_720p_mode', 'auto');
            localStorage.setItem('stremio_force_stereo', 'false');
            localStorage.setItem('stremio_audio_delay_enabled', 'false');
            localStorage.setItem('stremio_sub_drift_fix', 'false');
            localStorage.setItem('stremio_webtorrent_enabled', 'false');
            localStorage.setItem('stremio_stream_stats', 'false');
            localStorage.setItem('stremio_low_memory', 'true');
            localStorage.setItem('stremio_auto_rebuffer', 'true');
            localStorage.setItem('stremio_playback_warning', 'true');
            localStorage.setItem('stremio_quiet_player', 'false');
            localStorage.setItem('stremio_auto_native_player_mkv', 'false');
            localStorage.setItem('stremio_auto_native_player', 'false');
        } catch (e) {}
        if (opts && opts.reload === false) {
            if (window.__showVidaaToast) {
                window.__showVidaaToast('Safe Playback Mode applied', 1800);
            }
            return true;
        }
        location.reload();
        return true;
    };

    var regInterval = setInterval(function() {
        if (!window.__registerVidaaSettingsItem) return;
        clearInterval(regInterval);
        window.__registerVidaaSettingsItem({
            id: 'show-vidaa-diagnostics',
            type: 'action',
            label: 'Diagnostics',
            description: 'Show a copyable debug blob for install, viewport, and VIDAA runtime state.',
            onClick: function() {
                if (window.__showVidaaDiagnostics) window.__showVidaaDiagnostics();
            }
        });
    }, 1000);

    // The Settings ▸ STREMIO TV "Diagnostics" row is hardcoded in
    // settings.chunk.js to call window.__showVidaaDiagnostics. To make the new
    // screenshot-friendly buffering diagnostic reachable from Settings WITHOUT
    // editing that bundle, we extend this existing entry point: it still shows
    // the copyable JSON blob (great for GitHub issues), and ALSO pops the big
    // photo-friendly panel (great for the TV, which has no clipboard).
    var _origShowVidaaDiagnostics = window.__showVidaaDiagnostics;
    window.__showVidaaDiagnostics = function() {
        try { if (typeof _origShowVidaaDiagnostics === 'function') _origShowVidaaDiagnostics(); } catch (e) {}
        try { if (typeof window.__showVidaaDiagnostic === 'function') window.__showVidaaDiagnostic(); } catch (e) {}
    };
})();
