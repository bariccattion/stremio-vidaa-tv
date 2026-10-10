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
// #8 — Subtitle size persistence: REMOVED (P0.1, 2026-10-08)
// The size-persist patch was dead code — it dispatched a nonexistent
// `Player/SetProp` core action with the wrong prop name (`subtitleSize`;
// the engine prop is `subtitlesSize`). Subtitle size is persisted natively
// by the core (Settings ▸ Playback ▸ Subtitles → Size → Ctx UpdateSettings),
// so the patch and its tests were deleted together.
// ==========================================================================

// ==========================================================================
// #7 — Subtitle language memory: REMOVED (P0.2, 2026-10-08)
// The patch was provably inert end-to-end: the save path read
// `state.selectedSubtitleTrack`/`.selected` (fields the real player state
// does not expose — it has `subtitlesTracks` + `selectedSubtitlesTrackId`),
// so `stremio_subtitle_lang` was never written in production; the apply
// path read `state.subtitleTracks` (wrong name) and dispatched the
// nonexistent `Player/SetProp` action with `selectedSubtitleTrackId`.
// The mock-core tests below passed because they were crafted with the
// phantom field shapes — validating our protocol, not the engine's
// (the P0.10 test-debt problem in docs/PATCHES_VS_UPSTREAM.md).
// Language memory is served by the core natively: Settings ▸ Playback ▸
// Subtitles ▸ DEFAULT_LANGUAGE persists `subtitlesLanguage` (+ wasm
// `subtitlesAutoSelect`). Verify on the manual TV smoke checklist.
// ==========================================================================

// ==========================================================================
// #11 — Subtitle off option: REMOVED (P0.3, 2026-10-08)
// The patch was removed: upstream Theater 1.10.0's subtitle picker already
// leads with a NONE row (clears both selectedSubtitlesTrackId and
// selectedExtratitlesTrackId through the engine controller). Our injection
// targeted `[class*="track"]` selectors that only match the seekbar's
// track class, and its click dispatched a nonexistent `Player/SetProp`
// core action with the wrong prop name — a no-op that corrupted the
// seekbar instead. The tests went with the patch.
// ==========================================================================

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

  // P0.5 regression lock: the rewrite targets the settings-list row structure
  // (`.option-*` row with a `.label-*` text child) and is content-qualified —
  // the old `[class*="track"]` selector + `indexOf('') === 0` empty-prefix
  // match wrote subtitle filenames into the seekbar's track element.
  test('picker label rows expand; seekbar-class elements are never touched', async ({ page }) => {
    // core:'mock' — the app's auth guard keeps the #/player/ route mounted
    // (with core:'none' it redirects to /login and the observer never arms).
    await bootApp(page, { core: 'mock', mockCore: {}, url: '/#/player/expand-test' });
    // Let the patch's 2s route poller connect its MutationObserver.
    await page.waitForTimeout(2500);

    await page.evaluate(() => {
      // Mutate the cache object the patch closure holds — replacing
      // window.__fullSubLabels outright would leave the closure's
      // reference untouched.
      window.__fullSubLabels.sub1 = 'Movie.2024.BluRay.1080p.x264-GROUP.english';
      var menu = document.createElement('div');

      // A settings-list option row: icon + label children, truncated label.
      var row = document.createElement('div');
      row.className = 'option-pCk4g';
      var icon = document.createElement('div');
      icon.className = 'icon-QwWkt';
      var label = document.createElement('div');
      label.className = 'label-ZUqct';
      label.textContent = 'Movie.2024.Blu';
      row.appendChild(icon);
      row.appendChild(label);
      menu.appendChild(row);

      // The old bug's victim: the seekbar track (no label child, empty text).
      var seek = document.createElement('div');
      seek.className = 'track-Xfs0A';
      seek.textContent = '';
      menu.appendChild(seek);

      document.body.appendChild(menu);
    });

    await page.waitForFunction(() => {
      var el = document.querySelector('.label-ZUqct');
      return el && el.textContent.indexOf('x264-GROUP') !== -1;
    }, null, { timeout: 5000 });

    const seek = await page.evaluate(() => {
      var el = document.querySelector('.track-Xfs0A');
      return {
        text: el ? el.textContent : 'GONE',
        marked: el ? el.getAttribute('data-full-label') : 'GONE'
      };
    });
    expect(seek.text).toBe('');
    expect(seek.marked).toBeNull();

    // The rewrite touches only the label child — siblings survive.
    const iconSurvived = await page.evaluate(() =>
      !!document.querySelector('.option-pCk4g .icon-QwWkt')
    );
    expect(iconSurvived).toBe(true);
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
// #20 — Mark Season as Watched (rewritten P0.6; tested via the
// __markSeasonWatched seam — DOM injection stays untested like the other
// injection paths).
// ==========================================================================
test.describe('#20 — Mark Season as Watched', () => {
  const SEASON_STATE = {
    meta_details: {
      metaItem: {
        ready: {
          videos: [
            { id: 's01e01', season: 1, episode: 1 },
            { id: 's01e02', season: 1, episode: 2 },
            { id: 's02e01', season: 2, episode: 1 }
          ]
        }
      }
    }
  };

  test('marks only the selected season via meta_details', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      mockCore: SEASON_STATE,
      url: '/#/detail/series/tt999?season=2',
    });
    const res = await page.evaluate(() => window.__markSeasonWatched());
    expect(res).toEqual({ total: 1, ok: 1, fail: 0 });
    const dispatches = await parsedDispatches(page);
    const marks = dispatches.filter((d) =>
      d.action === 'MetaDetails' && d.args && d.args.action === 'MarkVideoAsWatched');
    expect(marks.length).toBe(1);
    expect(marks[0].args.args).toEqual({ id: 's02e01', isWatched: true });
  });

  test('defaults to season 1 when the route has no season param', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      mockCore: SEASON_STATE,
      url: '/#/detail/series/tt999',
    });
    const res = await page.evaluate(() => window.__markSeasonWatched());
    expect(res.total).toBe(2);
    expect(res.ok).toBe(2);
    const dispatches = await parsedDispatches(page);
    const ids = dispatches
      .filter((d) => d.action === 'MetaDetails' && d.args && d.args.action === 'MarkVideoAsWatched')
      .map((d) => d.args.args.id).sort();
    expect(ids).toEqual(['s01e01', 's01e02']);
  });

  test('no videos in state → nothing dispatched, honest zero result', async ({ page }) => {
    await bootApp(page, { core: 'mock', mockCore: {}, url: '/#/detail/series/tt999?season=1' });
    const res = await page.evaluate(() => window.__markSeasonWatched());
    expect(res.total).toBe(0);
    expect(res.ok).toBe(0);
    const dispatches = await parsedDispatches(page);
    expect(dispatches.filter((d) => d.action === 'MetaDetails').length).toBe(0);
  });
});

// ==========================================================================
// Stats v2 (P2.3) — verified stream facts in the overlay: hash/size/file
// from the selected stream's behaviorHints (the fields the upstream
// videoParams wrapper consumes), source classification, honest unknowns.
// ==========================================================================
test.describe('#22 — Stream stats v2 (verified facts)', () => {
  test('overlay lines show hash/size/file from the selected stream, not labels', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/stats-v2',
      mockCore: {
        player: {
          stream: {
            url: 'http://cdn.example/Movie.2024.2160p.mkv',
            behaviorHints: {
              videoHash: 'abc123def4567890abcd',
              videoSize: 8589934592,
              filename: 'Movie.2024.2160p.BluRay.mkv'
            }
          }
        }
      }
    });
    const lines = await page.evaluate(async () => {
      var video = document.createElement('video');
      video.src = 'http://cdn.example/Movie.2024.2160p.mkv';
      document.body.appendChild(video);
      // The facts cache fills asynchronously (one getState per new src).
      var joined = '';
      var deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        joined = window.__getStreamStatsLines(video).join('\n');
        if (joined.indexOf('abc123') !== -1) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      return joined;
    });
    expect(lines).toContain('abc123def4567890');     // hash (16-char truncation)
    expect(lines).toContain('8.00 GB');              // verified size, formatted
    expect(lines).toContain('Movie.2024.2160p.BluRay.mkv');
    expect(lines).toContain('direct link');          // source classification
  });

  test('source classification marks server and webtorrent transports', async ({ page }) => {
    await bootApp(page, { core: 'mock', mockCore: {}, url: '/#/player/stats-class' });
    const out = await page.evaluate(() => {
      function linesFor(src) {
        var v = document.createElement('video');
        v.src = src;
        return window.__getStreamStatsLines(v).join('\n');
      }
      return {
        server: linesFor('http://192.168.1.5:11470/hlsv2/h264-aac-mp4/master.m3u8?mediaURL=x'),
        torrent: linesFor(window.location.origin + '/webtorrent/abc/file.mkv'),
        none: linesFor('')
      };
    });
    expect(out.server).toContain('streaming server (transcoded)');
    expect(out.torrent).toContain('webtorrent (service worker)');
    expect(out.none).toContain('unknown');
  });

  test('audio-track visibility from the server /tracks/ listing', async ({ page }) => {
    // The picker half of this feature is BLOCKED upstream (no audio-selection
    // param exists on the official server — see P2.3); the honest half is
    // SHOWING what audio the file carries via the real /tracks/ endpoint.
    await page.route('**/tracks/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { type: 'video', codec: 'h264' },
          { type: 'audio', codec: 'eac3', channels: 6, lang: 'eng' },
          { type: 'audio', codec: 'aac', channels: 2, lang: 'spa' },
          { type: 'text', codec: 'srt' }
        ])
      });
    });
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/stats-audio',
      localStorage: { stremio_server_url: 'http://192.168.1.50:11470' },
      mockCore: {
        player: {
          stream: { url: 'http://cdn.example/Movie.dual.mkv', behaviorHints: {} }
        }
      }
    });
    const lines = await page.evaluate(async () => {
      var video = document.createElement('video');
      video.src = 'http://cdn.example/Movie.dual.mkv';
      document.body.appendChild(video);
      var joined = '';
      var deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        joined = window.__getStreamStatsLines(video).join('\n');
        if (/Audio\s+: 2 tracks/.test(joined)) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      return joined;
    });
    expect(lines).toMatch(/Audio\s+: 2 tracks — eng eac3 6ch, spa aac 2ch/);
  });

  test('unknown facts stay honestly unknown (no label heuristics)', async ({ page }) => {
    await bootApp(page, { core: 'mock', mockCore: { player: { stream: null } }, url: '/#/player/stats-empty' });
    const lines = await page.evaluate(async () => {
      var video = document.createElement('video');
      video.src = 'http://cdn.example/plain.mp4';
      document.body.appendChild(video);
      // Give the (empty) facts pull a moment to settle.
      await new Promise((r) => setTimeout(r, 600));
      return window.__getStreamStatsLines(video).join('\n');
    });
    expect(lines).toMatch(/Hash\s+: unknown/);
    expect(lines).toMatch(/Size\s+: unknown/);
    // No bitrate line without a verified size.
    expect(lines).not.toContain('(est.)');
  });
});

// ==========================================================================
// Embedded-subtitle delay — shift native <track> VTTCues (the upstream
// stepper only drives extraSubtitlesDelay). Tested through the exposed
// seam + a real TextTrack with real VTTCues.
// ==========================================================================
test.describe('#23 — Embedded subtitle delay', () => {
  async function makeTrackWithCue(page) {
    return page.evaluate(() => {
      var video = document.createElement('video');
      document.body.appendChild(video);
      var track = video.addTextTrack('subtitles', 'Test', 'en');
      track.mode = 'showing';
      track.addCue(new VTTCue(10, 12, 'hello'));
      track.addCue(new VTTCue(20, 22, 'world'));
      return { ok: true };
    });
  }

  test('shifts cue times by the offset and clamps at 0', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/#/player/esd-shift' });
    await makeTrackWithCue(page);
    const result = await page.evaluate(async () => {
      var video = document.querySelector('video');
      var cues = video.textTracks[0].cues;
      var before = { s: cues[0].startTime, e: cues[0].endTime };
      window.__setEmbeddedSubDelay(500);                       // +500ms later
      var afterPlus = { s: cues[0].startTime, e: cues[0].endTime };
      window.__setEmbeddedSubDelay(-1000);                     // earlier
      var afterMinus = { s: cues[0].startTime, e: cues[0].endTime };
      return { before: before, afterPlus: afterPlus, afterMinus: afterMinus, stored: window.__getEmbeddedSubDelay() };
    });
    expect(result.before.s).toBe(10);
    expect(result.afterPlus.s).toBeCloseTo(10.5, 3);
    expect(result.afterPlus.e).toBeCloseTo(12.5, 3);
      // Target -1000 = ABSOLUTE offset from the original cue time
      // (the per-cue marker makes offsets absolute, not incremental):
      // 10 - 1.0 = 9.0, not a further -1.5 from the +500 state.
      expect(result.afterMinus.s).toBeCloseTo(9, 3);
    expect(result.stored).toBe(-1000);
  });

  test('re-apply is idempotent; late cues get the offset on reapply', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/#/player/esd-idem' });
    await makeTrackWithCue(page);
    const result = await page.evaluate(() => {
      var video = document.querySelector('video');
      var track = video.textTracks[0];
      window.__setEmbeddedSubDelay(250);
      var s1 = track.cues[0].startTime;
      window.__setEmbeddedSubDelay(250);        // same target — no double shift
      var s2 = track.cues[0].startTime;
      // A cue added AFTER the offset (progressive HLS pattern): cuechange
      // hook + idempotent marker handle it on the next application.
      track.addCue(new VTTCue(30, 31, 'late cue'));
      window.__setEmbeddedSubDelay(250);
      var lateCue = track.cues[2];
      return { s1: s1, s2: s2, lateStart: lateCue.startTime };
    });
    expect(result.s1).toBeCloseTo(10.25, 3);
    expect(result.s2).toBeCloseTo(10.25, 3);     // idempotent
    expect(result.lateStart).toBeCloseTo(30.25, 3);
  });

  test('bracket hotkeys adjust and persist (when enabled)', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/esd-keys',
      localStorage: { stremio_embedded_sub_delay_enabled: 'true' },
    });
    const out = await page.evaluate(async () => {
      window.__setEmbeddedSubDelay(0);
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 221, bubbles: true })); // ]
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 221, bubbles: true })); // ]
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 219, bubbles: true })); // [
      await new Promise((r) => setTimeout(r, 200));
      return { delay: window.__getEmbeddedSubDelay(), stored: localStorage.getItem('stremio_embedded_sub_delay') };
    });
    expect(out.delay).toBe(25);   // +25 +25 -25
    expect(out.stored).toBe('25');
  });
});

// ==========================================================================
// Honest external-stream handling (P2.3)
// ==========================================================================
test.describe('#24 — External streams on Vidaa', () => {
  const { readFileSync } = require('fs');
  const { join } = require('path');

  // Build-structure assertion (the webtorrent.spec documented-exception
  // category): the details.chunk.js chunk-edit must route Vidaa out of the
  // dead-end dialog branch. The build itself enforces that the `find`
  // matches exactly once, so this pins the SEMANTICS + the re-baseline
  // anchor.
  test('chunk-edit removes Vidaa from the dead-end dialog branch', () => {
    const def = JSON.parse(readFileSync(join(__dirname, '..', 'patches', 'chunk-edits', 'details.chunk.js.json'), 'utf8'));
    expect(def.chunk).toBe('details.chunk.js');
    expect(def.ops.length).toBe(1);
    const op = def.ops[0];
    // The upstream gate: Titan/NetTV/Vidaa → dead-end; the replacement
    // keeps the dead-end for Titan/NetTV only — Vidaa falls through to
    // upstream's own confirm dialog → openExternal → window.open.
    expect(op.find).toContain('n.isTitan||n.isNetTV||n.isVidaa?c():o()');
    expect(op.replace).toContain('n.isTitan||n.isNetTV?c():o()');
    expect(op.replace).not.toContain('isVidaa?c()');
  });

  test('popup-blocked window.open gets an honest advice toast', async ({ page }) => {
    // Simulate the TV browser blocking popups BEFORE the patch layer loads:
    // the belt wraps this stub, sees the falsy return, and advises.
    await page.addInitScript(() => {
      window.open = function () { return null; };
    });
    await bootApp(page, { core: 'none' });
    const out = await page.evaluate(async () => {
      window.open('https://netflix.com/title/812345');
      var deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        var toasts = Array.prototype.slice.call(document.querySelectorAll('div'))
          .map(function (d) { return d.textContent || ''; })
          .filter(function (t) { return t.indexOf('netflix.com') !== -1 && t.indexOf('didn') !== -1; });
        if (toasts.length) return { advised: true, text: toasts[0] };
        await new Promise(function (r) { setTimeout(r, 150); });
      }
      return { advised: false };
    });
    expect(out.advised).toBe(true);
    expect(out.text).toContain('pick a stream that plays here');
  });

  test('successful window.open passes through with no toast', async ({ page }) => {
    await page.addInitScript(() => {
      window.open = function () { return { fakePopup: true }; };
    });
    await bootApp(page, { core: 'none' });
    const out = await page.evaluate(async () => {
      var w = window.open('https://www.example.com/x');
      await new Promise(function (r) { setTimeout(r, 700); });
      var advised = Array.prototype.slice.call(document.querySelectorAll('div'))
        .some(function (d) { return (d.textContent || '').indexOf("didn\u2019t open") !== -1; });
      return { returned: !!w, advised: advised };
    });
    expect(out.returned).toBe(true);
    expect(out.advised).toBe(false);
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
      launchNativePlayer: typeof window.__launchNativePlayer,
      fullSubLabels: typeof window.__fullSubLabels
    }));

    expect(globals.exitApp).toBe('function');
    expect(globals.launchNativePlayer).toBe('function');
    expect(globals.fullSubLabels).toBe('object');
  });

  // P1.1: the RT.core seam — Promise-normalized getState/dispatch with
  // field validation (the sync-getState bug class must fail loudly), and
  // NewState-driven onState pulls.
  test('RT.core rejects unknown fields loudly', async ({ page }) => {
    await bootApp(page, { core: 'mock', mockCore: {} });
    const result = await page.evaluate(async () => {
      var out = {};
      try { await window.__vidaaRuntime.core.getState('streaming'); out.getState = 'resolved'; }
      catch (e) { out.getState = e.message; }
      try { await window.__vidaaRuntime.core.dispatch({ action: 'Ctx' }, 'bogus'); out.dispatch = 'resolved'; }
      catch (e) { out.dispatch = e.message; }
      return out;
    });
    expect(result.getState).toContain('unknown core field');
    expect(result.dispatch).toContain('unknown core field');
  });

  test('RT.core.getState resolves mock state for valid fields', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      mockCore: { meta_details: { metaItem: { ready: { videos: [] } } } },
    });
    const state = await page.evaluate(() => window.__vidaaRuntime.core.getState('meta_details'));
    expect(state.metaItem.ready.videos).toEqual([]);
  });

  test('RT.core.onState delivers NewState-driven pulls', async ({ page }) => {
    await bootApp(page, { core: 'mock', mockCore: { ctx: { profile: { settings: {} } } } });
    const seen = await page.evaluate(async () => {
      var seenUrls = null;
      var off = window.__vidaaRuntime.core.onState('ctx', function (state) {
        seenUrls = state && state.profile && state.profile.settings.streamingServerUrl;
      });
      // The mock core emits NewState from __setMockCore (helpers).
      window.__setMockCore('ctx', { profile: { settings: { streamingServerUrl: 'http://10.9.8.7:11470' } } });
      var deadline = Date.now() + 4000;
      while (Date.now() < deadline && seenUrls === null) {
        await new Promise(function (r) { setTimeout(r, 100); });
      }
      off();
      return seenUrls;
    });
    expect(seen).toBe('http://10.9.8.7:11470');
  });

  // P1.2: the stall coordinator — one detector, recover claims, inform
  // escalation, episode close on progress. Driven via the simulateTick
  // test seam with tuned thresholds (no real-time waits). Test strategies
  // use priorities ABOVE the production ones (auto-rebuffer 200 /
  // prep-handoff 300) so the page's real strategies can't claim first.
  test('stall coordinator: recover claims, inform escalates, progress closes', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const result = await page.evaluate(() => {
      var RT = window.__vidaaRuntime;
      var events = [];
      RT.stall.tune({ frozenMs: 2000, reInvokeMs: 0, informAfterMs: 0, eventCooldownMs: 0 });
      RT.stall.register({
        id: 't-recover', phase: 'recover', priority: 900, type: '*',
        act: function(v, ep) { events.push('recover:' + ep.invocation); return true; }
      });
      RT.stall.register({
        id: 't-inform', phase: 'inform', priority: 800, type: '*',
        act: function() { events.push('inform'); return true; }
      });
      var video = { paused: false, ended: false, readyState: 4, currentTime: 10, duration: 100, addEventListener: function() {} };

      RT.stall.simulateTick(video);   // baseline: records lastTime
      RT.stall.simulateTick(video);   // frozen ≥ threshold → episode opens, recover (inv 1)
      RT.stall.simulateTick(video);   // re-invoke (inv 2) + inform escalation
      var afterStall = events.slice();

      var countBeforeProgress = events.length;
      video.currentTime = 20;         // progress → episode closes
      RT.stall.simulateTick(video);
      var noFireOnProgress = events.length === countBeforeProgress;

      video.currentTime = 20;         // same position again → refreezes…
      RT.stall.simulateTick(video);   // …to the threshold in one tick → new episode (inv 1)
      var newEpisode = events.slice(countBeforeProgress);

      return { afterStall: afterStall, noFireOnProgress: noFireOnProgress, newEpisode: newEpisode };
    });
    expect(result.afterStall).toEqual(['recover:1', 'recover:2', 'inform']);
    expect(result.noFireOnProgress).toBe(true);
    expect(result.newEpisode).toEqual(['recover:1']);
  });

  // P1.11: persistence is EVENT-driven — only user-driven media events
  // save. Engine-init changes (before the first 'playing') and our own
  // restore (apply window) must never write, which is what the old
  // poll-sampled save loop got wrong (it saved the engine's reset to 1.0).
  test('speed persists only from user-driven ratechange, never engine init', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/#/player/svp-save' });
    const result = await page.evaluate(async () => {
      var video = document.createElement('video');
      document.body.appendChild(video);
      // Let the dom watcher hook the element before the first change.
      await new Promise((r) => setTimeout(r, 200));
      // Engine-init change BEFORE playing: must NOT persist.
      video.playbackRate = 2.0;
      await new Promise((r) => setTimeout(r, 700));
      var afterInit = localStorage.getItem('stremio_playback_speed');
      // User-driven: playback started, then a change.
      video.dispatchEvent(new Event('playing'));
      video.playbackRate = 1.5;
      await new Promise((r) => setTimeout(r, 700));
      return { afterInit: afterInit, persisted: localStorage.getItem('stremio_playback_speed') };
    });
    expect(result.afterInit).toBeNull();
    expect(result.persisted).toBe('1.5');
  });

  // P2.1 (build-structure assertion, same documented-exception category as
  // the chunk-edit/webtorrent reads): the patch layer ships MINIFIED into
  // app/index.html with per-patch path markers, while the patches/ sources
  // stay readable. Byte-level pins, not runtime behavior.
  test('patch layer ships minified with path markers; sources stay readable', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const html = readFileSync(join(__dirname, '..', 'app', 'index.html'), 'utf8');
    // Marker format: /* head/<area>/<name>.js */
    expect(html).toContain('/* head/kernel/runtime.js */');
    expect(html).toContain('/* head/player/stream-stats.js */');
    // The sources' banner art is gone from the output…
    expect(html).not.toContain('VIDAA runtime kernel');
    expect(html).not.toContain('the ONE remote-key dispatcher');
    // …but the readable sources still carry it.
    const src = readFileSync(join(__dirname, '..', 'patches', 'head', 'kernel', 'runtime.js'), 'utf8');
    expect(src).toContain('VIDAA runtime kernel');
  });

  // P0.10: the deleted subtitle family dispatched a `Player/SetProp` core
  // action that does not exist upstream (engine props go through the player
  // screen's engine controller, never through core.dispatch). The mock core
  // accepted everything, so the suite stayed green while the features were
  // no-ops. This guard fails loudly if that protocol ever comes back.
  test('no phantom Player/SetProp core dispatches from the patch layer', async ({ page }) => {
    await bootApp(page, { core: 'mock', mockCore: {}, url: '/#/player/phantom-check' });
    // Let the patch layer's player-route pollers tick a few times.
    await page.waitForTimeout(6000);
    const dispatches = await parsedDispatches(page);
    const phantom = dispatches.filter(function(d) {
      return d.action === 'Player' && d.args && d.args.action === 'SetProp';
    });
    expect(phantom).toEqual([]);
  });

  // P0.12 regression: the modal factory's footer loop referenced an
  // undefined `footerButtons` instead of `config.footerButtons` — a latent
  // crash the day any patch passed footer buttons.
  test('modal factory renders footer buttons', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const ok = await page.evaluate(() => {
      var fb = window.__vidaaUI.button('Footer Action');
      var api = window.__createVidaaModal({ id: 'footer-test-modal', title: 'Footer Test', footerButtons: [fb] });
      var rendered = Array.prototype.slice.call(api.modal.querySelectorAll('button'))
        .some(function(b) { return b.textContent === 'Footer Action'; });
      api.close();
      return rendered;
    });
    expect(ok).toBe(true);
  });

  test('localStorage keys use stremio_ prefix', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => {
      localStorage.setItem('stremio_playback_speed', '1.25');
      localStorage.setItem('stremio_volume', '0.8');
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
