// Channel Up/Down quick seek (60s forward/back)
(function() {
    document.addEventListener('keydown', function(e) {
        var code = e.keyCode;

        // Channel Up (427) — skip forward 60s
        if (code === 427) {
            var vid = document.querySelector('video');
            if (vid && (window.location.hash || '').indexOf('#/player/') === 0) {
                vid.currentTime = Math.min(vid.currentTime + 60, vid.duration || Infinity);
                var toast = document.createElement('div');
                toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:white;padding:12px 24px;border-radius:8px;font-size:1.5rem;font-family:PlusJakartaSans,sans-serif;z-index:100000;pointer-events:none;';
                toast.textContent = '+60s';
                document.body.appendChild(toast);
                setTimeout(function() { toast.remove(); }, 1500);
            }
        }

        // Channel Down (428) — skip back 60s
        if (code === 428) {
            var vid2 = document.querySelector('video');
            if (vid2 && (window.location.hash || '').indexOf('#/player/') === 0) {
                vid2.currentTime = Math.max(vid2.currentTime - 60, 0);
                var toast2 = document.createElement('div');
                toast2.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:white;padding:12px 24px;border-radius:8px;font-size:1.5rem;font-family:PlusJakartaSans,sans-serif;z-index:100000;pointer-events:none;';
                toast2.textContent = '-60s';
                document.body.appendChild(toast2);
                setTimeout(function() { toast2.remove(); }, 1500);
            }
        }
    });
})();
