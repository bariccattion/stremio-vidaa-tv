// #6 — Exit button for VIDAA TV
// Exit logic — UI is now registered via the VIDAA settings tab system.
(function() {
    function exitApp() {
        console.log('[exit] Attempting to exit app');
        try { if (typeof Hisense_Exit === 'function') { Hisense_Exit(); return; } } catch(e) {}
        try { if (typeof Hisense_CloseApp === 'function') { Hisense_CloseApp(); return; } } catch(e) {}
        try { window.close(); } catch(e) {}
    }
    window.__exitApp = exitApp;
})();
