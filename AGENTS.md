# AGENTS.md

## What this repo is

A Stremio web app rebuilt to run in the limited browser of Hisense/VIDAA smart
TVs and projectors, deployed as a static site on GitHub Pages. It is not a
source fork of Stremio: `upstream/` holds pristine, replaceable Stremio
artifacts (Theater 1.10.0 frontend, stremio-core-web WASM engine, translations,
vendored WebTorrent), and `scripts/build.mjs` assembles them plus the patch
layer into `app/` (gitignored build output). The actual source of this project
is `patches/`.

## Commands

npm is the package manager; Node 22; no linter/formatter is configured.

- `npm ci` — install dependencies
- `npx playwright install --with-deps chromium` — one-time test browser install
- `npm run build` — assemble `app/`; verifies every upstream file's SHA-256
  against `UPSTREAM.lock.json`. Flags: `--update-lock` (record hashes after an
  intentional sync), `--compare-git=<ref>` (diff output vs a git ref)
- `npm test` — Playwright suite; the webServer builds first and serves `app/`
  on port 8080, so tests always run against fresh output
- `node scripts/probe-core.mjs` / `node scripts/probe-server.mjs` — headless
  boot checks used in CI and after upstream syncs
- `npx serve app -l 8000 --no-clipboard` — serve the built site locally

## Where changes go

- New behavior: add `patches/head/<area>/<name>.js` — `kernel/` (the shared
  toolbox: reusable helpers exposed as `window.__vidaa*` globals), `platform/`
  (TV lifecycle & VIDAA integration), `player/`, `subtitles/`, `audio/`,
  `torrents/`, `library/`, `settings/`, or `diagnostics/`. Scripts are inlined
  into index.html in **template order**: `patches/index.template.html` is the
  manifest, so add the `{{patches/head/...}}` placeholder line there too (the
  build fails if a patch file exists that the template doesn't inline, or if a
  `kernel/` patch would inline after a feature patch). ES5 only — `var`,
  callbacks, no arrow functions or async — because VIDAA browsers are old
  engines. Each patch is a self-contained IIFE with a banner comment
  explaining its purpose; coordinate with other patches through `window.__*`
  globals and feature-check them before use so patches stay independently
  loadable. Shared code goes into `kernel/` (consume `__vidaaRuntime`,
  `__vidaaKeys`, etc.) — never copy-paste a helper between feature patches.
- Changes inside the bundled minified app: a `{find, replace}` op in
  `patches/chunk-edits/*.json`. The `find` string must occur exactly once or
  the build fails; preserve the surrounding webpack-mangled identifiers in
  `replace`.
- Never edit `upstream/` by hand — the build fails on hash mismatch. Updating
  an upstream component is a documented procedure (docs/SYNC.md), ending with
  `node scripts/build.mjs --update-lock` to record the new hashes.
- Never edit or commit `app/` — it is generated and gitignored.

## Conventions by area

Three dialects coexist on purpose:

- `patches/head/**/*.js` and templates: ES5, 4-space indent, defensive try/catch,
  feature-detect old APIs, `localStorage` keys prefixed `stremio_`.
- `scripts/*.mjs`: modern Node ESM, `node:`-prefixed imports, 2-space indent.
- `tests/*.spec.js`: CommonJS with `// @ts-check`, `test.describe` blocks
  named after the GitHub issue they cover. Boot and fake through the shared
  seam in `tests/helpers.js` — never re-implement boot/mocks per spec:
  `bootApp(page, opts)` waits on the kernel boot signal
  (`window.__VIDAA_CORE_READY__`, latched by `RT.coreUsable()`) with three
  core modes (`'real'` = WASM boots, `'mock'` = init-time mock core so the
  engine never loads, `'none'` = patch layer only); `installServerMock`,
  `installMockCore` (`__mockDispatchLog` holds dispatched actions, flat),
  `installFakeNative` (capture-only), `installFakeVidaa`, and the
  `waitFor*` helpers replace fixed sleeps. Wait on signals
  (`waitForFunction`/`expect.poll`/locator auto-wait); keep a real-time
  window only where the timer IS the behavior (rate limits, overwrite
  windows) — and prefer in-page polls when the page stays "hidden"
  (Playwright's rAF pollers stall there). No string-greps against built
  artifacts (`app/*.chunk.js`, `app/main.js`, `app/index.html`): assert via
  `window.__*` interfaces or rendered DOM. `webtorrent.spec.js` holds the
  one documented exception (reads of `patches/` sources and the `sw.js`
  assembly — build structure, not runtime). The Theater settings screen is
  unreachable without a real account (login wall) — see the header of
  `tests/server-url-manager.spec.js` for what that means. Do not fake
  TV/native behavior to make a test pass — see the header of
  `tests/buffering-honesty.spec.js` for the project's reasoning.

## Releases and deployment

- CI on pushes to `development` (site paths) runs the suite, then force-pushes
  `app/` to `gh-pages`. Every deploy rewrites the service-worker cache name,
  which cache-busts every installed TV — don't trigger deploys casually.
- To ship user-visible changes, bump `"siteVersion"` in package.json (drives
  the `?v=N` cache-bust, the on-screen version badge, and the SW cache name)
  and rebuild so the stamp lands.
- Commit messages use conventional-ish prefixes (`ci:`, `feat:`,
  `chore(readme):`).

## Further reading

- `docs/SYNC.md` — the runbook: syncing engine/translations/trackers, lock
  updates, bisecting engine versions.
- `README.md` — architecture diagram, feature tables,
  codec support matrix, TV-specific behavior.
