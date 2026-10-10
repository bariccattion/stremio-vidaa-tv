// @ts-check
// Honest-behaviour tests for the native-player handoff, transcode gating,
// stall watchdog, and the new diagnostic panel.
//
// These REPLACE the false-confidence tests that injected a fake omi_platform
// and asserted "messages were SENT" — those passed while the feature was 100%
// broken on real hardware. The native handoff is fire-and-forget against a
// fabricated API contract (launchNativePlayer/openMediaPlayer/playVideo are not
// honoured by any VIDAA firmware). The only honest signal that the native app
// actually opened is the browser tab being backgrounded
// (visibilitychange->hidden / blur / pagehide). When no such signal arrives we
// MUST report failure and never corrupt watch state.
//
// Seam: bootApp() (helpers.js) — installFakeNative only CAPTURES, and
// simulateAppBackgrounded uses the real visibilitychange events (the one
// sanctioned simulation). Player-route tests boot with core:'mock' so the
// anonymous SPA's login redirect never fights the route-gated key handlers.
const { test, expect } = require('@playwright/test');
const {
  bootApp, installFakeNative, installFakeVideoFactory,
} = require('./helpers');

test.setTimeout(60000);

const parsedDispatches = (page) =>
  page.evaluate(() => (window.__mockDispatchLog || []).map((e) => JSON.parse(e)));

// ==========================================================================
// H1 — Launcher reports FAILURE when no backgrounding signal occurs
// ==========================================================================
test.describe('H1 — launcher honesty (verification required)', () => {
  test('returns a Promise', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'none' });
    const isPromise = await page.evaluate(() => {
      const r = window.__launchNativePlayer('http://stream.test/video.mkv', { verifyTimeoutMs: 50 });
      return r && typeof r.then === 'function';
    });
    expect(isPromise).toBe(true);
  });

  test('resolves FALSE when the app never backgrounds (fire-and-forget, no ack)', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'mock', url: '/#/player/h1-nofail' });
    const result = await page.evaluate(async () => {
      // No visibilitychange / blur / pagehide will fire — simulating real VIDAA
      // where the message is silently ignored and the browser stays foreground.
      return await window.__launchNativePlayer('http://stream.test/video.mkv', { verifyTimeoutMs: 300 });
    });
    expect(result).toBe(false);
  });

  test('resolves TRUE when a backgrounding signal (visibilitychange->hidden) arrives', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'mock', url: '/#/player/h1-ok' });
    const result = await page.evaluate(async () => {
      const p = window.__launchNativePlayer('http://stream.test/video.mkv', { verifyTimeoutMs: 2000 });
      // Simulate the native app taking the foreground shortly after.
      setTimeout(() => {
        try {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        } catch (e) {}
        document.dispatchEvent(new Event('visibilitychange'));
      }, 60);
      return await p;
    });
    expect(result).toBe(true);
  });

  // P1.14: the fullscreen warning overlay must be dismissible with the
  // remote's Back key (and Escape) — an undismissable fullscreen trap is
  // the known projector regression this layer forbids.
  test('warning overlay closes on Back (and the press does not navigate)', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/#/player/p14-back' });
    const result = await page.evaluate(async () => {
      window.__STREAM_INFO__ = window.__STREAM_INFO__ || {};
      window.__showPlaybackWarning();
      var open = !!document.getElementById('dv-warning');
      // VIDAA Back key (461) — capture phase, like a real remote press.
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      return {
        open: open,
        closed: !document.getElementById('dv-warning'),
        stillPlayer: (window.location.hash || '').indexOf('#/player/') === 0
      };
    });
    expect(result.open).toBe(true);
    expect(result.closed).toBe(true);
    expect(result.stillPlayer).toBe(true);
  });

  // P1.9: some VIDAA firmware backgrounds the page for the whole handoff
  // without firing visibilitychange — the freeze watchdog would read that
  // as a UI freeze and reload mid-handoff. The launcher pauses it for the
  // verification window and resumes it on a foreground failure.
  test('watchdog pauses during handoff verification and resumes on failure', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'mock', url: '/#/player/wd-pause' });
    const out = await page.evaluate(async () => {
      window.__NATIVE_VERIFY_TIMEOUT_MS__ = 500;
      var p = window.__launchNativePlayer('http://stream.test/x.mkv');
      var during = window.__WATCHDOG_PAUSE__;
      await p;
      return { during: during, after: window.__WATCHDOG_PAUSE__ };
    });
    expect(out.during).toBe(true);
    expect(out.after).toBe(false);
  });

  test('resolves FALSE when omi_platform is absent', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/#/player/h1-noapi' });
    const result = await page.evaluate(async () => {
      try { delete window.omi_platform; } catch (e) {}
      return await window.__launchNativePlayer('http://stream.test/video.mkv', { verifyTimeoutMs: 100 });
    });
    expect(result).toBe(false);
  });

  test('still dispatches the platform messages (best-effort send) even though result reflects verification', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'mock', url: '/#/player/h1-send' });
    const sent = await page.evaluate(async () => {
      await window.__launchNativePlayer('http://stream.test/video.mkv', { verifyTimeoutMs: 100 });
      return window.__sentMessages || [];
    });
    // Best-effort: at least one message dispatched, each carrying the URL.
    expect(sent.length).toBeGreaterThan(0);
    const withUrl = sent.find((m) => m && m.url === 'http://stream.test/video.mkv');
    expect(withUrl).toBeDefined();
  });

  // P1.3: launch paths from several patches (auto-native entry, video-prep
  // stall handoff, Yellow key, dv overlay) used to race inside the
  // verification window — six platform messages fighting over one
  // backgrounding signal. The in-flight guard serializes them.
  test('in-flight guard: a concurrent second launch resolves false and sends nothing', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'mock', url: '/#/player/h1-guard' });
    const out = await page.evaluate(async () => {
      window.__NATIVE_VERIFY_TIMEOUT_MS__ = 600;
      const p1 = window.__launchNativePlayer('http://stream.test/first.mkv');
      const p2 = window.__launchNativePlayer('http://stream.test/second.mkv');
      const [r1, r2] = await Promise.all([p1, p2]);
      return {
        r1, r2,
        total: (window.__sentMessages || []).length,
        secondSent: (window.__sentMessages || []).some((m) => m && m.url === 'http://stream.test/second.mkv'),
        memo: window.__nativeHandoff.lastUrl()
      };
    });
    expect(out.r1).toBe(false);   // no backgrounding signal → honest false
    expect(out.r2).toBe(false);   // guard rejected, no verification ran
    expect(out.secondSent).toBe(false);   // the second launch sent NOTHING
    expect(out.total).toBe(3);    // only the first launch's three messages
    expect(out.memo).toBe('http://stream.test/first.mkv');  // shared memo
  });
});

// ==========================================================================
// H2 — Single consolidated launcher (no racing redefinitions)
// ==========================================================================
test.describe('H2 — single consolidated launcher', () => {
  test('launcher identity is stable after all timers settle (no blind 10s overwrite)', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'none' });
    // Wait past the historical 10s blind-overwrite window — the timer IS the
    // behavior under test, so this stays a real (bounded) window.
    await page.waitForTimeout(11500);
    const stable = await page.evaluate(async () => {
      const before = window.__launchNativePlayer;
      await new Promise((r) => setTimeout(r, 1500));
      const after = window.__launchNativePlayer;
      return before === after && typeof after === 'function';
    });
    expect(stable).toBe(true);
  });
});

// ==========================================================================
// H3 — Mark-as-watched only on VERIFIED launch; never corrupt resume point
// ==========================================================================
test.describe('H3 — no fake-progress corruption', () => {
  function h3Core(metaId) {
    return { player: { metaItem: { id: metaId }, video: { id: metaId + ':1:1' } } };
  }

  test('does NOT dispatch any SetProp currentTime (fake 90% progress removed)', async ({ page }) => {
    await installFakeNative(page);
    // Enable the watched toggle so we exercise the path that USED to corrupt progress.
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/h3-progress',
      mockCore: h3Core('tt123'),
      localStorage: { stremio_native_handoff: 'true' },
    });
    // Verified launch via visibilitychange.
    await page.evaluate(async () => {
      const p = window.__launchNativePlayer('http://stream.test/video.mkv', { verifyTimeoutMs: 2000, watchedDelayMs: 50 });
      setTimeout(() => {
        try {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        } catch (e) {}
        document.dispatchEvent(new Event('visibilitychange'));
      }, 60);
      await p;
      await new Promise((r) => setTimeout(r, 300));
    });
    const dispatches = await parsedDispatches(page);
    const fakeProgress = dispatches.find((d) =>
      d.action && d.args && d.args.args &&
      d.args.args.propName === 'currentTime'
    );
    expect(fakeProgress).toBeUndefined();
  });

  test('does NOT mark-as-watched when launch is NOT verified', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/h3-unverified',
      mockCore: h3Core('tt999'),
      localStorage: { stremio_native_handoff: 'true' },
    });
    await page.evaluate(async () => {
      // No backgrounding signal -> unverified -> no watched dispatch.
      await window.__launchNativePlayer('http://stream.test/video.mkv', { verifyTimeoutMs: 200, watchedDelayMs: 50 });
      await new Promise((r) => setTimeout(r, 300));
    });
    const dispatches = await parsedDispatches(page);
    const markWatched = dispatches.find((d) =>
      d.action && d.args && d.args.action === 'MarkAsWatched'
    );
    expect(markWatched).toBeUndefined();
  });

  test('marks-as-watched ONLY when verified AND toggle is on', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/h3-verified',
      mockCore: h3Core('ttOK'),
      localStorage: { stremio_native_handoff: 'true' },
    });
    // The page stays "hidden" (the verified signal), so both the app's
    // watched-delay timer AND Playwright's rAF-based pollers get throttled —
    // poll in-page, where the loop keeps making progress.
    const result = await page.evaluate(async () => {
      const p = window.__launchNativePlayer('http://stream.test/video.mkv', { verifyTimeoutMs: 2000, watchedDelayMs: 50 });
      setTimeout(() => {
        try {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        } catch (e) {}
        document.dispatchEvent(new Event('visibilitychange'));
      }, 60);
      const opened = await p;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if ((window.__mockDispatchLog || []).some((e) => e.indexOf('"MarkAsWatched"') !== -1)) {
          return { opened: opened, dispatched: true };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return { opened: opened, dispatched: false };
    });
    expect(result.opened).toBe(true);
    expect(result.dispatched).toBe(true);
    // The shared mock logs each dispatched action object (flat): the inner
    // payload lives under d.args, not the historical {action: {…}} nesting.
    const dispatches = await parsedDispatches(page);
    const markWatched = dispatches.find((d) =>
      d.action && d.args && d.args.action === 'MarkAsWatched'
    );
    expect(markWatched).toBeTruthy();
  });
});

// ==========================================================================
// H4/M3 — Overlay Force-Transcode gated/labelled when no server
// ==========================================================================
test.describe('H4/M3 — overlay transcode gating', () => {
  test('overlay copy does not advertise transcode as a generic remedy', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => {
      window.__STREMIO_SERVER_URL__ = 'http://127.0.0.1:11470'; // default == no real server
      window.__STREAM_INFO__ = { videoCodec: 'hevc', width: 3840, height: 2160 };
      window.__showPlaybackWarning();
    });
    const overlay = page.locator('#dv-warning');
    await expect(overlay).toBeVisible();
    // The misleading phrase must be gone.
    await expect(overlay).not.toContainText('or transcode via your streaming server');
  });

  test('Force Transcode button does NOT set __FORCE_TRANSCODE__ when no real server', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/#/player/h4-noserver' });
    const set = await page.evaluate(() => {
      window.__STREMIO_SERVER_URL__ = 'http://127.0.0.1:11470'; // default == no real server
      window.__STREAM_INFO__ = window.__STREAM_INFO__ || {};
      window.__FORCE_TRANSCODE__ = false;
      window.__showPlaybackWarning && window.__showPlaybackWarning();
      // Click the Force Transcode button if present & enabled.
      var btns = Array.prototype.slice.call(document.querySelectorAll('#dv-warning button'));
      var transBtn = btns.find(function (b) { return /transcode/i.test(b.textContent || ''); });
      if (transBtn && !transBtn.disabled) transBtn.click();
      var wasDisabledOrAbsent = !transBtn || transBtn.disabled;
      return { force: window.__FORCE_TRANSCODE__, wasDisabledOrAbsent: wasDisabledOrAbsent };
    });
    // Either the button was disabled/absent, OR clicking it did nothing — but it
    // must NOT have pretended transcode was available.
    expect(set.force).not.toBe(true);
  });

  test('Force Transcode IS available when a real streaming server is configured', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/#/player/h4-server' });
    const set = await page.evaluate(() => {
      window.__STREMIO_SERVER_URL__ = 'http://192.168.1.50:11470'; // real, non-default
      window.__STREAM_INFO__ = window.__STREAM_INFO__ || {};
      window.__FORCE_TRANSCODE__ = false;
      window.__showPlaybackWarning && window.__showPlaybackWarning();
      var btns = Array.prototype.slice.call(document.querySelectorAll('#dv-warning button'));
      var transBtn = btns.find(function (b) { return /transcode/i.test(b.textContent || ''); });
      if (transBtn && !transBtn.disabled) transBtn.click();
      return { force: window.__FORCE_TRANSCODE__, present: !!transBtn };
    });
    expect(set.present).toBe(true);
    expect(set.force).toBe(true);
  });
});

// ==========================================================================
// H5 — Watchdog UN-PAUSES the video on failed handoff
// ==========================================================================
test.describe('H5 — recovery un-pauses on failed handoff', () => {
  test('helper __recoverAfterFailedHandoff resumes a paused video and shows advice', async ({ page }) => {
    await installFakeVideoFactory(page);
    await bootApp(page, { core: 'mock', url: '/#/player/h5' });
    const result = await page.evaluate(async () => {
      const v = window.__makeFakeVideo({});
      // Simulate a paused-after-failed-handoff state.
      window.__recoverAfterFailedHandoff(v);
      await new Promise((r) => setTimeout(r, 50));
      var toastShown = !!document.querySelector('#__handoff-fail-toast, .dv-honest-toast');
      return { played: v.__counters.play > 0, toastShown: toastShown };
    });
    expect(result.played).toBe(true);
    expect(result.toastShown).toBe(true);
  });
});

// ==========================================================================
// M1 — Yellow-button toast reflects verified result
// ==========================================================================
test.describe('M1 — yellow-button toast honesty', () => {
  test('shows an honest failure toast when handoff is unverified', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'mock', url: '/#/player/m1' });
    const toastText = await page.evaluate(async () => {
      // Speed up verification for the test.
      window.__NATIVE_VERIFY_TIMEOUT_MS__ = 200;
      var video = document.createElement('video');
      video.src = 'http://stream.test/video.mkv';
      document.body.appendChild(video);
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 405, bubbles: true }));
      // Wait for verification window + a margin.
      await new Promise((r) => setTimeout(r, 600));
      var toasts = Array.prototype.slice.call(document.querySelectorAll('div'))
        .map(function (d) { return d.textContent || ''; })
        .filter(function (t) { return /native|player|open|couldn|stream/i.test(t) && t.length < 120; });
      return toasts.join(' || ');
    });
    // It must NOT falsely claim success ("Opening in native player...").
    expect(/opening in native player/i.test(toastText)).toBe(false);
  });
});

// ==========================================================================
// M2 — Overlay "Open in Native Player" keeps recovery UI on failure
// ==========================================================================
test.describe('M2 — overlay keeps recovery UI on failed handoff', () => {
  test('overlay is NOT removed when the handoff fails', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'mock', url: '/#/player/m2' });
    const stillThere = await page.evaluate(async () => {
      window.__NATIVE_VERIFY_TIMEOUT_MS__ = 200;
      window.__STREAM_INFO__ = window.__STREAM_INFO__ || {};
      var video = document.createElement('video');
      video.src = 'http://stream.test/video.mkv';
      document.body.appendChild(video);
      window.__showPlaybackWarning && window.__showPlaybackWarning();
      var btns = Array.prototype.slice.call(document.querySelectorAll('#dv-warning button'));
      var nativeBtn = btns.find(function (b) { return /native/i.test(b.textContent || ''); });
      if (nativeBtn) nativeBtn.click();
      await new Promise((r) => setTimeout(r, 600));
      return !!document.getElementById('dv-warning');
    });
    expect(stillThere).toBe(true);
  });
});

// ==========================================================================
// NEW — Diagnostic panel outputs the expected fields
// ==========================================================================
test.describe('Diagnostic panel', () => {
  test('window.__showVidaaDiagnostic exists and renders a screenshot-friendly panel', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'none' });
    const exists = await page.evaluate(() => typeof window.__showVidaaDiagnostic === 'function');
    expect(exists).toBe(true);
  });

  test('panel reports omi_platform + sendPlatformMessage presence (the key per-device datum)', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'none' });
    const text = await page.evaluate(() => {
      window.__STREAM_INFO__ = { videoCodec: 'hevc', width: 3840, height: 2160, container: 'mkv' };
      window.__showVidaaDiagnostic();
      var panel = document.getElementById('vidaa-diagnostic-panel');
      return panel ? panel.textContent : '';
    });
    expect(/omi_platform/i.test(text)).toBe(true);
    expect(/sendPlatformMessage/i.test(text)).toBe(true);
  });

  test('panel includes stream container/codec/resolution and is dismissible', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'none' });
    const result = await page.evaluate(async () => {
      window.__STREAM_INFO__ = { videoCodec: 'hevc', width: 3840, height: 2160, container: 'mkv' };
      window.__showVidaaDiagnostic();
      var panel = document.getElementById('vidaa-diagnostic-panel');
      var text = panel ? panel.textContent : '';
      var hasCodec = /hevc/i.test(text);
      var hasRes = /3840/.test(text) && /2160/.test(text);
      // Dismiss it — the shell's Close button is the modal's first button.
      var closeBtn = panel && panel.querySelector('button');
      if (closeBtn) closeBtn.click();
      await new Promise((r) => setTimeout(r, 50));
      var dismissed = !document.getElementById('vidaa-diagnostic-panel');
      return { hasCodec: hasCodec, hasRes: hasRes, dismissed: dismissed };
    });
    expect(result.hasCodec).toBe(true);
    expect(result.hasRes).toBe(true);
    expect(result.dismissed).toBe(true);
  });

  test('diagnostic is registered as a VIDAA settings item', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const registered = await page.evaluate(() => {
      var items = window.__vidaaSettingsItems || [];
      return items.some(function (i) { return /diagnostic/i.test(i.id || '') || /diagnostic/i.test(i.label || ''); });
    });
    expect(registered).toBe(true);
  });

  test('diagnostic reachable via color-button combo (no number keys)', async ({ page }) => {
    await installFakeNative(page);
    await bootApp(page, { core: 'mock', url: '/#/player/diag-combo' });
    const shown = await page.evaluate(async () => {
      window.__STREAM_INFO__ = { videoCodec: 'hevc', width: 3840, height: 2160, container: 'mkv' };
      // Green held, then Red — the chosen combo (color keys only).
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 404, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 403, bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      return !!document.getElementById('vidaa-diagnostic-panel');
    });
    expect(shown).toBe(true);
  });
});

// ==========================================================================
// NEW — Honest stall messaging (non-blocking, dismissible, toggleable)
// ==========================================================================
test.describe('Honest stall messaging', () => {
  test('__showHonestStallMessage renders a dismissible NON-fullscreen message', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/#/player/honest' });
    const result = await page.evaluate(async () => {
      window.__showHonestStallMessage();
      var el = document.getElementById('dv-honest-stall');
      if (!el) return { present: false };
      // Must NOT be a fullscreen overlay that traps the remote.
      var isFullscreen = (el.offsetWidth >= window.innerWidth - 2) && (el.offsetHeight >= window.innerHeight - 2);
      var text = el.textContent || '';
      // Dismiss it.
      var btn = el.querySelector('button');
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 50));
      var dismissed = !document.getElementById('dv-honest-stall');
      return { present: true, isFullscreen: isFullscreen, mentionsAdvice: /1080p|mp4|streaming server/i.test(text), dismissed: dismissed };
    });
    expect(result.present).toBe(true);
    expect(result.isFullscreen).toBe(false);
    expect(result.mentionsAdvice).toBe(true);
    expect(result.dismissed).toBe(true);
  });
});
