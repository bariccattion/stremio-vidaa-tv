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
    // Probe timeout (3s) + heartbeat fallback timeout (3s) + margin.
    await new Promise((r) => setTimeout(r, 7500));
    const text = await page.evaluate(() => {
      var el = document.getElementById('dv-server-toast');
      return el ? el.textContent : '';
    });
    expect(text).toMatch(/could not verify|timed out/i);
    // Calm wording: no alarming "not reachable" claim when we simply
    // couldn't verify, and the retry promise is stated.
    expect(text).toMatch(/saved and will be retried/i);
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

// ==========================================================================
// False-Offline healing + honest status surfaces
// ---------------------------------------------------------------------------
// The core checks the streaming server ONCE with no retry; one failed check
// sticks as "Offline" while the server works. Fixes under test:
//   • patch 013 heals the core (rate-limited StreamingServer/Reload) when the
//     page-level probe says online but the core has no baseUrl
//   • the SERVER settings row accepts the page-level health as online evidence
//   • the Confirm toast falls back to /heartbeat and never cries wolf
//   • patch 006 mirrors core URL changes to localStorage on every screen
// ==========================================================================
test.describe('False-Offline healing and honest status', () => {
  function installMockCore(page, initialState) {
    return page.addInitScript((state) => {
      window.__ssState = state;
      window.__ctxUrl = null;
      window.__mockDispatchLog = [];
      window.__mockCore = {
        getState: function (model) {
          if (model === 'streaming_server') {
            return Promise.resolve({ baseUrl: window.__ssState.baseUrl, selected: { transportUrl: window.__ssState.transportUrl } });
          }
          if (model === 'ctx') {
            return Promise.resolve(window.__ctxUrl ? { profile: { settings: { streamingServerUrl: window.__ctxUrl } } } : null);
          }
          return Promise.resolve(null);
        },
        dispatch: function (action) { window.__mockDispatchLog.push(JSON.stringify(action)); return Promise.resolve(); }
      };
      Object.defineProperty(window, 'core', { get: function () { return window.__mockCore; }, set: function () {}, configurable: true });
    }, initialState);
  }

  test('heal: page-healthy + core-offline triggers exactly one rate-limited Reload', async ({ page }) => {
    await page.route(/\/settings/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: MOCK_SETTINGS }));
    await installMockCore(page, { baseUrl: null, transportUrl: 'http://127.0.0.1:11470' });
    await page.goto('/');
    // Initial health check runs at 3s and heals on success.
    await page.waitForTimeout(5000);
    const first = await page.evaluate(() => (window.__mockDispatchLog || []).filter(function (e) { return e.indexOf('"Reload"') !== -1; }).length);
    expect(first).toBeGreaterThanOrEqual(1);
    // Next cycle (~13s) must be blocked by the 60s rate limit.
    await page.waitForTimeout(11000);
    const second = await page.evaluate(() => (window.__mockDispatchLog || []).filter(function (e) { return e.indexOf('"Reload"') !== -1; }).length);
    expect(second).toBe(first);
  });

  test('no heal when the core already reports online', async ({ page }) => {
    await page.route(/\/settings/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: MOCK_SETTINGS }));
    await installMockCore(page, { baseUrl: 'http://127.0.0.1:11470', transportUrl: 'http://127.0.0.1:11470' });
    await page.goto('/');
    await page.waitForTimeout(5000);
    const reloads = await page.evaluate(() => (window.__mockDispatchLog || []).filter(function (e) { return e.indexOf('"Reload"') !== -1; }).length);
    expect(reloads).toBe(0);
  });

  test('no heal when the page-level probe also fails', async ({ page }) => {
    await page.route(/heartbeat|\/settings/, (route) => route.abort());
    await installMockCore(page, { baseUrl: null, transportUrl: 'http://127.0.0.1:11470' });
    await page.goto('/');
    await page.waitForTimeout(5000);
    const reloads = await page.evaluate(() => (window.__mockDispatchLog || []).filter(function (e) { return e.indexOf('"Reload"') !== -1; }).length);
    expect(reloads).toBe(0);
  });

  test('SERVER row accepts the page-level health probe as online evidence', () => {
    const src = fs.readFileSync('app/settings.chunk.js', 'utf8');
    expect(src).toContain('f.online() || (window.__SERVER_HEALTH__');
    expect(src).toContain('window.__SERVER_HEALTH__.status === "online"');
    expect(src).toContain('MOBILE_SERVER_OFFLINE');
  });

  test('toast falls back to /heartbeat before reporting failure', async ({ page }) => {
    await page.route(/\/settings/, (route) => route.abort());
    await page.route(/heartbeat/, (route) => route.fulfill({ status: 200, body: 'ok' }));
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__serverDialogTest('http://helper.test:11470'));
    const text = await page.evaluate(async () => {
      var start = Date.now();
      while (Date.now() - start < 8000) {
        var el = document.getElementById('dv-server-toast');
        var t = el ? (el.textContent || '') : '';
        if (t && !/checking/i.test(t)) return t;
        await new Promise((r) => setTimeout(r, 100));
      }
      return '';
    });
    expect(text).toMatch(/reachable/i);
    expect(text).toMatch(/heartbeat/i);
  });

  test('mixed-content hint only for https page + http server', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const hints = await page.evaluate(() => ({
      httpsHttp: window.__mixedContentHint('https:', 'http://192.168.1.5:11470'),
      httpHttp: window.__mixedContentHint('http:', 'http://192.168.1.5:11470'),
      httpsHttps: window.__mixedContentHint('https:', 'https://192.168.1.5:11470')
    }));
    expect(hints.httpsHttp.length).toBeGreaterThan(0);
    expect(hints.httpsHttp).toMatch(/playback still works|http installer/i);
    expect(hints.httpHttp).toBe('');
    expect(hints.httpsHttps).toBe('');
  });

  test('patch 006 mirrors core URL changes to localStorage on every screen', async ({ page }) => {
    await installMockCore(page, { baseUrl: null, transportUrl: 'http://192.168.1.10:11470' });
    // Baseline URL must exist before the first effective poll (after the 10s
    // warmup); init scripts run in order, so this overrides the mock's null.
    await page.addInitScript(() => { window.__ctxUrl = 'http://192.168.1.10:11470'; });
    await page.goto('/#/library');
    await page.waitForTimeout(11000); // warmup + baseline poll
    await page.evaluate(() => { window.__ctxUrl = 'http://192.168.1.99:11470'; });
    await page.waitForTimeout(4000); // next 2s poll picks up the change
    const result = await page.evaluate(() => ({
      ls: localStorage.getItem('stremio_server_url'),
      global: window.__STREMIO_SERVER_URL__,
      reloads: (window.__mockDispatchLog || []).filter(function (e) { return e.indexOf('"Reload"') !== -1; }).length
    }));
    expect(result.ls).toBe('http://192.168.1.99:11470');
    expect(result.global).toBe('http://192.168.1.99:11470');
    expect(result.reloads).toBeGreaterThanOrEqual(1);
  });
});
