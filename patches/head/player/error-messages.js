// Enhanced error messages for TV users
(function() {
    window.__STREMIO_ERROR_ENHANCER__ = function(err) {
        if (!err) return null;
        var msg = err.message || '';
        var code = err.code || 0;

        if (window.__DV_PROFILE7_DETECTED__ && window.__STREAM_INFO__ && window.__STREAM_INFO__.stallCheck) {
            return 'Dolby Vision stream (' + window.__DV_PROFILE7_DETECTED__ + ') failed to render. Try an MKV source or use a streaming server for transcoding.';
        }
        if (msg.indexOf('not supported') !== -1 || msg === 'MEDIA_ERR_SRC_NOT_SUPPORTED') {
            return 'This video codec is not supported by your TV. Try a different source, or configure a streaming server for transcoding (Settings \u2192 Server).';
        }
        if (msg === 'MEDIA_ERR_DECODE') {
            return 'Video decode error \u2014 the codec may not be compatible. Try a different source or enable transcoding.';
        }
        if (msg === 'MEDIA_ERR_NETWORK') {
            return 'Network error \u2014 check your connection and streaming server status.';
        }
        if (msg.indexOf('CONVERT_FAILED') !== -1 || msg.indexOf('transcode') !== -1 || msg.indexOf('Transcode') !== -1) {
            return 'Transcoding failed \u2014 verify your streaming server is running and accessible.';
        }
        return msg;
    };
})();
