// VIDAA API Integration — register trusted domain + expose device capabilities
(function() {
    // Only run on VIDAA devices
    try { Hisense_GetOSVersion(); } catch(e) { return; }

    window.__VIDAA_DEVICE__ = true;

    // Register GitHub Pages as trusted domain (enables privileged APIs on future loads)
    try {
        var domains = Hisense_GetInsecureDomain();
        if (!Array.isArray(domains)) domains = [];
        var ghDomain = 'bariccattion.github.io';
        var found = false;
        for (var i = 0; i < domains.length; i++) {
            if (domains[i] === ghDomain) { found = true; break; }
        }
        if (!found) {
            var result = Hisense_AddInsecureDomain(ghDomain);
            console.log('[vidaa] Registered trusted domain:', ghDomain, result);
        }
    } catch(e) {
        console.log('[vidaa] AddInsecureDomain not available:', e.message);
    }

    // Normalize a VIDAA capability value to a friendly label.
    // Different firmwares return various shapes: true/false, "0"/"1", 0/1, strings, objects.
    function normaliseCap(v) {
        if (v === undefined || v === null) return 'unknown';
        if (typeof v === 'boolean') return v ? 'yes' : 'no';
        if (typeof v === 'number') return v ? 'yes' : 'no';
        if (typeof v === 'string') {
            var s = v.trim().toLowerCase();
            if (s === '1' || s === 'true' || s === 'yes' || s === 'supported') return 'yes';
            if (s === '0' || s === 'false' || s === 'no' || s === 'unsupported' || s === '') return 'no';
            return v;
        }
        return v;
    }
    window.__normaliseVidaaCap = normaliseCap;

    // Collect device capabilities. Try multiple APIs per feature — different
    // firmware builds expose different function names, and on some projector
    // builds the older Hisense_* aliases return the right answer while the
    // newer camelCase/omi_ variants throw.
    try {
        window.__VIDAA_CAPS__ = {};
        var caps = window.__VIDAA_CAPS__;

        try { caps.hdrInfo = Hisense_GetSupportForHDRInfo(); } catch(e) {}
        try { caps.pictureInfo = Hisense_GetPictureInfo(); } catch(e) {}

        // Atmos detection — multiple paths, first non-empty answer wins.
        var atmosRaw = undefined;
        try { atmosRaw = Hisense_GetSupportForDolbyAtmos(); } catch(e) {}
        if (atmosRaw === undefined) {
            try {
                var pic = caps.pictureInfo;
                if (pic && (pic.dolbyAtmos !== undefined || pic.atmos !== undefined)) {
                    atmosRaw = pic.dolbyAtmos !== undefined ? pic.dolbyAtmos : pic.atmos;
                }
            } catch(e) {}
        }
        if (atmosRaw === undefined) {
            try {
                var hdr = caps.hdrInfo;
                if (hdr && (hdr.atmos !== undefined || hdr.dolbyAtmos !== undefined)) {
                    atmosRaw = hdr.atmos !== undefined ? hdr.atmos : hdr.dolbyAtmos;
                }
            } catch(e) {}
        }
        caps.dolbyAtmosRaw = atmosRaw;
        caps.dolbyAtmos = normaliseCap(atmosRaw);

        try { caps.chipset = Hisense_GetChipSetName(); } catch(e) {}
        try { caps.panelRes = Hisense_GetPanelResolution(); } catch(e) {}
        try { caps.drmInfo = Hisense_GetDrmInfo(); } catch(e) {}
        try { caps.model = Hisense_GetModelName(); } catch(e) {}
        try { caps.firmware = Hisense_GetFirmWareVersion(); } catch(e) {}
        try { caps.osVersion = Hisense_GetOSVersion(); } catch(e) {}
        console.log('[vidaa] Device caps:', JSON.stringify(caps));
    } catch(e) {}

    // Register observers for real-time video state
    try {
        window.__VIDAA_STATE__ = {};
        var keys = ['dolbyVision', 'hdr', 'videoCodec', 'audioCodec', 'playerState', 'mediaState', 'resolution', 'dolbyAtmos', 'atmos'];
        for (var j = 0; j < keys.length; j++) {
            (function(key) {
                try {
                    Hisense_RegisterObserver(key, function(val) {
                        window.__VIDAA_STATE__[key] = val;
                        console.log('[vidaa] Observer:', key, '=', val);
                    });
                } catch(e) {}
            })(keys[j]);
        }
    } catch(e) {}
})();
