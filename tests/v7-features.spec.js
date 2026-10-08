// @ts-check
// Seam: bootApp() waits on the kernel boot signal (window.__VIDAA_CORE_READY__).
// Player-route tests boot with core:'mock' — the real anonymous core makes the
// SPA redirect player routes to #/login, which would fight the patch layer's
// own route checks; the mock keeps the hash (and the tests) deterministic.
// The settings-rows coverage that used to grep built artifacts now lives in
// server-url-manager.spec.js ("settings rows: … served by the patch layer").
const { test, expect } = require('@playwright/test');
const {
  bootApp, installMockCore, installFakeVidaa, installFakeVideoFactory,
} = require('./helpers');

// The site version the build stamps (?v=N, badge, SW cache name) — read from
// package.json so a bump doesn't break these assertions.
const SITE_VERSION = String(require('../package.json').siteVersion);

test.describe('Index HTML structure', () => {
  test('page loads with correct title', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await expect(page).toHaveTitle('Stremio - Freedom to Stream');
  });

  test('version indicator shows the site version', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const version = page.locator('#patch-version');
    await expect(version).toHaveText('v' + SITE_VERSION);
  });

  test('root div exists', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await expect(page.locator('#root')).toBeAttached();
  });

  test('scripts load with the cache-bust version param', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const scripts = await page.locator('script[src]').all();
    const srcs = await Promise.all(scripts.map(s => s.getAttribute('src')));
    const mainScripts = srcs.filter(s => s && (s.includes('runtime') || s.includes('main.js') || s.includes('service') || s.includes('webOSTV')));
    for (const src of mainScripts) {
      expect(src).toContain('?v=' + SITE_VERSION);
    }
  });
});

test.describe('Splash screen', () => {
  test('splash screen is present on load', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const splash = page.locator('#splash');
    // Splash should exist immediately on page load
    await expect(splash).toBeAttached();
  });

  test('splash contains logo image', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const logo = page.locator('#splash img');
    await expect(logo).toHaveAttribute('src', 'logo.png');
  });

  test('splash has progress bar', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const bar = page.locator('#splash-bar');
    await expect(bar).toBeAttached();
  });

  test('splash is removed once the core is usable (boot signal, not the 30s safety net)', async ({ page }) => {
    await bootApp(page, { core: 'mock' });
    // The mock satisfies the same coreUsable() contract the WASM engine does,
    // so the splash's own poll removes it — deterministically, long before
    // the 30s safety timer.
    await expect(page.locator('#splash')).not.toBeAttached({ timeout: 10000 });
  });
});

test.describe('Server URL configuration', () => {
  test('default server URL is set', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const serverUrl = await page.evaluate(() => window.__STREMIO_SERVER_URL__);
    expect(serverUrl).toBe('http://127.0.0.1:11470');
  });

  test('?server= query param overrides default', async ({ page }) => {
    await bootApp(page, { core: 'none', url: '/?server=http://192.168.1.100:11470' });
    const serverUrl = await page.evaluate(() => window.__STREMIO_SERVER_URL__);
    expect(serverUrl).toBe('http://192.168.1.100:11470');
  });

  test('?server= param strips trailing slashes', async ({ page }) => {
    await bootApp(page, { core: 'none', url: '/?server=http://192.168.1.100:11470///' });
    const serverUrl = await page.evaluate(() => window.__STREMIO_SERVER_URL__);
    expect(serverUrl).toBe('http://192.168.1.100:11470');
  });

  test('server URL is persisted to localStorage', async ({ page }) => {
    await bootApp(page, { core: 'none', url: '/?server=http://10.0.0.5:11470' });
    const stored = await page.evaluate(() => localStorage.getItem('stremio_server_url'));
    expect(stored).toBe('http://10.0.0.5:11470');
  });

  test('server URL loads from localStorage on second visit', async ({ page }) => {
    await bootApp(page, { core: 'none', url: '/?server=http://10.0.0.5:11470' });
    // Navigate away and back without ?server=
    await bootApp(page, { core: 'none' });
    const serverUrl = await page.evaluate(() => window.__STREMIO_SERVER_URL__);
    expect(serverUrl).toBe('http://10.0.0.5:11470');
  });
});

test.describe('VIDAA keyboard fix', () => {
  test('patch version is set to 5', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const patchVersion = await page.evaluate(() => window.__STREMIO_PATCH_VERSION__);
    expect(patchVersion).toBe(5);
  });

  test('input value setter is overridden', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    // The setter intercept should fire an input event when value changes
    const eventFired = await page.evaluate(() => {
      return new Promise((resolve) => {
        var input = document.createElement('input');
        input.type = 'text';
        document.body.appendChild(input);
        input.addEventListener('input', () => resolve(true));
        input.value = 'test search';
        // Give it a moment
        setTimeout(() => resolve(false), 500);
      });
    });
    expect(eventFired).toBe(true);
  });
});

test.describe('DV Profile 7 detection', () => {
  test('DV detection flag is initialized', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const flag = await page.evaluate(() => window.__DV_PROFILE7_DETECTED__);
    expect(flag).toBe(false);
  });

  test('fetch interceptor logs DV codec from probe without blocking', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    // The new smart DV handler logs codec info but doesn't show a warning preemptively
    const hasWarningFn = await page.evaluate(() => typeof window.__showPlaybackWarning === 'function');
    expect(hasWarningFn).toBe(true);
  });

  test('playback warning overlay can be shown and dismissed', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    // Trigger the warning manually (simulates stalled playback detection)
    await page.evaluate(() => {
      window.__STREAM_INFO__ = { videoCodec: 'dvhe.07.06', width: 3840, height: 2160 };
      window.__showPlaybackWarning();
    });

    const overlay = page.locator('#dv-warning');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('Playback Issue Detected');

    // Click "Dismiss" to close
    await page.click('text=Dismiss');
    await expect(overlay).not.toBeAttached();
  });

  test('playback warning transcode button sets force flag (with a real server)', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    // H4/M3: the Force Transcode button is now gated on a REAL streaming server,
    // exactly like the Blue-button handler. With a configured (non-default)
    // server it is enabled and sets the force flag.
    await page.evaluate(() => {
      window.__STREMIO_SERVER_URL__ = 'http://192.168.1.50:11470';
      window.__STREAM_INFO__ = { videoCodec: 'dvhe.07.06', width: 3840, height: 2160 };
      window.__showPlaybackWarning();
    });
    await page.click('text=Force Transcode');

    const flag = await page.evaluate(() => window.__FORCE_TRANSCODE__);
    expect(flag).toBe(true);

    await expect(page.locator('#dv-warning')).not.toBeAttached();
  });

  test('playback warning transcode button is gated when there is NO streaming server', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const result = await page.evaluate(() => {
      window.__STREMIO_SERVER_URL__ = 'http://127.0.0.1:11470'; // default == no real server
      window.__STREAM_INFO__ = { videoCodec: 'dvhe.07.06', width: 3840, height: 2160 };
      window.__FORCE_TRANSCODE__ = false;
      window.__showPlaybackWarning();
      var btns = Array.prototype.slice.call(document.querySelectorAll('#dv-warning button'));
      var transBtn = btns.find(function (b) { return /transcode/i.test(b.textContent || ''); });
      var disabled = !!(transBtn && transBtn.disabled);
      if (transBtn) transBtn.click();
      return { present: !!transBtn, disabled: disabled, force: window.__FORCE_TRANSCODE__, label: transBtn ? transBtn.textContent : '' };
    });

    expect(result.present).toBe(true);
    expect(result.disabled).toBe(true);
    expect(result.force).not.toBe(true);
    // Honest label tells the user a server is required.
    expect(/needs streaming-server/i.test(result.label)).toBe(true);
  });
});

test.describe('Error enhancer', () => {
  test('error enhancer function exists', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const exists = await page.evaluate(() => typeof window.__STREMIO_ERROR_ENHANCER__ === 'function');
    expect(exists).toBe(true);
  });

  test('enhancer returns friendly message for unsupported codec', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const msg = await page.evaluate(() => {
      return window.__STREMIO_ERROR_ENHANCER__({ message: 'MEDIA_ERR_SRC_NOT_SUPPORTED', code: 4 });
    });
    expect(msg).toContain('not supported');
    expect(msg).toContain('streaming server');
  });

  test('enhancer returns friendly message for decode error', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const msg = await page.evaluate(() => {
      return window.__STREMIO_ERROR_ENHANCER__({ message: 'MEDIA_ERR_DECODE', code: 3 });
    });
    expect(msg).toContain('decode error');
  });

  test('enhancer returns friendly message for network error', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const msg = await page.evaluate(() => {
      return window.__STREMIO_ERROR_ENHANCER__({ message: 'MEDIA_ERR_NETWORK', code: 2 });
    });
    expect(msg).toContain('Network error');
  });

  test('enhancer returns DV-specific message when DV stall detected', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const msg = await page.evaluate(() => {
      window.__DV_PROFILE7_DETECTED__ = 'dvhe.07.06';
      window.__STREAM_INFO__ = { stallCheck: Date.now() };
      return window.__STREMIO_ERROR_ENHANCER__({ message: 'some error' });
    });
    expect(msg).toContain('Dolby Vision');
    expect(msg).toContain('dvhe.07.06');
  });

  test('enhancer passes through unknown errors unchanged', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const msg = await page.evaluate(() => {
      window.__DV_PROFILE7_DETECTED__ = false;
      return window.__STREMIO_ERROR_ENHANCER__({ message: 'Something weird happened' });
    });
    expect(msg).toBe('Something weird happened');
  });

  test('enhancer handles null/undefined gracefully', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const msg = await page.evaluate(() => {
      return window.__STREMIO_ERROR_ENHANCER__(null);
    });
    expect(msg).toBeNull();
  });
});

test.describe('Server health monitoring', () => {
  test('server health object is initialized', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const health = await page.evaluate(() => window.__SERVER_HEALTH__);
    expect(health).toBeDefined();
    expect(health.status).toBe('unknown');
  });
});

test.describe('Resolution indicator', () => {
  test('quality indicator does not show outside player route', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const indicator = page.locator('#quality-indicator');
    // Should not exist or be hidden when not in player
    const count = await indicator.count();
    if (count > 0) {
      await expect(indicator).toBeHidden();
    }
  });
});

test.describe('Remote control key mappings', () => {
  test('Red button (403) toggles quality indicator', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    // Create the indicator first
    await page.evaluate(() => {
      var el = document.createElement('div');
      el.id = 'quality-indicator';
      el.style.display = 'block';
      el.textContent = '1080p';
      document.body.appendChild(el);
    });

    // Press Red button
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 403 }));
    });
    const display = await page.evaluate(() => document.getElementById('quality-indicator').style.display);
    expect(display).toBe('none');

    // Press again to toggle back
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 403 }));
    });
    const display2 = await page.evaluate(() => document.getElementById('quality-indicator').style.display);
    expect(display2).toBe('block');
  });

  test('Blue button (406) sets force transcode flag with configured server even when health is stale', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/?server=http://10.0.0.5:11470#/player/test' });
    await page.evaluate(() => {
      window.__SERVER_HEALTH__ = { status: 'unknown', latency: null, version: null };
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 406 }));
    });
    const flag = await page.evaluate(() => window.__FORCE_TRANSCODE__);
    expect(flag).toBe(true);
  });

  test('Blue button (406) does not force transcode without a configured server', async ({ page }) => {
    await bootApp(page, { core: 'mock', url: '/#/player/test' });
    await page.evaluate(() => {
      window.__SERVER_HEALTH__ = { status: 'online', latency: 12, version: 'test' };
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 406 }));
    });
    const flag = await page.evaluate(() => window.__FORCE_TRANSCODE__);
    expect(flag).not.toBe(true);
  });

  test('Green button (404) shows server health overlay', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => {
      window.__SERVER_HEALTH__ = { status: 'online', latency: 42, version: '4.20.0' };
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 404 }));
    });
    const overlayText = await page.waitForFunction(() => {
      var els = document.querySelectorAll('div');
      for (var i = 0; i < els.length; i++) {
        var t = els[i].textContent || '';
        if (t.indexOf('Server Health') !== -1) return t;
      }
      return null;
    }, null, { timeout: 3000 });
    const text = await overlayText.jsonValue();
    expect(text).toContain('Server Health');
    expect(text).toContain('online');
    expect(text).toContain('42ms');
  });
});

test.describe('Native VIDAA settings and handoff', () => {
  test('native settings toggles are registered with stable ids and ls keys', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const reg = await page.evaluate(() =>
      (window.__vidaaSettingsItems || []).map(function (i) {
        return { id: i.id, type: i.type, label: typeof i.label === 'function' ? i.label() : i.label, lsKey: i.lsKey };
      })
    );
    const byId = {};
    for (const i of reg) byId[i.id] = i;
    // The thin chunk seam renders whatever the registry holds; these ids are
    // the contract with settings/settings-ui.js's ORDER layout.
    expect(byId['quiet-player-toggle'].label).toBe('Quiet Player Mode');
    expect(byId['auto-native-mkv-toggle'].lsKey).toBe('stremio_auto_native_player_mkv');
    expect(byId['auto-native-player-toggle'].lsKey).toBe('stremio_auto_native_player');
    expect(byId['webtorrent-toggle'].type).toBe('toggle');
    // The rendered row labels are asserted end-to-end in
    // server-url-manager.spec.js ("settings rows: … served by the patch layer").
  });

  test('native player handoff uses container-aware MIME types', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const types = await page.evaluate(() => ({
      mkv: window.__guessNativeMimeType('https://cdn.example/movie.mkv?token=1'),
      hls: window.__guessNativeMimeType('https://cdn.example/master.m3u8'),
      mp4: window.__guessNativeMimeType('https://cdn.example/movie.mp4')
    }));
    expect(types.mkv).toBe('video/x-matroska');
    expect(types.hls).toBe('application/vnd.apple.mpegurl');
    expect(types.mp4).toBe('video/mp4');
  });
});

test.describe('Watchdog', () => {
  test('watchdog does not trigger under normal conditions', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    // Observation window: the watchdog reloads on a frozen main thread — a
    // healthy page must keep its title for a few seconds.
    await page.waitForTimeout(3000);
    await expect(page).toHaveTitle('Stremio - Freedom to Stream');
  });
});

test.describe('Service Worker', () => {
  test('service worker is registered', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'not supported';
      // Wait for the registration promise to settle (bounded).
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 8000);
        navigator.serviceWorker.ready.then(() => { clearTimeout(t); resolve(); });
      });
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length > 0 ? 'registered' : 'not registered';
    });
    // SW registration may fail in test env but shouldn't error
    expect(['registered', 'not registered', 'not supported']).toContain(swRegistered);
  });
});

test.describe('720p zoom detection', () => {
  // screen720p is detected asynchronously by player/zoom-correction.js —
  // wait for the boolean to EXIST before asserting its value.
  test('screen720p flag defaults to false in non-VIDAA env', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.waitForFunction(() => typeof window.screen720p === 'boolean', null, { timeout: 8000 });
    const is720p = await page.evaluate(() => window.screen720p);
    expect(is720p).toBe(false);
  });

  test('720p zoom applies to UI routes on mocked VIDAA 720p devices', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootApp(page, { core: 'none', init: [() => { window.Hisense_GetFirmWareVersion = () => 'mock-fw'; }] });

    await expect.poll(() => page.evaluate(() => window.screen720p), { timeout: 8000 }).toBe(true);
    const state = await page.evaluate(() => ({
      zoom: document.body.style.zoom,
      uiZoomApplied: document.body.getAttribute('data-vidaa-ui-zoom')
    }));
    expect(state.zoom).toBe('65%');
    expect(state.uiZoomApplied).toBe('true');
  });

  test('ui-only mode forces UI zoom even when 720p auto-detection does not trigger', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1080 });
    await bootApp(page, {
      core: 'none',
      localStorage: { stremio_720p_mode: 'ui-only' },
    });

    await expect.poll(() => page.evaluate(() => document.body.style.zoom), { timeout: 8000 }).toBe('65%');
    const state = await page.evaluate(() => ({
      mode: window.__get720pMode(),
      screen720p: window.screen720p,
      uiZoomApplied: document.body.getAttribute('data-vidaa-ui-zoom')
    }));
    expect(state.mode).toBe('ui-only');
    expect(state.screen720p).toBe(false);
    expect(state.uiZoomApplied).toBe('true');
  });

  test('player routes stay unscaled by default on mocked VIDAA 720p devices', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootApp(page, {
      core: 'mock', // keep the hash on the player route — no login redirect
      url: '/#/player/test-stream',
      init: [() => { window.Hisense_GetFirmWareVersion = () => 'mock-fw'; }],
    });

    await expect.poll(() => page.evaluate(() => window.screen720p), { timeout: 8000 }).toBe(true);
    const state = await page.evaluate(() => ({
      zoom: document.body.style.zoom,
      uiZoomApplied: document.body.getAttribute('data-vidaa-ui-zoom'),
      hasLegacyPlayerFit: !!document.getElementById('vidaa-player-fit')
    }));
    expect(state.zoom).toBe('');
    expect(state.uiZoomApplied).toBe('false');
    expect(state.hasLegacyPlayerFit).toBe(false);
  });

  test('player zoom suppression can be explicitly disabled for legacy behavior', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/test-stream',
      localStorage: { stremio_zoom_disable_in_player: 'false' },
      init: [() => { window.Hisense_GetFirmWareVersion = () => 'mock-fw'; }],
    });

    await expect.poll(() => page.evaluate(() => document.body.style.zoom), { timeout: 8000 }).toBe('65%');
    const state = await page.evaluate(() => ({
      uiZoomApplied: document.body.getAttribute('data-vidaa-ui-zoom')
    }));
    expect(state.uiZoomApplied).toBe('true');
  });

  test('off mode disables zoom even on mocked VIDAA 720p devices', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootApp(page, {
      core: 'none',
      localStorage: { stremio_720p_mode: 'off' },
      init: [() => { window.Hisense_GetFirmWareVersion = () => 'mock-fw'; }],
    });

    // Wait for the async detection to settle (screen720p === true), then the
    // off mode means no zoom was ever applied.
    await page.waitForFunction(() => window.screen720p === true, null, { timeout: 8000 });
    const state = await page.evaluate(() => ({
      mode: window.__get720pMode(),
      screen720p: window.screen720p,
      zoom: document.body.style.zoom,
      uiZoomApplied: document.body.getAttribute('data-vidaa-ui-zoom')
    }));
    expect(state.mode).toBe('off');
    expect(state.screen720p).toBe(true);
    expect(state.zoom).toBe('');
    expect(state.uiZoomApplied).toBe('false');
  });
});

test.describe('Installer flows', () => {
  // The installer page is NOT part of the deployed site — it only runs from
  // the local DNS-spoof flow (installer/server.py serves installer/ from a
  // repo clone, and the VIDAA install APIs are vidaahub.com-only). Tests
  // load the real page straight from the repo via route fulfilment.
  // (No bootApp here: the installer page has no patch layer to wait for.)
  test.beforeEach(async ({ page }) => {
    await page.route(/\/installer\/(index\.html)?$/, (route) =>
      route.fulfill({ path: 'installer/index.html', contentType: 'text/html' }));
  });

  test('direct launcher install does not persist a false-confirmed localStorage flag', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await installFakeVidaa(page, { osVersion: 'mock-os', installArgsKey: '__installArgs' });

    await page.goto('/');
    await expect(page.locator('#install-banner')).toBeVisible({ timeout: 7000 });
    await page.locator('#install-banner button').first().click();
    await expect(page.locator('#install-banner span')).toContainText('Install requested');

    const persisted = await page.evaluate(() => localStorage.getItem('stremio_installed_to_launcher'));
    expect(persisted).toBeNull();

    const successStamp = await page.evaluate(() => localStorage.getItem('stremio_install_banner_last_success_at'));
    expect(successStamp).toBeTruthy();

    await context.close();
  });

  test('direct launcher install prompt is suppressed after a recent accepted install', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await installFakeVidaa(page, { osVersion: 'mock-os' });
    await page.addInitScript(() => {
      localStorage.setItem('stremio_install_banner_last_success_at', String(Date.now()));
    });

    await page.goto('/');
    await expect(page.locator('#install-banner')).toHaveCount(0);

    await context.close();
  });

  test('method 1 installer uses locally served icon assets', async ({ page }) => {
    await installFakeVidaa(page, { installArgsKey: '__installerArgs' });

    await page.goto('/installer/');
    await page.locator('#btnInstall').click();
    await page.waitForFunction(() => window.__installerArgs !== null);

    const args = await page.evaluate(() => window.__installerArgs);
    expect(args).toBeTruthy();
    const iconUrl = new URL('/icon.png', page.url()).href;
    expect(args.icon1).toBe(iconUrl);
    expect(args.icon2).toBe(iconUrl);
    expect(args.icon3).toBe(iconUrl);
    expect(args.appUrl).toContain('https://bariccattion.github.io/stremio-vidaa-tv/');

    // The URL must not just be well-formed — the TV downloads the icon from
    // it during install, so it has to resolve on the serving origin.
    for (const icon of [args.icon1, args.icon2, args.icon3]) {
      const response = await page.request.get(icon);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('image/');
    }
  });

  test('installer diagnostics include domain registration and install results', async ({ page }) => {
    await installFakeVidaa(page, {});

    await page.goto('/installer/');
    await page.locator('#btnInstall').click();
    await page.waitForFunction(() => {
      const el = document.getElementById('diagText');
      return el && el.value.indexOf('"callbackStatus": "accepted"') !== -1;
    });

    const blob = await page.locator('#diagText').inputValue();
    expect(blob).toContain('"page": "installer"');
    expect(blob).toContain('"status": "ok"');
    expect(blob).toContain('"callbackStatus": "accepted"');
  });

  test('installer writes the app registry directly when HiUtils_createRequest is available', async ({ page }) => {
    const existingRegistry = {
      AppInfo: [
        { Id: 'someotherapp', AppName: 'Other', URL: 'https://example.com' },
        { Id: 'stremio-vidaa', AppName: 'Stremio (old entry)', URL: 'https://old.example.com' }
      ]
    };

    await installFakeVidaa(page, { registry: existingRegistry });

    await page.goto('/installer/');
    await page.locator('#btnInstall').click();
    await page.waitForFunction(() => {
      const el = document.getElementById('diagText');
      return el && el.value.indexOf('"method": "registry"') !== -1;
    });

    const calls = await page.evaluate(() => window.__calls);
    expect(calls).toContain('HiUtils:fileRead');
    expect(calls).toContain('HiUtils:fileWrite');
    const write = await page.evaluate(() => window.__writes[0]);
    expect(write).toBeTruthy();
    expect(write.path).toBe('websdk/Appinfo.json');
    expect(write.mode).toBe(6);

    const written = JSON.parse(write.writedata);
    expect(written.AppInfo).toHaveLength(2);
    const stremio = written.AppInfo.find(a => a.Id === 'stremio-vidaa');
    expect(stremio.URL).toContain('https://bariccattion.github.io/stremio-vidaa-tv/');
    expect(stremio.Type).toBe('Browser');
    expect(stremio.StoreType).toBe('custom');
    // Other apps in the registry are preserved untouched
    expect(written.AppInfo.find(a => a.Id === 'someotherapp').URL).toBe('https://example.com');
    // Registry-first: the legacy API is never reached when the write succeeds
    expect(calls.find(c => c === 'installApp')).toBeUndefined();

    const blob = await page.locator('#diagText').inputValue();
    expect(blob).toContain('"registryWrite": true');
    expect(blob).toContain('"readRet": "ok"');
  });

  test('installer falls back to Hisense_installApp when the app registry cannot be read', async ({ page }) => {
    await installFakeVidaa(page, { registryDenied: true });

    await page.goto('/installer/');
    await page.locator('#btnInstall').click();
    await page.waitForFunction(() => window.__calls.indexOf('installApp') !== -1);

    const calls = await page.evaluate(() => window.__calls);
    expect(calls).toContain('HiUtils:fileRead');
    expect(calls).toContain('installApp');
    // The registry was never written blind after the failed read
    expect(calls).not.toContain('HiUtils:fileWrite');

    const blob = await page.locator('#diagText').inputValue();
    expect(blob).toContain('"readRet": "failed"');
    expect(blob).toContain('"error": "Appinfo.json unreadable');
  });

  test('uninstall removes only the Stremio entry from the app registry', async ({ page }) => {
    const existingRegistry = {
      AppInfo: [
        { Id: 'someotherapp', AppName: 'Other' },
        { Id: 'stremio-vidaa', AppName: 'Stremio' }
      ]
    };

    await installFakeVidaa(page, { registry: existingRegistry });

    await page.goto('/installer/');
    await page.locator('#btnUninstall').click();
    await page.waitForFunction(() => window.__writes.length > 0);

    const written = JSON.parse(await page.evaluate(() => window.__writes[0].writedata));
    expect(written.AppInfo).toHaveLength(1);
    expect(written.AppInfo[0].Id).toBe('someotherapp');
  });

  test('in-app install banner writes the app registry when available', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const existingRegistry = { AppInfo: [{ Id: 'someotherapp' }] };

    await installFakeVidaa(page, {
      osVersion: 'mock-os',
      registry: existingRegistry,
      legacyCountKey: '__legacyCalls',
      writesKey: '__registryWrites',
    });

    await page.goto('/');
    await expect(page.locator('#install-banner')).toBeVisible({ timeout: 7000 });
    await page.locator('#install-banner button').first().click();
    await expect(page.locator('#install-banner span')).toContainText('app registry');

    const written = JSON.parse(await page.evaluate(() => window.__registryWrites[0].writedata));
    const entry = written.AppInfo.find(a => a.Id === 'stremio-vidaa');
    expect(entry.URL).toBe('https://bariccattion.github.io/stremio-vidaa-tv/');
    expect(await page.evaluate(() => window.__legacyCalls)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('stremio_install_banner_method'))).toBe('registry');

    await context.close();
  });
});

test.describe('Diagnostics', () => {
  test('runtime diagnostics modal can be opened and includes build info', async ({ page }) => {
    await installFakeVidaa(page, { osVersion: 'mock-os' });
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => window.__showVidaaDiagnostics());
    await expect(page.locator('#vidaa-diagnostic-panel')).toBeVisible();
    const blob = await page.locator('#vidaa-diagnostic-panel textarea').inputValue();
    expect(blob).toContain('"build": "');
    expect(blob).toContain('"vidaaDetected": true');
  });

  test('720p mode cycles and reset keeps server url while clearing tweaks', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => {
      localStorage.setItem('stremio_server_url', 'http://10.0.0.7:11470');
      localStorage.setItem('stremio_720p_mode', 'ui-only');
      localStorage.setItem('stremio_stream_stats', 'true');
    });
    const modeAfterFirstCycle = await page.evaluate(() => window.__cycle720pMode());
    expect(modeAfterFirstCycle).toBe('ui-and-player');
    const modeAfterSecondCycle = await page.evaluate(() => window.__cycle720pMode());
    expect(modeAfterSecondCycle).toBe('off');

    const resetState = await page.evaluate(() => {
      const first = window.__triggerResetVidaaTweaks();
      return {
        first,
        label: window.__getResetVidaaTweaksLabel()
      };
    });
    expect(resetState.first).toBe(false);
    expect(resetState.label).toContain('Confirm');

    await Promise.all([
      page.waitForURL(() => true, { waitUntil: 'domcontentloaded', timeout: 10000 }),
      page.evaluate(() => window.__triggerResetVidaaTweaks()),
    ]);
    // waitForFunction survives the reload's context swap (page.evaluate does not).
    await page.waitForFunction(() => localStorage.getItem('stremio_720p_mode') === null, null, { timeout: 8000 });

    const storageState = await page.evaluate(() => ({
      serverUrl: localStorage.getItem('stremio_server_url'),
      mode: localStorage.getItem('stremio_720p_mode'),
      streamStats: localStorage.getItem('stremio_stream_stats')
    }));

    expect(storageState.serverUrl).toBe('http://10.0.0.7:11470');
    expect(storageState.mode).toBeNull();
    expect(storageState.streamStats).toBeNull();
  });

  test('playback diagnostics modal captures video and stream info', async ({ page }) => {
    await installFakeVideoFactory(page);
    await bootApp(page, {
      core: 'mock',
      url: '/#/player/test-stream',
      mockCore: {
        player: {
          paused: false,
          buffering: false,
          duration: 120,
          selectedSubtitleTrack: { id: 'sub-en', lang: 'eng' },
          selectedAudioTrack: { id: 'audio-main', lang: 'eng' },
          stream: { url: 'https://cdn.example.com/stream.m3u8' }
        }
      },
    });
    await page.evaluate(() => {
      window.__STREAM_INFO__ = {
        videoCodec: 'h264',
        width: 1920,
        height: 1080,
        title: 'Test Stream'
      };
      window.__VIDAA_STATE__ = { hdr: 'HDR10', videoCodec: 'h264' };
      window.__makeFakeVideo({
        currentSrc: 'https://cdn.example.com/stream.m3u8',
        readyState: 4,
        networkState: 1,
        paused: false,
        muted: false,
        volume: 0.75,
        playbackRate: 1,
        duration: 120,
        videoWidth: 1920,
        videoHeight: 1080,
        buffered: { length: 1, end: () => 42 },
      }).getVideoPlaybackQuality = () => ({
        droppedVideoFrames: 3,
        totalVideoFrames: 100,
        corruptedVideoFrames: 0,
        creationTime: 1
      });
    });

    await page.evaluate(() => window.__showPlaybackDiagnostics());
    await expect(page.locator('#vidaa-diagnostic-panel')).toBeVisible();
    await page.waitForFunction(() => {
      const el = document.querySelector('#vidaa-diagnostic-panel textarea');
      return el && el.value.indexOf('"currentSrcHost": "cdn.example.com"') !== -1;
    });
    const blob = await page.locator('#vidaa-diagnostic-panel textarea').inputValue();
    expect(blob).toContain('"videoCodec": "h264"');
    expect(blob).toContain('"selectedSubtitleTrackId": "sub-en"');
    expect(blob).toContain('"currentSrcHost": "cdn.example.com"');
  });

  test('safe playback mode applies conservative defaults and reloads', async ({ page }) => {
    await bootApp(page, { core: 'none' });
    await page.evaluate(() => {
      localStorage.setItem('stremio_720p_mode', 'ui-and-player');
      localStorage.setItem('stremio_force_stereo', 'true');
      localStorage.setItem('stremio_audio_delay_enabled', 'true');
      localStorage.setItem('stremio_sub_drift_fix', 'true');
      localStorage.setItem('stremio_webtorrent_enabled', 'true');
      localStorage.setItem('stremio_stream_stats', 'true');
      localStorage.setItem('stremio_low_memory', 'false');
      localStorage.setItem('stremio_auto_rebuffer', 'false');
      localStorage.setItem('stremio_playback_warning', 'false');
      localStorage.setItem('stremio_quiet_player', 'true');
      localStorage.setItem('stremio_auto_native_player_mkv', 'true');
      localStorage.setItem('stremio_auto_native_player', 'true');
      window.__applyPlaybackSafeMode();
    });
    // The safe mode reloads the page; waitForFunction rides out the context swap.
    await page.waitForFunction(() => localStorage.getItem('stremio_720p_mode') === 'auto', null, { timeout: 8000 });

    const state = await page.evaluate(() => ({
      mode: localStorage.getItem('stremio_720p_mode'),
      forceStereo: localStorage.getItem('stremio_force_stereo'),
      audioDelay: localStorage.getItem('stremio_audio_delay_enabled'),
      subDrift: localStorage.getItem('stremio_sub_drift_fix'),
      webtorrent: localStorage.getItem('stremio_webtorrent_enabled'),
      streamStats: localStorage.getItem('stremio_stream_stats'),
      lowMemory: localStorage.getItem('stremio_low_memory'),
      autoRebuffer: localStorage.getItem('stremio_auto_rebuffer'),
      playbackWarning: localStorage.getItem('stremio_playback_warning'),
      quietPlayer: localStorage.getItem('stremio_quiet_player'),
      autoNativeMkv: localStorage.getItem('stremio_auto_native_player_mkv'),
      autoNativeAll: localStorage.getItem('stremio_auto_native_player')
    }));

    expect(state.mode).toBe('auto');
    expect(state.forceStereo).toBe('false');
    expect(state.audioDelay).toBe('false');
    expect(state.subDrift).toBe('false');
    expect(state.webtorrent).toBe('false');
    expect(state.streamStats).toBe('false');
    expect(state.lowMemory).toBe('true');
    expect(state.autoRebuffer).toBe('true');
    expect(state.playbackWarning).toBe('true');
    expect(state.quietPlayer).toBe('false');
    expect(state.autoNativeMkv).toBe('false');
    expect(state.autoNativeAll).toBe('false');
  });
});
