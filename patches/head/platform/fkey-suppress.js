// #10 — Suppress F key crash
// Fullscreen API is meaningless on VIDAA (browser is always fullscreen).
// Pressing F (keyCode 70) triggers requestFullscreen() which crashes the VIDAA browser.
(function() {
    var log = window.__vidaaRuntime.logger('fkey');
    window.__vidaaKeys.on('f', function() {
        log('Suppressed F key (fullscreen crash prevention)');
    }, {
        priority: 900,
        suppress: true,
        when: function(e) {
            var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
            return tag !== 'input' && tag !== 'textarea';
        }
    });
})();
