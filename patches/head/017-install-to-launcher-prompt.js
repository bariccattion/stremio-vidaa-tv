// Install to Launcher — first-run prompt for VIDAA devices
(function() {
    if (!window.__VIDAA_DEVICE__) return;
    var SESSION_DISMISS_KEY = 'stremio_install_banner_dismissed_session';
    var LAST_SUCCESS_KEY = 'stremio_install_banner_last_success_at';
    var METHOD_KEY = 'stremio_install_banner_method';
    var SUCCESS_SUPPRESS_MS = 24 * 60 * 60 * 1000;
    if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return;

    try {
        var lastSuccessAt = parseInt(localStorage.getItem(LAST_SUCCESS_KEY), 10);
        if (lastSuccessAt && (Date.now() - lastSuccessAt) < SUCCESS_SUPPRESS_MS) return;
    } catch (e) {}

    // Two install paths exist:
    //  - legacy Hisense_installApp — on newer firmware it reports success and
    //    then never adds the launcher entry (the "silent drop")
    //  - direct write of websdk/Appinfo.json via HiUtils_createRequest — the
    //    technique from github.com/weinzii/vidaa-edge, which lands the entry
    //    regardless of what Hisense_installApp does. Registry-first whenever
    //    the API is exposed to this domain; legacy stays as fallback.
    var canLegacyInstall = false;
    var canRegistryInstall = false;
    try { canLegacyInstall = typeof Hisense_installApp === 'function'; } catch(e) {}
    try { canRegistryInstall = typeof HiUtils_createRequest === 'function'; } catch(e) {}
    if (!canLegacyInstall && !canRegistryInstall) return;

    var APPINFO_PATH = 'websdk/Appinfo.json';
    var APPINFO_MODE = 6;

    function readAppRegistry() {
        try {
            var res = HiUtils_createRequest('fileRead', { path: APPINFO_PATH, mode: APPINFO_MODE });
            if (!res || !res.ret) return null;
            var parsed = JSON.parse(res.msg);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.AppInfo)) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function installViaRegistry(appUrl, iconUrl, appId, appName) {
        // Never write blind: rewriting a registry we could not read would wipe
        // every installed web app — bail out and let the legacy API try.
        var apps = readAppRegistry();
        if (!apps) return false;
        var entry = {
            Id: appId,
            AppName: appName,
            Title: appName,
            URL: appUrl,
            StartCommand: appUrl,
            IconURL: iconUrl,
            Icon_96: iconUrl,
            Image: iconUrl,
            Thumb: iconUrl,
            Type: 'Browser',
            InstallTime: new Date().toISOString().split('T')[0],
            RunTimes: 0,
            StoreType: 'custom',
            PreInstall: false
        };
        var idx = -1;
        for (var i = 0; i < apps.AppInfo.length; i++) {
            if (apps.AppInfo[i] && apps.AppInfo[i].Id === appId) { idx = i; break; }
        }
        if (idx >= 0) apps.AppInfo[idx] = entry;
        else apps.AppInfo.push(entry);
        try {
            var res = HiUtils_createRequest('fileWrite', {
                path: APPINFO_PATH,
                mode: APPINFO_MODE,
                writedata: JSON.stringify(apps)
            });
            return !!(res && res.ret);
        } catch (e) {
            return false;
        }
    }

    function sendLauncherRefresh(appId) {
        // Tell the Hisense launcher to refresh — the official Stremio
        // installer does this and without it many firmware builds report
        // install success but never actually show the new icon.
        try {
            var refreshMsg = {
                type: 'APPMessage', MsgType: 'appControl', action: 'updateAppState',
                source: 'browser', startAppType: 0x2,
                param: { event: 'AllAppsUpdate', SubModuleName: 'AllApps', startFrom: '', appInfo: appId }
            };
            if (window.omi_platform && typeof window.omi_platform.sendPlatformMessage === 'function') {
                window.omi_platform.sendPlatformMessage(JSON.stringify(refreshMsg));
            } else if (window.opera_omi && typeof window.opera_omi.sendPlatformMessage === 'function') {
                window.opera_omi.sendPlatformMessage(JSON.stringify(refreshMsg));
            }
        } catch(refreshErr) { console.log('[install] launcher refresh failed:', refreshErr.message); }
    }

    function onInstallAccepted(method) {
        sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
        try {
            localStorage.setItem(LAST_SUCCESS_KEY, String(Date.now()));
            localStorage.setItem(METHOD_KEY, method);
        } catch (e) {}
        sendLauncherRefresh('stremio-vidaa');
    }

    // Show install banner after app loads (delay to let splash screen clear)
    setTimeout(function() {
        var banner = document.createElement('div');
        banner.id = 'install-banner';
        banner.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(123,91,245,0.95);color:white;padding:14px 28px;border-radius:12px;z-index:99999;font-family:PlusJakartaSans,sans-serif;font-size:1rem;display:flex;align-items:center;gap:16px;backdrop-filter:blur(8px);box-shadow:0 4px 20px rgba(0,0,0,0.4);';

        var text = document.createElement('span');
        text.textContent = 'Add Stremio to your TV launcher?';
        banner.appendChild(text);

        var btn = document.createElement('button');
        btn.textContent = 'Install';
        btn.style.cssText = 'background:white;color:#7b5bf5;border:none;padding:8px 20px;border-radius:8px;font-weight:700;font-size:0.95rem;cursor:pointer;font-family:inherit;';
        btn.setAttribute('tabindex', '0');
        btn.onfocus = function() { this.style.outline = '3px solid white'; };
        btn.onblur = function() { this.style.outline = 'none'; };
        btn.onclick = function() {
            var appUrl = 'https://bariccattion.github.io/stremio-vidaa-tv/';
            var iconUrl = appUrl + 'icon.png';
            var appId = 'stremio-vidaa';

            if (canRegistryInstall) {
                try {
                    if (installViaRegistry(appUrl, iconUrl, appId, 'Stremio')) {
                        onInstallAccepted('registry');
                        text.textContent = 'Installed via app registry. Fully restart your TV (unplug 10s) and Stremio appears at the end of the app list. If it still does not show, bookmark this page in the TV Browser — it works the same.';
                        btn.style.display = 'none';
                        setTimeout(function() { banner.remove(); }, 12000);
                        return;
                    }
                } catch (e) {
                    console.log('[install] registry path failed:', e.message);
                }
                // Registry path unavailable or refused — fall through to legacy.
            }

            if (!canLegacyInstall) {
                text.textContent = 'Install not available from this domain. Bookmark this page in the TV Browser and open it from there.';
                setTimeout(function() { banner.remove(); }, 7000);
                return;
            }

            try {
                Hisense_installApp(appId, 'Stremio', iconUrl, iconUrl, iconUrl, appUrl, 'store', function(status) {
                    if (status === 0) {
                        onInstallAccepted('legacy');
                        text.textContent = 'Install requested. Fully restart your TV (unplug 10s). If nothing shows in your launcher — common on projectors and newer firmware — just bookmark this page in the TV Browser, it works the same.';
                        btn.style.display = 'none';
                        setTimeout(function() { banner.remove(); }, 12000);
                    } else {
                        text.textContent = 'Install failed (code ' + status + '). Bookmark this page in the TV Browser instead.';
                    }
                });
            } catch(e) {
                text.textContent = 'Install not available from this domain. Bookmark this page in the TV Browser and open it from there.';
                setTimeout(function() { banner.remove(); }, 7000);
            }
        };
        banner.appendChild(btn);

        var dismiss = document.createElement('button');
        dismiss.textContent = '\u00D7';
        dismiss.style.cssText = 'background:none;color:rgba(255,255,255,0.6);border:none;font-size:1.4rem;cursor:pointer;padding:0 4px;';
        dismiss.onclick = function() {
            sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
            banner.remove();
        };
        banner.appendChild(dismiss);

        document.body.appendChild(banner);

        // Auto-dismiss after 15 seconds
        setTimeout(function() { if (banner.parentNode) banner.remove(); }, 15000);
    }, 5000);
})();
