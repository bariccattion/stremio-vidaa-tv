// #11 — Subtitle off/unload option
// Stremio's subtitle picker doesn't include a "None/Off" option.
// This patch injects one into the subtitle picker DOM and wires it to disable subtitles.
(function() {
    var injected = false;
    var lastHash = '';

    function disableSubtitles() {
        if (!window.core) return;
        try {
            // Dispatch empty/null subtitle track selection to disable subtitles
            window.core.dispatch({
                action: 'Player',
                args: { action: 'SetProp', args: { propName: 'selectedSubtitleTrackId', propValue: null } }
            }, 'player');
            console.log('[subs] Subtitles disabled');
        } catch(e) {
            console.log('[subs] Failed to disable subtitles:', e.message);
        }
        // Also try to remove subtitle display elements directly
        try {
            var subEls = document.querySelectorAll('[class*="subtitle"], [class*="Subtitle"]');
            for (var i = 0; i < subEls.length; i++) {
                if (subEls[i].style && subEls[i].textContent && subEls[i].offsetHeight < 200) {
                    // Likely a subtitle text overlay, not a menu
                }
            }
        } catch(e) {}
        // Clear saved language preference when user explicitly turns off subs
        try { localStorage.removeItem('stremio_subtitle_lang'); } catch(e) {}
    }
    window.__disableSubtitles = disableSubtitles;

    // Watch for subtitle picker menu and inject "Off" option
    var observer = new MutationObserver(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) return;

        // Look for subtitle track list items
        var menuItems = document.querySelectorAll('[class*="track"], [class*="Track"], [class*="subtitle-picker"] li, [class*="subtitlesPicker"] [class*="option"]');
        if (menuItems.length === 0) return;

        // Check if we already injected
        if (document.getElementById('subtitle-off-option')) return;

        // Find the container of subtitle options
        var container = menuItems[0].parentNode;
        if (!container) return;

        var offOption = document.createElement(menuItems[0].tagName || 'div');
        offOption.id = 'subtitle-off-option';
        // Clone the styling from an existing menu item
        if (menuItems[0].className) offOption.className = menuItems[0].className;
        offOption.textContent = 'Off';
        offOption.style.cssText = (offOption.style.cssText || '') + ';cursor:pointer;opacity:0.8;';
        offOption.setAttribute('tabindex', '0');
        offOption.onfocus = function() { this.style.outline = '2px solid #7b5bf5'; };
        offOption.onblur = function() { this.style.outline = 'none'; };
        offOption.onclick = function() { disableSubtitles(); };
        offOption.onkeydown = function(e) { if (e.keyCode === 13 || e.keyCode === 32) disableSubtitles(); };

        // Insert at the beginning
        container.insertBefore(offOption, container.firstChild);
        console.log('[subs] Injected "Off" option into subtitle picker');
    });

    // Start observing when in player
    setInterval(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') === 0 && hash !== lastHash) {
            lastHash = hash;
            observer.disconnect();
            observer.observe(document.body, { childList: true, subtree: true });
        }
        if (hash.indexOf('#/player/') !== 0) {
            observer.disconnect();
            lastHash = '';
        }
    }, 1000);
})();
