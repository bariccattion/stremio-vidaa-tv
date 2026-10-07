// @ts-check
// Tests for the Server URL manager (patch 043): configure the streaming
// server from Settings instead of the ?server= launch param.
//
// Hard rules under test:
//   • Save & Test persists the URL (localStorage + __STREMIO_SERVER_URL__) so
//     future sessions auto-reconnect, and pings it with a timeout
//   • Auto-Detect is STRICTLY manual (no timers, no startup scan) and sweeps
//     the configured subnet first, then common home-router defaults
//   • The overlay is corner-anchored, dismissible (Close + Back key), and
//     never fullscreen — it never traps the remote
const { test, expect } = require('@playwright/test');

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

test.describe('Server URL manager (patch 043)', () => {
  test('exposes __showServerUrlManager and __autoDetectStremioServer', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const types = await page.evaluate(() => ({
      show: typeof window.__showServerUrlManager,
      detect: typeof window.__autoDetectStremioServer,
    }));
    expect(types.show).toBe('function');
    expect(types.detect).toBe('function');
  });

  test('overlay is non-fullscreen, has a URL input + actions, and is dismissible', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      window.__showServerUrlManager();
      var el = document.getElementById('dv-server-url-manager');
      if (!el) return { present: false };
      var isFullscreen = (el.offsetWidth >= window.innerWidth - 2) && (el.offsetHeight >= window.innerHeight - 2);
      var hasInput = !!el.querySelector('input');
      var labels = Array.prototype.map.call(el.querySelectorAll('button'), function (b) { return (b.textContent || '').trim(); });
      var close = Array.prototype.find.call(el.querySelectorAll('button'), function (b) { return /close/i.test(b.textContent || ''); });
      if (close) close.click();
      await new Promise((r) => setTimeout(r, 50));
      return { present: true, isFullscreen: isFullscreen, hasInput: hasInput, labels: labels, dismissed: !document.getElementById('dv-server-url-manager') };
    });
    expect(result.present).toBe(true);
    expect(result.isFullscreen).toBe(false);
    expect(result.hasInput).toBe(true);
    expect(result.dismissed).toBe(true);
    const joined = result.labels.join(' | ');
    expect(/save/i.test(joined)).toBe(true);
    expect(/auto-detect/i.test(joined)).toBe(true);
    expect(/reset/i.test(joined)).toBe(true);
    expect(/close/i.test(joined)).toBe(true);
  });

  test('Back key (Escape) closes the overlay', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const dismissed = await page.evaluate(() => {
      window.__showServerUrlManager();
      var el = document.getElementById('dv-server-url-manager');
      el.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 27, bubbles: true }));
      return !document.getElementById('dv-server-url-manager');
    });
    expect(dismissed).toBe(true);
  });

  test('Backspace while typing in the input does NOT close the overlay', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const stillOpen = await page.evaluate(() => {
      window.__showServerUrlManager();
      var el = document.getElementById('dv-server-url-manager');
      var input = el.querySelector('input');
      input.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 8, bubbles: true, cancelable: true }));
      return !!document.getElementById('dv-server-url-manager');
    });
    expect(stillOpen).toBe(true);
  });

  test('input pre-fills with the configured (non-default) server URL', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const value = await page.evaluate(() => {
      window.core = { getState: function () { return Promise.resolve(null); }, dispatch: function () { return Promise.resolve(); } };
      window.__setStremioServerUrl('http://192.168.9.9:11470');
      window.__showServerUrlManager();
      return document.querySelector('#dv-server-url-manager input').value;
    });
    expect(value).toBe('http://192.168.9.9:11470');
  });

  test('Save & Test with a reachable server: shows Connected and persists the URL', async ({ page }) => {
    await mockServer(page, /helper\.test/);
    await page.goto('/');
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      window.core = { getState: function () { return Promise.resolve(null); }, dispatch: function () { return Promise.resolve(); } };
      window.__showServerUrlManager();
      var el = document.getElementById('dv-server-url-manager');
      el.querySelector('input').value = 'http://helper.test:11470';
      var save = Array.prototype.find.call(el.querySelectorAll('button'), function (b) { return /save/i.test(b.textContent || ''); });
      save.click();
      await new Promise((r) => setTimeout(r, 1500));
      return {
        status: document.getElementById('dv-server-url-status').textContent,
        ls: localStorage.getItem('stremio_server_url'),
        global: window.__STREMIO_SERVER_URL__,
      };
    });
    expect(result.status).toMatch(/connected/i);
    expect(result.ls).toBe('http://helper.test:11470');
    expect(result.global).toBe('http://helper.test:11470');
  });

  test('Save & Test with an unreachable server: honest failure, URL still saved', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      window.core = { getState: function () { return Promise.resolve(null); }, dispatch: function () { return Promise.resolve(); } };
      window.__showServerUrlManager();
      var el = document.getElementById('dv-server-url-manager');
      el.querySelector('input').value = 'http://10.255.255.1:11470'; // non-routable → probe times out
      var save = Array.prototype.find.call(el.querySelectorAll('button'), function (b) { return /save/i.test(b.textContent || ''); });
      save.click();
      await new Promise((r) => setTimeout(r, 4000)); // TEST_TIMEOUT_MS = 3000
      return {
        status: document.getElementById('dv-server-url-status').textContent,
        ls: localStorage.getItem('stremio_server_url'),
      };
    });
    expect(result.status).toMatch(/not reachable|timed out/i);
    expect(result.ls).toBe('http://10.255.255.1:11470');
  });

  test('Save & Test with an empty input shows guidance and changes nothing', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      localStorage.removeItem('stremio_server_url');
      window.__STREMIO_SERVER_URL__ = 'http://127.0.0.1:11470';
      window.__showServerUrlManager();
      var el = document.getElementById('dv-server-url-manager');
      var save = Array.prototype.find.call(el.querySelectorAll('button'), function (b) { return /save/i.test(b.textContent || ''); });
      save.click();
      await new Promise((r) => setTimeout(r, 200));
      return {
        status: document.getElementById('dv-server-url-status').textContent,
        ls: localStorage.getItem('stremio_server_url'),
      };
    });
    expect(result.status).toMatch(/type the server address|auto-detect/i);
    expect(result.ls).toBeNull();
  });

  test('Reset to Default restores the built-in sentinel and clears the input', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      window.core = { getState: function () { return Promise.resolve(null); }, dispatch: function () { return Promise.resolve(); } };
      window.__setStremioServerUrl('http://192.168.9.9:11470');
      window.__showServerUrlManager();
      var el = document.getElementById('dv-server-url-manager');
      var reset = Array.prototype.find.call(el.querySelectorAll('button'), function (b) { return /reset/i.test(b.textContent || ''); });
      reset.click();
      await new Promise((r) => setTimeout(r, 200));
      return {
        ls: localStorage.getItem('stremio_server_url'),
        global: window.__STREMIO_SERVER_URL__,
        inputValue: el.querySelector('input').value,
      };
    });
    expect(result.ls).toBe('http://127.0.0.1:11470');
    expect(result.global).toBe('http://127.0.0.1:11470');
    expect(result.inputValue).toBe('');
  });

  test('__autoDetectStremioServer finds a server from extraCandidates and reports it', async ({ page }) => {
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

  test('__autoDetectStremioServer resolves null when nothing answers', async ({ page }) => {
    // Abort every probe so the sweep exhausts quickly.
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

  test('UI Auto-Detect sweeps the configured subnet first, finds and saves the server', async ({ page }) => {
    await mockServer(page, /192\.168\.1\.50/);
    await page.goto('/');
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      window.core = { getState: function () { return Promise.resolve(null); }, dispatch: function () { return Promise.resolve(); } };
      // A configured server on 192.168.1.x → its /24 is swept FIRST, so the
      // mock at 192.168.1.50 is found without touching 192.168.0.x.
      window.__setStremioServerUrl('http://192.168.1.99:11470');
      window.__showServerUrlManager();
      var el = document.getElementById('dv-server-url-manager');
      var detect = Array.prototype.find.call(el.querySelectorAll('button'), function (b) { return /auto-detect/i.test(b.textContent || ''); });
      detect.click();
      var start = Date.now();
      var statusEl = document.getElementById('dv-server-url-status');
      while (Date.now() - start < 20000) {
        if (/found/i.test(statusEl.textContent || '')) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      return {
        status: statusEl.textContent,
        ls: localStorage.getItem('stremio_server_url'),
        inputValue: el.querySelector('input').value,
      };
    });
    expect(result.status).toMatch(/found/i);
    expect(result.ls).toBe('http://192.168.1.50:11470');
    expect(result.inputValue).toBe('http://192.168.1.50:11470');
  });

  test('UI Auto-Detect is manual-only: pressing again stops the scan', async ({ page }) => {
    await page.route(/heartbeat|\/settings/, (route) => route.abort());
    await page.goto('/');
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      window.__showServerUrlManager();
      var el = document.getElementById('dv-server-url-manager');
      var detect = Array.prototype.find.call(el.querySelectorAll('button'), function (b) { return /auto-detect/i.test(b.textContent || ''); });
      detect.click(); // start
      var scanning = /stop/i.test(detect.textContent || '');
      detect.click(); // stop
      await new Promise((r) => setTimeout(r, 300));
      return {
        scanning: scanning,
        status: document.getElementById('dv-server-url-status').textContent,
        buttonLabel: detect.textContent,
        ls: localStorage.getItem('stremio_server_url'),
      };
    });
    expect(result.scanning).toBe(true);
    expect(result.status).toMatch(/stopped/i);
    expect(result.buttonLabel).toMatch(/auto-detect/i);
    expect(result.ls).toBeNull();
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
});
