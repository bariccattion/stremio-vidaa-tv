// @ts-check
// Tests for the server URL configuration (patch 043) — integrated with the
// NATIVE Settings > Server > Edit URL dialog instead of custom input UI:
//   • the dialog is a plain field (chunk edit): local value, committed once
//     on Confirm, then mirrored to localStorage by patch 006 so future
//     sessions auto-reconnect
//   • "Auto-Detect" button inside the native dialog sweeps the LAN for a
//     Stremio server on port 11470 — STRICTLY manual, never at startup
//   • Confirm pings the saved URL with a timeout and toasts the result
//   • the old custom overlay (__showServerUrlManager) is gone
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

test.setTimeout(60000);

const MOCK_SETTINGS = JSON.stringify({ values: { serverVersion: '4.20.0' } });

function mockServer(page, hostPattern) {
  // Probes to hostPattern answer like a real Stremio server; everything else
  // (the 700+ other sweep candidates) fails fast instead of timing out.
  return Promise.all([
    page.route(/heartbeat/, async (route) => {
      if (hostPattern.test(route.request().url())) await route.fulfill({ status: 200, body: 'ok' });
      else await route.abort();
    }),
    page.route(/\/settings/, async (route) => {
      if (hostPattern.test(route.request().url())) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: MOCK_SETTINGS });
      } else await route.abort();
    }),
  ]);
}

test.describe('Native Edit URL dialog integration (patch 043)', () => {
  test('custom overlay is removed; dialog hooks + engine are exposed', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const types = await page.evaluate(() => ({
      overlay: typeof window.__showServerUrlManager,
      detect: typeof window.__autoDetectStremioServer,
      dialogDetect: typeof window.__serverDialogAutoDetect,
      dialogTest: typeof window.__serverDialogTest,
    }));
    expect(types.overlay).toBe('undefined');
    expect(types.detect).toBe('function');
    expect(types.dialogDetect).toBe('function');
    expect(types.dialogTest).toBe('function');
  });

  test('built settings.chunk.js wires Auto-Detect + ping into the native dialog', () => {
    const src = fs.readFileSync('app/settings.chunk.js', 'utf8');
    // Plain field: no live per-keystroke round-trip, commit once on Confirm.
    expect(src).not.toContain('onChange: w');
    expect(src).toContain('var _urlVal = t.settings().streamingServerUrl');
    expect(src).toContain('if (_finalUrl) {');
    expect(src).toContain('w(_finalUrl);');
    // Auto-Detect button inside the native dialog.
    expect(src).toContain('label: "Auto-Detect"');
    expect(src).toContain('window.__serverDialogAutoDetect()');
    // Reachability ping after Confirm.
    expect(src).toContain('window.__serverDialogTest(_finalUrl)');
    // Custom overlay entry point fully gone.
    expect(src).not.toContain('__showServerUrlManager');
    // The Vidaa TV section kept its other entries.
    expect(src).toContain('Quiet Player Mode');
    expect(src).toContain('Playback Diagnostics');
    expect(src).toContain('Exit Stremio');
  });

  test('Confirm pings the saved URL and toasts the result (reachable)', async ({ page }) => {
    await mockServer(page, /helper\.test/);
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__serverDialogTest('http://helper.test:11470'));
    // The sticky "Checking …" toast appears first; wait for the final verdict.
    const text = await page.evaluate(async () => {
      var start = Date.now();
      while (Date.now() - start < 5000) {
        var el = document.getElementById('dv-server-toast');
        var t = el ? (el.textContent || '') : '';
        if (t && !/checking/i.test(t)) return t;
        await new Promise((r) => setTimeout(r, 100));
      }
      return '';
    });
    expect(text).toMatch(/reachable/i);
    expect(text).toMatch(/4\.20\.0|v4/i);
  });

  test('Confirm pings the saved URL and toasts the result (unreachable/timeout)', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__serverDialogTest('http://10.255.255.1:11470'));
    await new Promise((r) => setTimeout(r, 4000)); // TEST_TIMEOUT_MS = 3000
    const text = await page.evaluate(() => {
      var el = document.getElementById('dv-server-toast');
      return el ? el.textContent : '';
    });
    expect(text).toMatch(/not reachable|timed out/i);
  });

  test('Auto-Detect fills the dialog field with the found server, user still confirms', async ({ page }) => {
    await mockServer(page, /127\.0\.0\.1/);
    await page.goto('/');
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      // Isolate: make our dummy the only text input on the page so the
      // best-effort fill (document.querySelector) targets it deterministically.
      Array.prototype.forEach.call(document.querySelectorAll('input'), function (i) { i.remove(); });
      var inp = document.createElement('input');
      inp.type = 'text';
      document.body.appendChild(inp);
      window.__serverDialogAutoDetect({ extraCandidates: ['127.0.0.1'] });
      var start = Date.now();
      while (Date.now() - start < 10000) {
        var el = document.getElementById('dv-server-toast');
        if (el && /found/i.test(el.textContent || '')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      var el2 = document.getElementById('dv-server-toast');
      return { filled: inp.value, toast: el2 ? el2.textContent : '' };
    });
    expect(result.filled).toBe('http://127.0.0.1:11470');
    expect(result.toast).toMatch(/found/i);
    expect(result.toast).toMatch(/confirm/i);
  });

  test('engine finds a server from extraCandidates and reports progress', async ({ page }) => {
    await mockServer(page, /127\.0\.0\.1/);
    await page.goto('/');
    await page.waitForTimeout(1500);
    const found = await page.evaluate(() => {
      return new Promise((resolve) => {
        var progressCalls = 0;
        window.__autoDetectStremioServer(
          { extraCandidates: ['127.0.0.1'] },
          function () { progressCalls++; },
          function (res) { resolve({ res: res, progressCalls: progressCalls }); }
        );
      });
    });
    expect(found.res).not.toBeNull();
    expect(found.res.url).toBe('http://127.0.0.1:11470');
    expect(found.progressCalls).toBeGreaterThan(0);
  });

  test('engine sweeps the configured /24 subnet first', async ({ page }) => {
    await mockServer(page, /192\.168\.1\.50/);
    await page.goto('/');
    await page.waitForTimeout(1500);
    const found = await page.evaluate(() => {
      window.__STREMIO_SERVER_URL__ = 'http://192.168.1.99:11470';
      return new Promise((resolve) => {
        window.__autoDetectStremioServer({}, function () {}, function (res) { resolve(res); });
      });
    });
    expect(found).not.toBeNull();
    expect(found.url).toBe('http://192.168.1.50:11470');
  });

  test('engine resolves null when nothing answers', async ({ page }) => {
    await page.route(/heartbeat|\/settings/, (route) => route.abort());
    await page.goto('/');
    await page.waitForTimeout(1500);
    const found = await page.evaluate(() => {
      return new Promise((resolve) => {
        window.__autoDetectStremioServer({ extraCandidates: [] }, function () {}, function (res) { resolve(res); });
      });
    });
    expect(found).toBeNull();
  });

  test('Auto-Detect never runs on its own: no scan network activity at startup', async ({ page }) => {
    let sweepRequests = 0;
    await page.route(/heartbeat/, async (route) => {
      const u = route.request().url();
      // Only the app's own health-check heartbeat (to the configured default)
      // is expected; LAN sweep candidates would hit 192.168.x addresses.
      if (/192\.168\./.test(u)) sweepRequests++;
      await route.abort();
    });
    await page.goto('/');
    await page.waitForTimeout(4000);
    expect(sweepRequests).toBe(0);
  });

  test('shared TextField suppresses TV-keyboard autocompletion', () => {
    const src = fs.readFileSync('app/main.js', 'utf8');
    expect(src).toContain('<input type=text autocomplete=off autocorrect=off autocapitalize=off>');
    expect(src).not.toContain('"<input type=text>";');
  });
});
