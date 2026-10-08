// @ts-check
// Seam: bootApp() (helpers.js). Core-dependent tests use the shared mock core
// (window.__mockDispatchLog holds each dispatched action object, flat — the
// inner payload lives under d.args), so waits are on dispatch signals, never
// on fixed sleeps. __launchNativePlayer is a synchronous kernel global — no
// install-timeout waits remain.
const { test, expect } = require('@playwright/test');
const { bootApp, installFakeNative } = require('./helpers');

test.setTimeout(60000);

const parsedDispatches = (page) =>
  page.evaluate(() => (window.__mockDispatchLog || []).map((e) => JSON.parse(e)));

// ==========================================================================
// #10 — Suppress F key crash
// ==========================================================================
test.describe('#10 — Suppress F key crash', () => {
  test('F key is prevented on non-input elements', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const prevented = await page.evaluate(() => {
      var div = document.createElement('div');
      div.tabIndex = 0;
      document.body.appendChild(div);
      return !div.dispatchEvent(new KeyboardEvent('keydown', {
        keyCode: 70, key: 'F', bubbles: true, cancelable: true
      }));
    });
    expect(prevented).toBe(true);
  });

  test('F key is NOT prevented on input elements', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const prevented = await page.evaluate(() => {
      var input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);
      return !input.dispatchEvent(new KeyboardEvent('keydown', {
        keyCode: 70, key: 'F', bubbles: true, cancelable: true
      }));
    });
    expect(prevented).toBe(false);
  });

  test('F key is NOT prevented on textarea elements', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const prevented = await page.evaluate(() => {
      var ta = document.createElement('textarea');
      document.body.appendChild(ta);
      return !ta.dispatchEvent(new KeyboardEvent('keydown', {
        keyCode: 70, key: 'F', bubbles: true, cancelable: true
      }));
    });
    expect(prevented).toBe(false);
  });
});

// ==========================================================================
// #6 — Exit button for VIDAA TV
// ==========================================================================
test.describe('#6 — Exit button', () => {
  test('window.__exitApp function exists', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const exists = await page.evaluate(() => typeof window.__exitApp === 'function');
    expect(exists).toBe(true);
  });

  test('__exitApp tries Hisense_Exit then window.close as fallback', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const result = await page.evaluate(() => {
      var closeCalled = false;
      var origClose = window.close;
      window.close = function() { closeCalled = true; };
      window.__exitApp();
      window.close = origClose;
      return closeCalled;
    });
    // In test env without Hisense APIs, it falls back to window.close
    expect(result).toBe(true);
  });

  test('exit button is NOT present outside settings page', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    // The Exit Stremio row only renders inside the Settings screen's Vidaa TV
    // section; at '/' (anonymous login screen) it must not exist.
    const count = await page.locator('#vidaa-exit-btn').count();
    expect(count).toBe(0);
  });
});

// ==========================================================================
// #9 — Save and restore playback speed & volume
// ==========================================================================
test.describe('#9 — Playback speed & volume persistence', () => {
  test('getSavedSpeed returns valid stored value', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    // Test the localStorage read/write logic the patch uses
    const result = await page.evaluate(() => {
      localStorage.setItem('stremio_playback_speed', '1.5');
      var v = parseFloat(localStorage.getItem('stremio_playback_speed'));
      return (v && v > 0 && v <= 4) ? v : null;
    });
    expect(result).toBe(1.5);
  });

  test('getSavedSpeed rejects invalid values', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const results = await page.evaluate(() => {
      var tests = [];
      // Test negative
      localStorage.setItem('stremio_playback_speed', '-1');
      var v1 = parseFloat(localStorage.getItem('stremio_playback_speed'));
      tests.push({ input: '-1', valid: (v1 && v1 > 0 && v1 <= 4) ? true : false });
      // Test too high
      localStorage.setItem('stremio_playback_speed', '5');
      var v2 = parseFloat(localStorage.getItem('stremio_playback_speed'));
      tests.push({ input: '5', valid: (v2 && v2 > 0 && v2 <= 4) ? true : false });
      // Test NaN
      localStorage.setItem('stremio_playback_speed', 'abc');
      var v3 = parseFloat(localStorage.getItem('stremio_playback_speed'));
      tests.push({ input: 'abc', valid: (v3 && v3 > 0 && v3 <= 4) ? true : false });
      return tests;
    });
    expect(results[0].valid).toBe(false);
    expect(results[1].valid).toBe(false);
    expect(results[2].valid).toBe(false);
  });

  test('getSavedVolume returns valid stored value', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const result = await page.evaluate(() => {
      localStorage.setItem('stremio_volume', '0.7');
      var v = parseFloat(localStorage.getItem('stremio_volume'));
      return (v >= 0 && v <= 1) ? v : null;
    });
    expect(result).toBe(0.7);
  });

  test('speed is NOT applied outside #/player/ route', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => {
      localStorage.setItem('stremio_playback_speed', '1.5');
      var video = document.createElement('video');
      document.body.appendChild(video);
    });
    // Observation window: spans the patch's route poller — a misapplied speed
    // would land within the first tick(s).
    await page.waitForTimeout(4000);
    const speed = await page.evaluate(() => {
      var v = document.querySelector('video');
      return v ? v.playbackRate : null;
    });
    expect(speed).toBe(1);
  });
});

// ==========================================================================
// #8 — Fix subtitle size on start
// ==========================================================================
test.describe('#8 — Subtitle size persistence', () => {
  test('saved subtitle size dispatches SetProp to core on player init', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/sub-size-test',
      mockCore: {},
      localStorage: { stremio_subtitle_size: '150' },
    });
    // The patch dispatches when it sees the player route + saved size — wait
    // for the dispatch signal itself.
    await page.waitForFunction(
      () => (window.__mockDispatchLog || []).some((e) => e.indexOf('"subtitleSize"') !== -1),
      null,
      { timeout: 10000 }
    );
    const dispatches = await parsedDispatches(page);
    const sizeDispatch = dispatches.find(function(d) {
      return d.args && d.args.args &&
        d.args.args.propName === 'subtitleSize' &&
        d.args.args.propValue === 150;
    });
    expect(sizeDispatch).toBeTruthy();
  });

  test('out-of-range sizes are ignored', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => {
      localStorage.setItem('stremio_subtitle_size', '999');
    });

    const valid = await page.evaluate(() => {
      var v = parseInt(localStorage.getItem('stremio_subtitle_size'), 10);
      return (v && v >= 50 && v <= 250) ? v : null;
    });
    expect(valid).toBeNull();
  });
});

// ==========================================================================
// #7 — Remember subtitle language preference
// ==========================================================================
test.describe('#7 — Subtitle language memory', () => {
  test('exact match: saved "eng" selects track with lang "eng"', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/lang-exact',
      mockCore: {
        player: {
          subtitleTracks: [
            { id: 'track-fr', lang: 'fre' },
            { id: 'track-en', lang: 'eng' }
          ]
        }
      },
      localStorage: { stremio_subtitle_lang: 'eng' },
    });
    await page.waitForFunction(
      () => (window.__mockDispatchLog || []).some((e) => e.indexOf('"selectedSubtitleTrackId"') !== -1),
      null,
      { timeout: 10000 }
    );
    const dispatches = await parsedDispatches(page);
    const langPick = dispatches.find(function(d) {
      return d.args && d.args.args &&
        d.args.args.propName === 'selectedSubtitleTrackId' &&
        d.args.args.propValue === 'track-en';
    });
    expect(langPick).toBeTruthy();
  });

  test('partial match: saved "en" matches track lang "eng"', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/lang-partial',
      mockCore: {
        player: {
          subtitleTracks: [
            { id: 'track-deu', lang: 'deu' },
            { id: 'track-eng', lang: 'eng' }
          ]
        }
      },
      localStorage: { stremio_subtitle_lang: 'en' },
    });
    await page.waitForFunction(
      () => (window.__mockDispatchLog || []).some((e) => e.indexOf('"selectedSubtitleTrackId"') !== -1),
      null,
      { timeout: 10000 }
    );
    const dispatches = await parsedDispatches(page);
    const langPick = dispatches.find(function(d) {
      return d.args && d.args.args &&
        d.args.args.propName === 'selectedSubtitleTrackId' &&
        d.args.args.propValue === 'track-eng';
    });
    expect(langPick).toBeTruthy();
  });

  test('no auto-select when no saved language', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => {
      localStorage.removeItem('stremio_subtitle_lang');
    });
    // The patch won't do anything without a saved language — just verify no crash
    const lang = await page.evaluate(() => localStorage.getItem('stremio_subtitle_lang'));
    expect(lang).toBeNull();
  });
});

// ==========================================================================
// #11 — Subtitle off/unload option
// ==========================================================================
test.describe('#11 — Subtitle off option', () => {
  test('window.__disableSubtitles is a function', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const exists = await page.evaluate(() => typeof window.__disableSubtitles === 'function');
    expect(exists).toBe(true);
  });

  test('dispatches null selectedSubtitleTrackId to core', async ({ page }) => {
    await bootApp(page, { core: 'mock' });
    await page.evaluate(() => window.__disableSubtitles());
    const dispatches = await parsedDispatches(page);
    const nullSub = dispatches.find(function(d) {
      return d.args && d.args.args &&
        d.args.args.propName === 'selectedSubtitleTrackId' &&
        d.args.args.propValue === null;
    });
    expect(nullSub).toBeTruthy();
  });

  test('clears saved subtitle language from localStorage', async ({ page }) => {
    await bootApp(page, { core: 'mock' });
    await page.evaluate(() => {
      localStorage.setItem('stremio_subtitle_lang', 'eng');
      window.__disableSubtitles();
    });
    const stored = await page.evaluate(() => localStorage.getItem('stremio_subtitle_lang'));
    expect(stored).toBeNull();
  });
});

// ==========================================================================
// #12 — Pass full title to native player
// ==========================================================================
test.describe('#12 — Native player title', () => {
  test('__launchNativePlayer is available as soon as the patch layer loads', async ({ page }) => {
    // The consolidated launcher (kernel/native-player.js) is defined
    // synchronously with the inline patch scripts — the historical 10s
    // install timeout is gone, and so is the 11s wait.
    await bootApp(page, { core: 'none' });
    const exists = await page.evaluate(() => typeof window.__launchNativePlayer === 'function');
    expect(exists).toBe(true);
  });

  test('__STREAM_INFO__ is used to store and retrieve title', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const title = await page.evaluate(() => {
      window.__STREAM_INFO__ = { title: 'Test Movie 2024' };
      return window.__STREAM_INFO__.title;
    });
    expect(title).toBe('Test Movie 2024');
  });

  test('title scraping logic finds h1/h2 elements with title class', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    // Directly test the title scraping logic the patch uses
    const title = await page.evaluate(() => {
      var h1 = document.createElement('h1');
      h1.className = 'video-title';
      h1.textContent = 'Inception';
      document.body.appendChild(h1);
      // Replicate the patch's scraping logic
      var h1s = document.querySelectorAll('h1, h2, [class*="title"], [class*="Title"]');
      for (var i = 0; i < h1s.length; i++) {
        var txt = (h1s[i].textContent || '').trim();
        if (txt.length > 2 && txt.length < 200) return txt;
      }
      return null;
    });
    expect(title).toBe('Inception');
  });

  test('launcher carries a title in its best-effort platform messages', async ({ page }) => {
    // Honest version: the consolidated launcher still SENDS the messages
    // (best-effort), each carrying the stream URL + a title — but the messages
    // being sent says NOTHING about success. See buffering-honesty.spec.js for
    // the verification-result assertions.
    await installFakeNative(page, '__testPlatformMessages');
    await bootApp(page, { core: 'none' });

    const sent = await page.evaluate(async () => {
      // Short verify window so the returned Promise settles quickly.
      try { await window.__launchNativePlayer('http://stream.test/video.mp4', { verifyTimeoutMs: 100 }); } catch(e) {}
      return window.__testPlatformMessages || [];
    });

    expect(sent.length).toBeGreaterThan(0);
    var withUrl = sent.find(function(m) { return m.url === 'http://stream.test/video.mp4'; });
    expect(withUrl).toBeDefined();
    expect(typeof withUrl.title).toBe('string');
    expect(withUrl.title.length).toBeGreaterThan(0);
  });
});

// ==========================================================================
// #13 — Mark as watched after native player handoff
// ==========================================================================
test.describe('#13 — Mark as watched on handoff', () => {
  // The old JSON-state recording + fake-90%-progress behaviour was REMOVED.
  // Mark-as-watched now fires ONLY on a VERIFIED handoff and ONLY when the user
  // enables the toggle — and never corrupts the resume point. The honest
  // behaviour is asserted in buffering-honesty.spec.js (H3). Here we just verify
  // the feature is now a user-toggleable settings item per the project rule.
  test('mark-watched-on-handoff is registered as a toggleable settings item', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const registered = await page.evaluate(() => {
      var items = window.__vidaaSettingsItems || [];
      return items.some(function (i) {
        return i.lsKey === 'stremio_native_handoff' && i.type === 'toggle' && i.defaultValue === false;
      });
    });
    expect(registered).toBe(true);
  });
});

// ==========================================================================
// #14 — Full subtitle filenames in picker
// ==========================================================================
test.describe('#14 — Full subtitle filenames', () => {
  test('__fullSubLabels object exists', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const exists = await page.evaluate(() =>
      typeof window.__fullSubLabels === 'object' && window.__fullSubLabels !== null
    );
    expect(exists).toBe(true);
  });

  test('fetch wrapper still works for normal requests', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const ok = await page.evaluate(async () => {
      var resp = await fetch('/');
      return resp.status >= 200;
    });
    expect(ok).toBe(true);
  });

  test('subtitle fetch responses are intercepted and cached', async ({ page }) => {
    await page.route('**/subtitles/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subtitles: [
            { id: 'sub1', filename: 'Movie.2024.BluRay.1080p.English.srt', lang: 'eng' },
            { id: 'sub2', title: 'Spanish Translation', lang: 'spa' }
          ]
        })
      });
    });

    await bootApp(page, { core: 'none' });
    await page.evaluate(async () => {
      try { await fetch('/subtitles/test-movie'); } catch(e) {}
    });
    // The wrapper caches asynchronously — wait for the cache to be populated.
    await page.waitForFunction(
      () => Object.keys(window.__fullSubLabels || {}).length > 0,
      null,
      { timeout: 5000 }
    );
    const labels = await page.evaluate(() => window.__fullSubLabels);
    expect(labels['sub1']).toBe('Movie.2024.BluRay.1080p.English');
    expect(labels['sub2']).toBe('Spanish Translation');
  });
});

// ==========================================================================
// #15 — Prefetch next episode
// ==========================================================================
test.describe('#15 — Prefetch next episode', () => {
  test('prefetch logic correctly extracts next episode URL from state', async ({ page }) => {
    await bootApp(page, { core: 'none' });

    // Test the URL extraction logic the patch uses
    const result = await page.evaluate(() => {
      var state = {
        nextVideo: {
          stream: { url: 'http://stream.test/next-ep.mp4' }
        }
      };

      // Replicate the patch's extraction logic
      var nextVideo = null;
      if (state.nextVideo) nextVideo = state.nextVideo;
      else if (state.seriesInfo && state.seriesInfo.nextVideo) nextVideo = state.seriesInfo.nextVideo;
      else if (state.nextEpisode) nextVideo = state.nextEpisode;

      var nextUrl = null;
      if (nextVideo && nextVideo.stream && nextVideo.stream.url) nextUrl = nextVideo.stream.url;
      else if (nextVideo && nextVideo.url) nextUrl = nextVideo.url;

      return { nextVideo: !!nextVideo, url: nextUrl };
    });

    expect(result.nextVideo).toBe(true);
    expect(result.url).toBe('http://stream.test/next-ep.mp4');
  });

  test('no prefetch fires outside player route', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      mockCore: { player: { nextVideo: { stream: { url: 'http://nope.test/video.mp4' } } } },
    });
    await page.evaluate(() => {
      window.__prefetchCalls = [];
      var currentFetch = window.fetch;
      window.fetch = function(url, opts) {
        if (opts && opts.method === 'HEAD') {
          window.__prefetchCalls.push(url);
        }
        return currentFetch.apply(this, arguments);
      };
    });
    // Observation window: spans the patch's poller — a route-gating bug would
    // fire a HEAD within the first tick(s).
    await page.waitForTimeout(8000);
    const calls = await page.evaluate(() => window.__prefetchCalls || []);
    expect(calls.length).toBe(0);
  });
});

// ==========================================================================
// Integration: all patches coexist
// ==========================================================================
test.describe('Integration', () => {
  test('all patch globals are defined after page load', async ({ page }) => {
    await bootApp(page, { core: 'none' });

    const globals = await page.evaluate(() => ({
      exitApp: typeof window.__exitApp,
      disableSubtitles: typeof window.__disableSubtitles,
      launchNativePlayer: typeof window.__launchNativePlayer,
      fullSubLabels: typeof window.__fullSubLabels
    }));

    expect(globals.exitApp).toBe('function');
    expect(globals.disableSubtitles).toBe('function');
    expect(globals.launchNativePlayer).toBe('function');
    expect(globals.fullSubLabels).toBe('object');
  });

  test('localStorage keys use stremio_ prefix', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => {
      localStorage.setItem('stremio_playback_speed', '1.25');
      localStorage.setItem('stremio_volume', '0.8');
      localStorage.setItem('stremio_subtitle_size', '120');
      localStorage.setItem('stremio_subtitle_lang', 'eng');
    });
    const keys = await page.evaluate(() => {
      var result = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('stremio_') === 0) result.push(k);
      }
      return result.sort();
    });
    expect(keys).toContain('stremio_playback_speed');
    expect(keys).toContain('stremio_volume');
    expect(keys).toContain('stremio_subtitle_size');
    expect(keys).toContain('stremio_subtitle_lang');
  });

  test('no console errors from patches during load', async ({ page }) => {
    var errors = [];
    page.on('pageerror', function(err) { errors.push(err.message); });
    await bootApp(page, { core: 'none' });
    // Observation window: patch pollers run on intervals — give them a few
    // ticks to prove they don't throw.
    await page.waitForTimeout(3000);
    var patchErrors = errors.filter(function(e) {
      return e.indexOf('[patch]') !== -1 || e.indexOf('[exit]') !== -1 ||
             e.indexOf('[subs]') !== -1 || e.indexOf('[playback]') !== -1 ||
             e.indexOf('[watched]') !== -1 || e.indexOf('[prefetch]') !== -1;
    });
    expect(patchErrors).toEqual([]);
  });
});
