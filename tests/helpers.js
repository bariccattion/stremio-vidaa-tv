// @ts-check
// Shared test seam for the whole suite — the ONE place that knows how to
// boot the app, fake the TV, and mock the streaming server.
//
// Boot contract (bootApp):
//   The kernel latches window.__VIDAA_CORE_READY__ once window.core answers
//   getState (patches/head/kernel/runtime.js, RT.coreUsable). bootApp waits
//   on that flag — never on a fixed sleep. Three modes:
//     core: 'real'  — the WASM engine actually boots (probe-core contract);
//                     also waits for the splash to be gone.
//     core: 'mock'  — installMockCore runs before page scripts, so the app's
//                     boot effect sees window.core set and never loads the
//                     WASM; fast and fully deterministic.
//     core: 'none'  — just the patch layer; for tests that only exercise
//                     window.__* globals and DOM.
//
// Honesty rules (see the header of buffering-honesty.spec.js):
//   • installFakeNative only CAPTURES messages — it never simulates the app
//     backgrounding, because real VIDAA firmware ignores them.
//   • simulateAppBackgrounded/foregrounded use real visibilitychange events —
//     the one sanctioned simulation, since a backgrounded tab is the only
//     honest signal that the native player took the foreground.
//   • No string-greps against built artifacts (app/*.chunk.js, app/main.js,
//     app/index.html): assert through window.__* interfaces or rendered DOM.
//     Structural reads of patches/ sources and the sw.js assembly remain in
//     webtorrent.spec.js as a documented exception.

const MOCK_SETTINGS_DEFAULT = { values: { serverVersion: '4.20.0' } };

// ── boot ────────────────────────────────────────────────────────────────

/**
 * Boot the built app and wait for a REAL readiness signal.
 *
 * opts:
 *   url          — path to navigate to (default '/'); hash routes fine.
 *   core         — 'real' | 'mock' | 'none' (default 'real').
 *   mockCore     — per-model state for core:'mock' (see installMockCore).
 *   captureReal  — for core:'mock': capture a later real core into
 *                  window.__realCore instead of discarding it.
 *   localStorage — object seeded before page scripts run (kills the
 *                  goto → setItem → goto dance).
 *   init         — extra [fn, arg] addInitScript pairs, installed AFTER the
 *                  mock core and the localStorage seed, in order.
 *
 * Returns { patchVersion, buildCommit, coreReady }.
 */
async function bootApp(page, opts = {}) {
  const { url = '/', core = 'real', mockCore = null, captureReal = false } = opts;
  const seeds = opts.localStorage || null;
  const init = opts.init || [];

  if (core === 'mock') installMockCore(page, mockCore || {}, { captureReal });
  if (seeds && Object.keys(seeds).length > 0) {
    await page.addInitScript((s) => {
      for (const k of Object.keys(s)) localStorage.setItem(k, s[k]);
    }, seeds);
  }
  for (const item of init) {
    if (Array.isArray(item)) await page.addInitScript(item[0], item[1]);
    else await page.addInitScript(item);
  }

  await page.goto(url);

  // Stage 1 — patch layer (inline scripts; resolves as soon as load lands).
  await page.waitForFunction(
    () => !!(window.__vidaaRuntime && window.__STREMIO_PATCH_VERSION__ !== undefined),
    null,
    { timeout: 15000 }
  );

  if (core === 'real') {
    // 25s < the splash's 30s safety net, so success always means "core booted",
    // never "safety timer fired".
    await page.waitForFunction(() => window.__VIDAA_CORE_READY__ === true, null, { timeout: 25000 });
    await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 5000 });
  } else if (core === 'mock') {
    await page.waitForFunction(() => window.__VIDAA_CORE_READY__ === true, null, { timeout: 5000 });
  }

  return page.evaluate(() => ({
    patchVersion: window.__STREMIO_PATCH_VERSION__ || null,
    buildCommit: window.__BUILD_COMMIT__ || null,
    coreReady: window.__VIDAA_CORE_READY__ === true,
  }));
}

// ── streaming-server mock ───────────────────────────────────────────────

/**
 * Route-level Stremio streaming-server mock. Unifies the host-gated
 * mockServer() this suite used to duplicate with the full stremio-server v3
 * shapes from scripts/probe-server.mjs.
 *
 * opts:
 *   hostPattern — RegExp gate: matching URLs are answered, everything else
 *                 is aborted so the ~700-candidate LAN sweep fails fast.
 *                 null (default) answers every matched request.
 *   settings    — /settings JSON body (default {values:{serverVersion}}).
 *   full        — also serve /casting, /network-info, /device-info with the
 *                 shapes the real core expects.
 *   log         — array collecting "METHOD url" for request assertions.
 *
 * Returns { setServerUp(bool) } — flipping to false makes subsequent
 * requests abort (the false-offline scenario: core checks once and sticks).
 */
async function installServerMock(page, opts = {}) {
  const { hostPattern = null, settings = MOCK_SETTINGS_DEFAULT, full = false, log = null } = opts;
  const state = { up: true };
  const json = (body) => ({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
  const answer = async (route, body) => {
    if (log) log.push(route.request().method() + ' ' + route.request().url());
    if (!state.up || (hostPattern && !hostPattern.test(route.request().url()))) {
      await route.abort();
      return;
    }
    await route.fulfill(typeof body === 'function' ? body() : json(body));
  };

  await page.route(/\/settings/, (route) => answer(route, settings));
  await page.route(/heartbeat/, (route) => answer(route, { status: 200, body: 'ok', headers: { 'Access-Control-Allow-Origin': '*' } }));
  if (full) {
    await page.route(/\/casting/, (route) => answer(route, []));
    await page.route(/\/network-info/, (route) =>
      answer(route, { local_ip: '127.0.0.1', public_ip: '203.0.113.1', availableInterfaces: [] }));
    await page.route(/\/device-info/, (route) => answer(route, { info: { model: 'mock', version: '1' } }));
  }
  return {
    setServerUp: (v) => { state.up = v; },
    get serverUp() { return state.up; },
  };
}

// ── core mock ───────────────────────────────────────────────────────────

/**
 * Install a mock stremio core BEFORE page scripts run. The app's boot effect
 * checks `if (!window.core)` — with the mock present it never loads the WASM.
 *
 * In-page surface (stable names, shared by every spec):
 *   window.__mockCoreState   — { model: value | function } (functions evaluated per read;
 *                              declare sync consumers' models as { __syncValue: state })
 *   window.__setMockCore(m, v) — swap a model's state mid-test
 *   window.__mockDispatchLog — JSON.stringify'd dispatched action objects (flat)
 *   window.__realCore        — a later real core, when opts.captureReal
 *
 * opts.captureReal keeps the defineProperty `set` non-destructive (the
 * upstream-fixes variant that observes the real engine while the mock serves).
 */
function installMockCore(page, state = {}, opts = {}) {
  return page.addInitScript(
    ({ state, captureReal }) => {
      // First installer wins: bootApp({core:'mock', mockCore}) after a manual
      // installMockCore must not clobber the existing state.
      if (window.__mockCore) return;
      window.__mockCoreState = state;
      window.__mockDispatchLog = [];
      window.__realCore = null;
      window.__setMockCore = function (model, value) {
        window.__mockCoreState[model] = value;
        // Behave like the real core: a state change emits a NewState event
        // naming the model (RT.core.onState subscribers depend on this).
        try {
          if (typeof window.onCoreEvent === 'function') {
            window.onCoreEvent({ name: 'NewState', args: { model: model } });
          }
        } catch (e) {}
      };
      window.__mockCore = {
        getState: function (model) {
          const v = window.__mockCoreState[model];
          const val = typeof v === 'function' ? v() : v === undefined ? null : v;
          // Some patches consume getState() synchronously (no .then) — declare
          // those models as { __syncValue: <state> } to bypass the Promise.
          if (val && typeof val === 'object' && val.__syncValue !== undefined) return val.__syncValue;
          return Promise.resolve(val);
        },
        dispatch: function (action) {
          window.__mockDispatchLog.push(JSON.stringify(action));
          return Promise.resolve();
        },
      };
      Object.defineProperty(window, 'core', {
        get: function () { return window.__mockCore; },
        set: function (v) { if (captureReal) window.__realCore = v; },
        configurable: true,
      });
    },
    { state, captureReal: !!opts.captureReal }
  );
}

// ── TV fakes (honesty rules apply — capture, never simulate success) ─────

/**
 * Fake omi_platform bridge. CAPTURE-ONLY by design: real VIDAA firmware
 * ignores launchNativePlayer/openMediaPlayer/playVideo, so this fake must not
 * pretend anything happened either. Assert on window[capture]; use
 * simulateAppBackgrounded for the one sanctioned success signal.
 */
function installFakeNative(page, capture = '__sentMessages') {
  return page.addInitScript(
    (captureKey) => {
      window[captureKey] = [];
      window.omi_platform = {
        sendPlatformMessage: function (msg) {
          try { window[captureKey].push(JSON.parse(msg)); } catch (e) { window[captureKey].push(msg); }
        },
      };
    },
    capture
  );
}

/**
 * The sanctioned backgrounding simulation: REAL visibilitychange events.
 * simulateAppBackgrounded(page, ms) fires after `ms` (0 = immediately); safe
 * to arm right before triggering a handoff whose verify window is longer.
 */
async function simulateAppBackgrounded(page, ms = 0) {
  await page.evaluate((delay) => {
    const emit = () => {
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      } catch (e) { /* already defined */ }
      document.dispatchEvent(new Event('visibilitychange'));
    };
    if (delay > 0) setTimeout(emit, delay);
    else emit();
  }, ms);
}

async function simulateAppForegrounded(page) {
  await page.evaluate(() => {
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    } catch (e) { /* already defined */ }
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/**
 * Consolidated Hisense/VIDAA platform fake for the installer + 720p flows.
 * Only the requested APIs are installed — presence changes which code path
 * runs (e.g. HiUtils_createRequest switches the installer to the
 * registry-write path), so nothing is installed by accident:
 *   - Hisense_GetOSVersion / _GetFirmWareVersion only when osVersion /
 *     firmware are given (omitting osVersion keeps kernel/device.js's VIDAA
 *     gate closed, which the 720p tests rely on).
 *   - Hisense_installApp when installApp is true (default) or a capture key
 *     (installArgsKey / legacyCountKey) is set.
 *   - HiUtils_createRequest only when `registry` is given or `registryDenied`.
 *
 * Call log entries are strings: 'installApp', 'HiUtils:fileRead', …
 * fileWrite payloads land in window[writesKey] as the FULL request opts
 * ({path, mode, writedata}).
 */
function installFakeVidaa(page, opts = {}) {
  const {
    osVersion = null,
    firmware = null,
    registry = null,
    registryDenied = false,
    callsKey = '__calls',
    writesKey = '__writes',
    installArgsKey = null,
    legacyCountKey = null,
    installApp = true,
  } = opts;
  const wantHiUtils = registry !== null || registryDenied;
  return page.addInitScript(
    (cfg) => {
      window[cfg.callsKey] = [];
      window[cfg.writesKey] = [];
      if (cfg.installArgsKey) window[cfg.installArgsKey] = null;
      if (cfg.legacyCountKey) window[cfg.legacyCountKey] = 0;
      if (cfg.osVersion) window.Hisense_GetOSVersion = function () { return cfg.osVersion; };
      if (cfg.firmware) window.Hisense_GetFirmWareVersion = function () { return cfg.firmware; };
      window.Hisense_AddInsecureDomain = function () { window[cfg.callsKey].push('AddInsecureDomain'); return 0; };
      if (cfg.installApp || cfg.installArgsKey || cfg.legacyCountKey) {
        window.Hisense_installApp = function (appId, appName, icon1, icon2, icon3, appUrl, storeType, cb) {
          window[cfg.callsKey].push('installApp');
          if (cfg.installArgsKey) window[cfg.installArgsKey] = { appId, appName, icon1, icon2, icon3, appUrl, storeType };
          if (cfg.legacyCountKey) window[cfg.legacyCountKey]++;
          if (typeof cb === 'function') cb(0);
        };
      }
      if (cfg.wantHiUtils) {
        window.HiUtils_createRequest = function (type, reqOpts) {
          window[cfg.callsKey].push('HiUtils:' + type);
          if (type === 'fileRead') {
            if (cfg.registryDenied) return { ret: 0, msg: 'denied' };
            return { ret: 1, msg: JSON.stringify(cfg.registry || { AppInfo: [] }) };
          }
          if (type === 'fileWrite') window[cfg.writesKey].push(reqOpts);
          return { ret: 1 };
        };
      }
    },
    { osVersion, firmware, registry, registryDenied, callsKey, writesKey, installArgsKey, legacyCountKey, installApp, wantHiUtils }
  );
}

/**
 * In-page <video> stub factory: window.__makeFakeVideo(props). Getters
 * (currentSrc, paused, readyState, …) are installed via defineProperty,
 * methods (play, pause, getVideoPlaybackQuality, …) by assignment, and the
 * element is appended to <body>. Write the props object INSIDE the
 * page.evaluate call so function values are allowed.
 */
function installFakeVideoFactory(page) {
  return page.addInitScript(() => {
    window.__makeFakeVideo = function (props) {
      const video = document.createElement('video');
      let played = false;
      const counters = { play: 0, pause: 0, seeks: 0 };
      video.play = function () { played = true; counters.play++; return Promise.resolve(); };
      video.pause = function () { counters.pause++; };
      let currentTime = 0;
      Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: () => currentTime,
        set: (v) => { counters.seeks++; currentTime = v; },
      });
      Object.defineProperty(video, 'paused', { configurable: true, get: () => !played });
      video.__counters = counters;
      for (const key of Object.keys(props || {})) {
        const v = props[key];
        if (typeof v === 'function') video[key] = v;
        else Object.defineProperty(video, key, { configurable: true, get: () => v });
      }
      document.body.appendChild(video);
      return video;
    };
  });
}

// ── waiters (signal-based; replaces the fixed sleeps) ───────────────────

/** Wait until window[name] is a function (patch globals install synchronously). */
function waitForGlobal(page, name, timeout = 10000) {
  return page.waitForFunction((n) => typeof window[n] === 'function', name, { timeout });
}

/**
 * Wait for the #dv-server-toast to show its FINAL verdict (not
 * "Checking…"/"Scanning…") and return its text.
 */
async function waitForServerToast(page, timeout = 12000) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('dv-server-toast');
      return !!el && !/checking|scanning/i.test(el.textContent || '');
    },
    null,
    { timeout }
  );
  return page.evaluate(() => document.getElementById('dv-server-toast').textContent || '');
}

module.exports = {
  bootApp,
  installServerMock,
  installMockCore,
  installFakeNative,
  simulateAppBackgrounded,
  simulateAppForegrounded,
  installFakeVidaa,
  installFakeVideoFactory,
  waitForGlobal,
  waitForServerToast,
};
