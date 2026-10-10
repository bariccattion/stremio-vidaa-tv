// Lazy load images to reduce memory pressure.
// Through the kernel's ONE DOM watcher since P1.6 (this patch used to run
// its own always-on MutationObserver over the whole body). The feature gate
// now checks the right capability — the `loading` attribute (the old
// IntersectionObserver check was an unrelated proxy).
(function() {
    if ('loading' in document.createElement('img') === false) return;
    var RT = window.__vidaaRuntime;
    if (!(RT.dom && RT.dom.onAdded)) return;

    function makeLazy(img) {
        if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy');
    }

    // Sweep what is already mounted, then subscribe for every attachment.
    var existing = document.querySelectorAll('img:not([loading])');
    for (var i = 0; i < existing.length; i++) makeLazy(existing[i]);
    RT.dom.onAdded('img', makeLazy);
})();
