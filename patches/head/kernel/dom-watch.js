// ═══════════════════════════════════════════════════════════════════════
// RT.dom — the ONE DOM attachment watcher (P1.6).
// ═══════════════════════════════════════════════════════════════════════
// Two patches used to run their own always-on MutationObservers over the
// whole DOM (video-prep for <video> creation, lazy-posters for <img>), and
// four more re-queried document.querySelector('video') on every poll tick.
// This module centralizes that: ONE observer on documentElement, selector
// subscriptions, and a cached current-video lookup invalidated on mutation.
//
//   RT.dom.onAdded(selector, fn)  → off()   fn(addedElement) for every
//                                   element matching selector that enters
//                                   the DOM (self or nested in an added
//                                   subtree). fn runs once per element.
//   RT.dom.onVideoAdded(fn)       → off()   sugar for onAdded('video', fn)
//   RT.dom.currentVideo()                   cached querySelector('video')
//                                           (null when none); re-queried
//                                           only after DOM mutations.
//   RT.dom.onVideoChanged(fn)     → off()   fn(current, previous) when the
//                                           current video's IDENTITY changes
//                                           (engine swaps recreate it).
//
// ES5, no dependencies beyond __vidaaRuntime. Feature-check before use.
(function() {
    'use strict';

    var RT = window.__vidaaRuntime;
    var log = RT.logger('dom');

    var addedSubs = [];      // {selector, fn, seen: [] of elements}
    var changedSubs = [];    // fn(current, previous)
    var currentVideo = null;
    var videoChecked = false;

    function fireChanged(prev) {
        for (var i = 0; i < changedSubs.length; i++) {
            try { changedSubs[i](currentVideo, prev); } catch (e) {
                log.error('onVideoChanged subscriber failed:', (e && e.message) || e);
            }
        }
    }

    function refreshCurrentVideo() {
        var prev = currentVideo;
        var next = null;
        try { next = document.querySelector('video'); } catch (e) {}
        videoChecked = true;
        if (next !== prev) {
            currentVideo = next;
            fireChanged(prev);
        }
    }

    function deliver(sub, el) {
        // Once per element per subscription: an element re-added after
        // removal SHOULD fire again, so drop it from `seen` on removal.
        for (var i = 0; i < sub.seen.length; i++) {
            if (sub.seen[i] === el) return;
        }
        sub.seen.push(el);
        try { sub.fn(el); } catch (e) {
            log.error('onAdded("' + sub.selector + '") subscriber failed:', (e && e.message) || e);
        }
    }

    function pruneSeen() {
        // Cap the seen-lists: only elements still in the document matter.
        for (var s = 0; s < addedSubs.length; s++) {
            var sub = addedSubs[s];
            var alive = [];
            for (var i = 0; i < sub.seen.length; i++) {
                if (sub.seen[i].isConnected) alive.push(sub.seen[i]);
            }
            sub.seen = alive;
        }
    }

    function onMutations(muts) {
        var touched = false;
        for (var i = 0; i < muts.length; i++) {
            var m = muts[i];
            var added = m.addedNodes || [];
            for (var j = 0; j < added.length; j++) {
                var n = added[j];
                if (!n || n.nodeType !== 1) continue;
                touched = true;
                for (var s = 0; s < addedSubs.length; s++) {
                    var sub = addedSubs[s];
                    try {
                        if (n.matches && n.matches(sub.selector)) deliver(sub, n);
                        if (n.querySelectorAll) {
                            var nested = n.querySelectorAll(sub.selector);
                            for (var k = 0; k < nested.length; k++) deliver(sub, nested[k]);
                        }
                    } catch (e) { /* synthetic/partial nodes in tests */ }
                }
            }
            if (m.removedNodes && m.removedNodes.length) touched = true;
        }
        if (touched) {
            refreshCurrentVideo();
            pruneSeen();
        }
    }

    var mo = new MutationObserver(onMutations);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    refreshCurrentVideo();

    RT.dom = {
        onAdded: function(selector, fn) {
            var sub = { selector: selector, fn: fn, seen: [] };
            addedSubs.push(sub);
            return function off() {
                for (var i = 0; i < addedSubs.length; i++) {
                    if (addedSubs[i] === sub) { addedSubs.splice(i, 1); break; }
                }
            };
        },
        onVideoAdded: function(fn) {
            return RT.dom.onAdded('video', fn);
        },
        currentVideo: function() {
            if (!videoChecked) refreshCurrentVideo();
            return currentVideo;
        },
        onVideoChanged: function(fn) {
            changedSubs.push(fn);
            return function off() {
                for (var i = 0; i < changedSubs.length; i++) {
                    if (changedSubs[i] === fn) { changedSubs.splice(i, 1); break; }
                }
            };
        }
    };

    log('dom watcher ready');
})();
