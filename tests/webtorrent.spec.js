// WebTorrent streaming pipeline (torrents/webtorrent-streaming.js + merged service worker).
// Network-free: verifies the vendored library loads, the streaming server
// attaches, and the honest-failure wiring is intact. Live-torrent behaviour
// is exercised manually (see README ▸ Direct Torrent Streaming).
//
// DOCUMENTED EXCEPTION to the zero-grep rule: the assertions reading
// patches/ sources and the app/sw.js ASSEMBLY below are structural — they
// verify our own unminified ES5 and the build's merging of vendored files,
// not runtime behavior of minified app artifacts. Everything the running
// page can answer (tracker list, stall window, the /webtorrent/ exemptions)
// is asserted through window.__* interfaces instead.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('fs');
const { join } = require('path');
const { bootApp, installFakeNative, installFakeVideoFactory } = require('./helpers');

const read = (rel) => readFileSync(join(__dirname, '..', rel), 'utf8');

test('app service worker merges the webtorrent streaming worker', () => {
  const sw = read('app/sw.js');
  // A fetch event only reaches the SW controlling the page, so webtorrent's
  // streaming worker must be importScripts'd into OUR worker — a separate
  // registration (its docs' scope './' suggestion) would displace the app shell.
  expect(sw).toContain("importScripts('./webtorrent-sw.min.js')");
  // Stream URLs (<origin>/webtorrent/...) must be carved out BEFORE any
  // respondWith — otherwise our cache logic answers (and caches) media streams.
  const guard = sw.indexOf("pathname.indexOf('/webtorrent')");
  const firstRespond = sw.indexOf('.respondWith(');
  expect(guard).toBeGreaterThan(-1);
  expect(firstRespond).toBeGreaterThan(guard);
  // Both vendored files are precached.
  expect(sw).toContain('"./webtorrent.min.js"');
  expect(sw).toContain('"./webtorrent-sw.min.js"');
});

test('vendored webtorrent loads as a classic script and exposes the v3 API', async ({ page }) => {
  await bootApp(page, { core: 'none' });
  const api = await page.evaluate(async () => {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = './webtorrent.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('webtorrent.min.js failed to load'));
      document.head.appendChild(s);
    });
    if (!window.WebTorrent || typeof window.WebTorrent !== 'function') {
      throw new Error('window.WebTorrent is not the WebTorrent class');
    }
    const reg = await navigator.serviceWorker.ready;
    const client = new window.WebTorrent();
    client.createServer({ controller: reg });
    const out = { version: window.WebTorrent.VERSION, hasServer: !!client._server };
    try { client.destroy(); } catch (e) { /* already gone */ }
    return out;
  });
  expect(api.version).toBe('3.0.21');
  expect(api.hasServer).toBeTruthy();
});

test('tracker list + stall window are exposed via __getWebTorrentStatus (interface)', async ({ page }) => {
  await bootApp(page, { core: 'none' });
  const status = await page.evaluate(() => window.__getWebTorrentStatus());
  // Browsers can only announce to wss:// — udp/http trackers are native-client
  // only and must never leak in from the upstream ngosang/trackerslist sync.
  expect(status.trackers.length).toBeGreaterThan(0);
  for (const t of status.trackers) expect(t.startsWith('wss://')).toBe(true);
  expect(status.trackers).toContain('wss://tracker.webtorrent.dev');
  // The honest-failure card fires after ~30s at 0 peers.
  expect(status.stallTimeoutMs).toBe(30000);
});

test('auto-native never hands /webtorrent/ stream URLs to the native player (behavioral)', async ({ page }) => {
  await installFakeNative(page);
  await installFakeVideoFactory(page);
  await bootApp(page, {
    core: 'mock', // keep the hash on the player route — no login redirect
    url: '/#/player/wt-exempt',
    localStorage: { stremio_auto_native_player: 'true' },
  });

  // Positive control first: with "Auto Native Player (all streams)" on, an
  // http MKV IS handed off — proving the watcher is live, so the exemption
  // below can't pass vacuously.
  await page.evaluate(() => {
    window.__makeFakeVideo({ currentSrc: 'http://cdn.example/movie.mkv', readyState: 4, src: 'http://cdn.example/movie.mkv' });
  });
  await page.waitForFunction(() => (window.__sentMessages || []).length > 0, null, { timeout: 8000 });

  // The exempt URL: SW-served /webtorrent/ streams can't be fetched by the
  // TV's native player app — handing off would just break playback.
  const out = await page.evaluate(async () => {
    const first = document.querySelector('video');
    if (first) first.remove();
    window.__sentMessages = [];
    const v = window.__makeFakeVideo({ currentSrc: location.origin + '/webtorrent/abc123/Movie.2160p.mkv', readyState: 4, src: location.origin + '/webtorrent/abc123/Movie.2160p.mkv' });
    // Two+ auto-native poller ticks (1500ms each).
    await new Promise((r) => setTimeout(r, 4500));
    return { sent: (window.__sentMessages || []).length, pauseCalls: v.__counters.pause };
  });
  expect(out.sent).toBe(0);
  expect(out.pauseCalls).toBe(0);
});

test('video-prep never warms /webtorrent/ stream URLs (behavioral)', async ({ page }) => {
  await bootApp(page, { core: 'none' });
  const calls = await page.evaluate(async () => {
    const seen = [];
    const orig = window.fetch;
    window.fetch = function (url, opts) { seen.push(String(url)); return orig.apply(this, arguments); };
    try {
      window.__warmStreamHost(location.origin + '/webtorrent/abc123/file.mkv');
      window.__warmStreamHost('http://cdn.example/movie.mp4'); // positive control
      await new Promise((r) => setTimeout(r, 100));
    } finally { window.fetch = orig; }
    return seen;
  });
  // Same-origin SW-served URLs: preconnect is pointless and a warm-up fetch
  // would double-pull the torrent head.
  expect(calls.some((u) => u.indexOf('/webtorrent/') !== -1)).toBe(false);
  // The watcher itself works (the control URL does get warmed).
  expect(calls).toContain('http://cdn.example/movie.mp4');
});

test('webtorrent-streaming patch keeps the streaming + honest-failure story (source exception)', () => {
  const patch = read('patches/head/torrents/webtorrent-streaming.js');
  expect(patch).toContain('streamTo');
  expect(patch).toContain("it isn't web-seeded");
  expect(patch).toContain('// Synced from ngosang/trackerslist');
  // The old full-file-into-RAM path and the CDN load are gone.
  expect(patch).not.toContain('videoFile.getBlobURL');
  expect(patch).not.toContain('cdn.jsdelivr.net');
});
