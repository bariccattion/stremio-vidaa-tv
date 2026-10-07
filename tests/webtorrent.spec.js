// WebTorrent streaming pipeline (patch 031 + merged service worker).
// Network-free: verifies the vendored library loads, the streaming server
// attaches, and the honest-failure wiring is intact. Live-torrent behaviour
// is exercised manually (see README ▸ Direct Torrent Streaming).
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('fs');
const { join } = require('path');

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
  await page.goto('/');
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

test('patch 031 wires streaming + trackers + honest failure story', () => {
  const patch = read('patches/head/031-webtorrent-streaming.js');
  expect(patch).toContain("'wss://tracker.webtorrent.dev'");
  expect(patch).toContain("'wss://open.ftorrent.com'");
  expect(patch).toContain('streamTo');
  expect(patch).toContain("it isn't web-seeded");
  expect(patch).toContain('PEER_STALL_TIMEOUT = 30000');
  // The old full-file-into-RAM path and the CDN load are gone.
  expect(patch).not.toContain('videoFile.getBlobURL');
  expect(patch).not.toContain('cdn.jsdelivr.net');
});

test('TRACKERS array is synced: provenance stamp, wss-only entries', () => {
  const patch = read('patches/head/031-webtorrent-streaming.js');
  expect(patch).toContain('// Synced from ngosang/trackerslist');
  const block = patch.match(/var TRACKERS = \[([\s\S]*?)\];/);
  expect(block).toBeTruthy();
  const entries = block[1].split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  expect(entries.length).toBeGreaterThan(0);
  // Browsers can only announce to wss:// — udp/http trackers are native-client
  // only and must never leak in from the upstream list.
  for (const t of entries) expect(t.startsWith('wss://')).toBe(true);
});

test('companion patches exempt /webtorrent/ stream URLs', () => {
  // 038: handing a SW-served URL to the TV's native player app would break
  // playback (the native app isn't controlled by the service worker).
  expect(read('patches/head/038-auto-native-player.js')).toContain("indexOf('/webtorrent/') !== -1");
  // 036: preconnect/warm-up fetch is pointless same-origin and would
  // double-pull the torrent head.
  expect(read('patches/head/036-video-element-prep.js')).toContain("indexOf('/webtorrent/') !== -1");
});
