// @ts-check
// Tests for the server URL configuration (settings/server-url-manager.js) — integrated
// NATIVE Settings > Server > Edit URL dialog instead of custom input UI:
//   • the dialog is a plain field (chunk edit): local value, committed once
//     on Confirm, then mirrored to localStorage by the serverUrl module (001) so future
//     sessions auto-reconnect
//   • "Auto-Detect" button inside the native dialog sweeps the LAN for a
//     Stremio server on port 11470 — STRICTLY manual, never at startup
//   • Confirm pings the saved URL with a timeout and toasts the result
//   • the old custom overlay (__showServerUrlManager) is gone
//
// Seam: bootApp() waits on the kernel boot signal (window.__VIDAA_CORE_READY__).
// The settings-screen wiring is asserted at the SEAM INTERFACE —
// window.__vidaaSettingsRows — not by rendering the screen: Theater (1.9.2 and 1.10.0)
// forces a login for anonymous profiles (every #/settings navigation redirects
// to #/login), and the app holds its own core reference from boot, so neither
// a window.core mock nor a post-boot proxy can drive the real settings UI.
// Residuals covered by the build instead of specs: the chunk edits' presence
// and exact-once application (scripts/build.mjs fails otherwise).
const { test, expect } = require('@playwright/test');
const {
  bootApp, installServerMock, installMockCore, waitForServerToast,
} = require('./helpers');

test.setTimeout(60000);

const reloadCount = (page) =>
  page.evaluate(() => (window.__mockDispatchLog || []).filter((e) => e.indexOf('"Reload"') !== -1).length);

test.describe('Native Edit URL dialog integration (settings/server-url-manager.js)', () => {
  test('custom overlay is removed; dialog hooks + engine are exposed', async ({ page }) => {
    await bootApp(page, { core: 'none' });
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

  test('settings rows: the Vidaa TV section content is served by the patch layer (interface)', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const rows = await page.evaluate(() => {
      const g = { animations: () => true, setAnimations: () => {} };
      const p = { name: 'Web' };
      return window.__vidaaSettingsRows(g, p).map((row) => ({
        label: typeof row.label === 'function' ? row.label() : row.label,
        hasDirectOnClick: typeof row.onClick === 'function',
        options: (row.options || []).map((o) => ({
          hasChecked: typeof o.checked === 'function',
          hasSelected: typeof o.selected === 'function',
          hasOnClick: typeof o.onClick === 'function',
        })),
      }));
    });
    const labels = rows.map((r) => r.label);
    // The thin chunk seam delegates the whole section to
    // window.__vidaaSettingsRows(g, p); its content comes from the
    // settingsStore registry plus the settings/settings-ui.js specials.
    expect(labels).toContain('Quiet Player Mode');
    expect(labels).toContain('Auto Native Player for MKV');
    expect(labels).toContain('Auto Native Player (all streams)');
    expect(labels.some((l) => /^Audio Offset/.test(String(l)))).toBe(true);
    expect(labels).toContain('Playback Diagnostics');
    expect(labels).toContain('Exit Stremio');
    // Shape contract for the SolidJS settings renderer: every row is
    // interactive — a direct onClick (action rows) or options carrying
    // checked/selected + onClick callables (toggles/choices). A malformed row
    // is what would crash the native Settings screen.
    for (const row of rows) {
      expect(row.hasDirectOnClick || row.options.length > 0).toBe(true);
      for (const o of row.options) {
        expect(o.hasChecked || o.hasSelected).toBe(true);
        expect(o.hasOnClick).toBe(true);
      }
    }
  });

  test('Confirm pings the saved URL and toasts the result (reachable)', async ({ page }) => {
    await installServerMock(page, { hostPattern: /helper\.test/ });
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => window.__serverDialogTest('http://helper.test:11470'));
    const text = await waitForServerToast(page);
    expect(text).toMatch(/reachable/i);
    expect(text).toMatch(/4\.20\.0|v4/i);
  });

  test('Confirm pings the saved URL and toasts the result (unreachable/timeout)', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => window.__serverDialogTest('http://10.255.255.1:11470'));
    // Probe timeout (3s) + heartbeat fallback timeout (3s); the waiter polls
    // for the final verdict instead of sleeping a fixed margin.
    const text = await waitForServerToast(page);
    expect(text).toMatch(/could not verify|timed out/i);
    // Calm wording: no alarming "not reachable" claim when we simply
    // couldn't verify, and the retry promise is stated.
    expect(text).toMatch(/saved and will be retried/i);
  });

  test('Auto-Detect fills the dialog field with the found server, user still confirms', async ({ page }) => {
    await installServerMock(page, { hostPattern: /127\.0\.0\.1/ });
    await bootApp(page, { core: 'none' });
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
    await installServerMock(page, { hostPattern: /127\.0\.0\.1/ });
    await bootApp(page, { core: 'none' });
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
    await installServerMock(page, { hostPattern: /192\.168\.1\.50/ });
    await bootApp(page, { core: 'none' });
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
    const mock = await installServerMock(page, {});
    mock.setServerUp(false);
    await bootApp(page, { core: 'none' });
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
    await bootApp(page, { core: 'none' });
    // Observation window: past the 3s initial health check — the only traffic
    // that should exist. A startup sweep would be immediate and continuous.
    await page.waitForTimeout(4000);
    expect(sweepRequests).toBe(0);
  });
});

// ==========================================================================
// False-Offline healing + honest status surfaces
// ---------------------------------------------------------------------------
// The core checks the streaming server ONCE with no retry; one failed check
// sticks as "Offline" while the server works. Fixes under test:
//   • the serverUrl module heals the core (rate-limited StreamingServer/Reload) when the
//     page-level probe says online but the core has no baseUrl
//   • the SERVER settings row accepts the page-level health as online evidence
//   • the Confirm toast falls back to /heartbeat and never cries wolf
//   • the serverUrl module mirrors core URL changes to localStorage on every screen
// ==========================================================================
test.describe('False-Offline healing and honest status', () => {
  test('heal: page-healthy + core-offline triggers exactly one rate-limited Reload', async ({ page }) => {
    await installServerMock(page, { hostPattern: /127\.0\.0\.1/ });
    await bootApp(page, {
      core: 'mock',
      mockCore: { streaming_server: { baseUrl: null, selected: { transportUrl: 'http://127.0.0.1:11470' } } },
    });
    // Initial health check runs at 3s and heals on success.
    await expect.poll(() => reloadCount(page), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
    const first = await reloadCount(page);
    // The next cycle (~13s) must be blocked by the 60s rate limit. This is a
    // negative-continuity window: the timer IS the behavior under test.
    await page.waitForTimeout(11000);
    expect(await reloadCount(page)).toBe(first);
  });

  test('no heal when the core already reports online', async ({ page }) => {
    await installServerMock(page, { hostPattern: /127\.0\.0\.1/ });
    await bootApp(page, {
      core: 'mock',
      mockCore: { streaming_server: { baseUrl: 'http://127.0.0.1:11470', selected: { transportUrl: 'http://127.0.0.1:11470' } } },
    });
    // Past the 3s initial health check — the only heal trigger.
    await page.waitForTimeout(5000);
    expect(await reloadCount(page)).toBe(0);
  });

  test('no heal when the page-level probe also fails', async ({ page }) => {
    const mock = await installServerMock(page, {});
    mock.setServerUp(false);
    await bootApp(page, {
      core: 'mock',
      mockCore: { streaming_server: { baseUrl: null, selected: { transportUrl: 'http://127.0.0.1:11470' } } },
    });
    // The failure path cannot heal (heal fires only on a successful probe);
    // the window just needs to span the 3s initial check.
    await page.waitForTimeout(5000);
    expect(await reloadCount(page)).toBe(0);
  });

  // The SERVER row's page-health evidence (f.online() ||
  // __SERVER_HEALTH__.status === "online") cannot be asserted by rendering
  // the settings screen — Theater (1.9.2 and 1.10.0) walls it behind a mandatory login
  // (see the file header). Its behavioral halves are covered here: the heal
  // tests prove the page-level probe flips online exactly when the core's
  // one-shot check would have stuck Offline; the chunk edit itself is
  // build-guaranteed (exact-once find/replace).

  test('toast falls back to /heartbeat before reporting failure', async ({ page }) => {
    const mock = await installServerMock(page, {});
    mock.setServerUp(false); // /settings aborted…
    // …but /heartbeat answers (a later route registration wins).
    await page.route(/heartbeat/, (route) => route.fulfill({ status: 200, body: 'ok' }));
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => window.__serverDialogTest('http://helper.test:11470'));
    const text = await waitForServerToast(page);
    expect(text).toMatch(/reachable/i);
    expect(text).toMatch(/heartbeat/i);
  });

  test('mixed-content hint only for https page + http server', async ({ page }) => {
    await bootApp(page, { core: 'none' });
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

  test('the serverUrl module mirrors core URL changes to localStorage on every screen', async ({ page }) => {
    await bootApp(page, {
      core: 'mock',
      url: '/#/library',
      mockCore: {
        streaming_server: { baseUrl: null, selected: { transportUrl: 'http://192.168.1.10:11470' } },
        // Baseline URL exists from the start: the mirror's first poll (the
        // bootPush settles instantly — nothing configured to push) records it
        // as lastKnownUrl before we flip the core to a new URL.
        ctx: { profile: { settings: { streamingServerUrl: 'http://192.168.1.10:11470' } } },
      },
    });
    // Let the 2s mirror poll capture its baseline, then change the core's URL.
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__setMockCore('ctx',
      { profile: { settings: { streamingServerUrl: 'http://192.168.1.99:11470' } } }));
    await expect.poll(
      () => page.evaluate(() => localStorage.getItem('stremio_server_url')),
      { timeout: 6000 }
    ).toBe('http://192.168.1.99:11470');
    const result = await page.evaluate(() => ({
      global: window.__STREMIO_SERVER_URL__,
      reloads: (window.__mockDispatchLog || []).filter(function (e) { return e.indexOf('"Reload"') !== -1; }).length
    }));
    expect(result.global).toBe('http://192.168.1.99:11470');
    expect(result.reloads).toBeGreaterThanOrEqual(1);
  });
});
