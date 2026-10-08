// Channel Up/Down quick seek (60s forward/back)
(function() {
    var RT = window.__vidaaRuntime;

    function seek(delta, label) {
        var vid = document.querySelector('video');
        if (!vid) return;
        if (delta > 0) vid.currentTime = Math.min(vid.currentTime + delta, vid.duration || Infinity);
        else vid.currentTime = Math.max(vid.currentTime + delta, 0);
        RT.toast(label, {
            at: 'center',
            bg: 'rgba(0,0,0,0.8)',
            ms: 1500,
            extra: 'padding:12px 24px;border-radius:8px;font-size:1.5rem;'
        });
    }

    window.__vidaaKeys.on('channelUp', function() { seek(60, '+60s'); }, { route: 'player' });
    window.__vidaaKeys.on('channelDown', function() { seek(-60, '-60s'); }, { route: 'player' });
})();
