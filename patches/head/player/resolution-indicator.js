// Resolution indicator in player
(function() {
    // Transient pill via the UI kernel: created hidden, shown on demand,
    // fades 5 s after the last show. Content refreshes never auto-show.
    var pill = window.__vidaaUI.transient('quality-indicator',
        'position:fixed;top:14px;right:14px;background:rgba(0,0,0,0.75);color:white;padding:5px 12px;border-radius:6px;font-size:13px;z-index:99998;pointer-events:none;font-family:monospace;display:none;backdrop-filter:blur(4px);',
        5000);

    // Any keypress in the player refreshes the indicator's visibility clock.
    window.__vidaaKeys.on('*', function() {
        pill.touch();
    }, { route: 'player', priority: -100 });

    window.__vidaaRuntime.poll(function() {
        var hash = window.location.hash || '';
        if (hash.indexOf('#/player/') !== 0) {
            pill.hideNow();
            return;
        }
        var video = document.querySelector('video');
        if (!video || !video.videoWidth) return;

        var el = pill.setText();
        var w = video.videoWidth, h = video.videoHeight;
        var label;
        if (w >= 3840) label = '4K';
        else if (w >= 2560) label = '1440p';
        else if (w >= 1920) label = '1080p';
        else if (w >= 1280) label = '720p';
        else if (w >= 854) label = '480p';
        else label = w + 'x' + h;

        // Append codec/HDR info from VIDAA state
        if (window.__VIDAA_STATE__) {
            if (window.__VIDAA_STATE__.videoCodec) label += ' ' + window.__VIDAA_STATE__.videoCodec;
            if (window.__VIDAA_STATE__.hdr) label += ' ' + window.__VIDAA_STATE__.hdr;
            if (window.__VIDAA_STATE__.dolbyVision) label += ' DV';
        }
        if (window.__STREAM_INFO__ && window.__STREAM_INFO__.videoCodec) {
            if (label.indexOf(window.__STREAM_INFO__.videoCodec) === -1) {
                label += ' ' + window.__STREAM_INFO__.videoCodec;
            }
        }

        // Buffer health dot
        var bufferSec = 0;
        try { if (video.buffered.length) bufferSec = video.buffered.end(video.buffered.length - 1) - video.currentTime; } catch(e) {}
        var dotColor = bufferSec > 30 ? '#4ade80' : bufferSec > 10 ? '#fbbf24' : '#f87171';
        el.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + dotColor + ';margin-right:6px;vertical-align:middle;"></span>' + esc(label);
        // Only refresh content — do NOT auto-show. The indicator is shown on Red button
        // press (in player with stats disabled) or on any keydown in player. This prevents
        // the icon from being stuck visible permanently.
    }, 3000, { quiet: true });
})();
