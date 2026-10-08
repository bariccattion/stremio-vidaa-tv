    // XSS escape helper for dynamic innerHTML values
    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
