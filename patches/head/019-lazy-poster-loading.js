// Lazy load poster images to reduce memory pressure
(function() {
    if (!('IntersectionObserver' in window)) return;
    var observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var added = mutations[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
                if (added[j].nodeType !== 1) continue;
                var imgs = added[j].querySelectorAll ? added[j].querySelectorAll('img:not([loading])') : [];
                for (var k = 0; k < imgs.length; k++) {
                    imgs[k].setAttribute('loading', 'lazy');
                }
                if (added[j].tagName === 'IMG' && !added[j].getAttribute('loading')) {
                    added[j].setAttribute('loading', 'lazy');
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
