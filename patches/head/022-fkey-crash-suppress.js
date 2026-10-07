// #10 — Suppress F key crash
// Fullscreen API is meaningless on VIDAA (browser is always fullscreen).
// Pressing F (keyCode 70) triggers requestFullscreen() which crashes the VIDAA browser.
(function() {
    document.addEventListener('keydown', function(e) {
        if (e.keyCode === 70 || e.key === 'f' || e.key === 'F') {
            // Only suppress when not typing in an input field
            var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea') return;
            e.preventDefault();
            e.stopPropagation();
            console.log('[patch] Suppressed F key (fullscreen crash prevention)');
        }
    }, true); // capture phase to intercept before Stremio's handler
})();
