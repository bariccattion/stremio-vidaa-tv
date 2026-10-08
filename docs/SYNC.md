# Syncing with Stremio upstream

This repository is a **patch layer on top of replaceable Stremio artifacts**, not a
source fork. Keeping that separation mechanical is the whole point of the layout:

```
upstream/                  replaceable Stremio artifacts (never hand-edit)
  theater-1.10.0/          the compiled TV frontend (chunks, assets; dir is
                           recorded in UPSTREAM.lock.json, build reads it from there)
  core-web/<version>/      stremio-core-web engine (v5-worker.js + wasm)
  translations/            50 per-language translation chunks
UPSTREAM.lock.json         version + source URL + SHA-256 of every upstream file
patches/                   everything that makes this a VIDAA build
  head/                    patch scripts, inlined into index.html at build
    kernel/                the shared toolbox: runtime.js (the __vidaaRuntime
                           kernel — toast, logger, store, fetchTimeout,
                           probeServer, when, onRegistryReady,
                           serverConfigured, poll), server-url.js (the
                           serverUrl module owning the streaming server URL
                           lifecycle: ?server= ingest, boot push-to-core,
                           core→localStorage mirror, health monitor + heal),
                           keys.js (the vidaaKeys dispatcher — the ONE remote
                           keydown listener, with name→code map, route/when
                           gates, priorities, and sequence combos), esc.js,
                           native-player.js, device.js, settings-store.js,
                           diagnostics-registry.js
    platform/ player/ subtitles/ audio/ torrents/ library/ settings/
    diagnostics/           feature patches by domain; index.template.html
                           (not filenames) fixes the inline order
  chunk-edits/*.json       surgical {find, replace} ops on pristine chunks
  custom/core.chunk.js     the worker-factory shim that swaps in the v5 engine
  index.template.html      page skeleton ({{VERSION}}, {{COMMIT}} stamped at build)
  sw.template.js           service worker (cache manifest generated at build)
scripts/build.mjs          assembles app/ from the above; enforces the lock
app/                       build output — this is what gets deployed (gitignored)
```

`npm run build` fails loudly if a chunk edit's `find` string no longer matches
exactly once, or if any upstream file's hash differs from the lock. Silent
regressions are what the strictness is for — don't bypass it.

## What can actually be synced

The compiled UI ("Stremio Theater") has no open-source repo: it is not in the
public Stremio/stremio-web repo (that repo is a different, mouse-first app).
Stremio distributes the compiled TV app officially from its CDN —
`https://wn7lso8ghdka.stremio.com/hisense/<version>/index.html` — but keeps only
the current version there: 1.9.2 now 404s behind a redirect, and 1.10.0 is what
is live. Static dumps of past versions exist at
[ananjaser1211/stremio-hisense-tvos](https://github.com/ananjaser1211/stremio-hisense-tvos);
that repo is the only surviving public copy of 1.9.2. The UI has no sync
procedure either way (see Provenance) — the syncable, Stremio-published
components are:

| Component | Source | Current |
|---|---|---|
| Engine | `@stremio/stremio-core-web` on npm (MIT) | 0.64.1 |
| Translations | [Stremio/stremio-translations](https://github.com/Stremio/stremio-translations) | master, synced 2026-10-08 |
| WebTorrent trackers | [ngosang/trackerslist](https://github.com/ngosang/trackerslist) websocket list | master, synced 2026-10-07 |
| TV frontend | Stremio CDN (`wn7lso8ghdka.stremio.com/hisense/<ver>/`, current version only) · dumps at [ananjaser1211/stremio-hisense-tvos](https://github.com/ananjaser1211/stremio-hisense-tvos) | **1.10.0** (re-baselined 2026-10-08; still no sync path — see Provenance) |

## Sync procedure

```bash
# 1. Engine (find the latest version at https://www.npmjs.com/package/@stremio/stremio-core-web)
node scripts/sync-core.mjs --version 0.64.1

# 2. Translations (prints a per-language merge report)
node scripts/sync-translations.mjs

# 3. WebTorrent trackers (rewrites the TRACKERS array in
#    patches/head/torrents/webtorrent-streaming.js; only the
#    repo's wss:// websocket list applies — udp/http announce is browser-unusable)
npm run sync-trackers

# 4. Rebuild (refreshes UPSTREAM.lock.json hashes after intentional changes)
node scripts/build.mjs --update-lock

# 5. Verify
npx playwright test            # 142 tests against the freshly built app/
node scripts/probe-core.mjs    # boots the site headlessly; confirms the WASM core initializes
node scripts/probe-server.mjs  # boots with a mock streaming server; confirms ?server= sync,
                                # StreamingServer.Reload, and the core's server client (all
                                # resources must reach Ready)

# 6. Manual TV smoke checklist (before deploying — the suite can't cover real hardware)
#    login · browse Board/Discover/Search · play a Real-Debrid stream · subtitles
#    on/off/size/language · Yellow key native-player handoff · settings toggles
#    (Vidaa TV category) · diagnostics panel (Green+Red) · exit button

# 7. Commit; CI re-runs the suite and deploys app/ to the gh-pages branch.
```

### If the new engine breaks the old UI

State-model drift between stremio-core versions can break the Theater UI in ways
the tests catch (or only the TV reveals). Bisect: `node scripts/sync-core.mjs
--version 0.60.2` (then repeat steps 3–4) until you find the newest version that
works, and pin that in `UPSTREAM.lock.json`. Git history holds every predecessor
— `git revert` the sync commit to roll back entirely.

## Everyday maintenance

- **Add a patch:** create `patches/head/<area>/<name>.js` (kernel/ for shared
  toolbox modules, a domain folder for features) and add its
  `{{patches/head/...}}` line to `patches/index.template.html` — the template
  is the manifest and fixes the inline order (the build fails if a patch file
  exists that the template doesn't inline, or if a kernel/ patch would inline
  after a feature patch). Head-region scripts run before the app's deferred
  scripts, exactly like the old monolithic `index.html` did. Consume
  `window.__vidaaRuntime` (toast, logger, store, fetchTimeout, probeServer,
  onRegistryReady, serverConfigured, poll) instead of re-implementing those
  utilities — log via `var log = RT.logger('my-patch')` so every message
  carries the uniform `[vidaa:my-patch]` prefix, and register recurring timers
  through `RT.poll(fn, ms, { route, quiet })` so Quiet Player Mode can silence
  them (pass `quiet: false` only for safety- or playback-critical pollers).
- **Add a settings toggle:** register an item with
  `window.__registerVidaaSettingsItem({ id, type: 'toggle', label,
  description, lsKey, defaultValue, onToggle })` — that is the whole job.
  The settingsStore (kernel/settings-store.js) owns the registry, the settings
  UI (settings/settings-ui.js) renders the Vidaa TV section rows from it, and
  schema-derived resets (Safe Mode) pick up the `defaultValue` automatically.
  The settings.chunk.js edit is a thin seam that only delegates to
  `window.__vidaaSettingsRows(g, p)`; never hand-edit UI into the chunk JSON.
- **Add a diagnostics section:** register with
  `window.__vidaaRegisterDiagnostic({ id, label, render(bodyEl) })` — the
  unified panel (kernel/diagnostics-registry.js) renders it as a tab next to
  Device / Debug Blob / Playback / Stream Stats / Torrent. Legacy entry points
  (`__showVidaaDiagnostics`, `__showPlaybackDiagnostics`,
  `__showVidaaDiagnostic`, the Green→Red combo) all open the same panel.
- **Bind a remote key:** register with
  `window.__vidaaKeys.on(key, handler, opts)` — never add your own
  keydown listener. Keys are names from the dispatcher's map (red, green,
  yellow, blue, info, i, channelUp, channelDown, back, f, escape,
  bracketLeft, bracketRight, or '*'); opts: `route` ('player'/'nonplayer'),
  `when(e)` (live predicate), `shift`, `priority` (higher wins; reserved
  1000 modal-close, 900 F-suppress, 800 back-dismiss, 500 combos), and
  `suppress` (preventDefault + stopPropagation, consuming the press).
  `'green+red'` declares a sequence combo with `opts.window` ms.
- **Ship a version bump:** set `"siteVersion"` in `package.json` (drives the
  `?v=N` cache-bust, the on-screen badge, and the service-worker cache name).
  Run a build so the stamp lands everywhere.
- **Never edit `upstream/` by hand.** If a chunk truly needs a change, add an op
  to `patches/chunk-edits/<chunk>.json` (`find` must match exactly once) or a new
  patch script. `UPSTREAM.lock.json` hashes will tell on you anyway.

## Provenance

- **Theater chunks**: the UI is Stremio's official Hisense/VIDAA TV app,
  distributed compiled-only from Stremio's CDN
  (`https://wn7lso8ghdka.stremio.com/hisense/<version>/`; no open-source repo —
  Stremio/stremio-web is a different, mouse-first app, and the CDN keeps only
  the current version). Chain of custody, oldest to newest:
  1. [ananjaser1211/stremio-hisense-tvos](https://github.com/ananjaser1211/stremio-hisense-tvos)
     commit `eafda4a` ("Hisense WebOS 1.9.2 Dump", 2025-11-08) — a static dump
     of the CDN app (that repo's commits are CDN dumps; "WebOS" there is a
     misnomer, Hisense runs VIDAA). The CDN no longer serves 1.9.2, so this
     dump is the only surviving public copy.
  2. [NoobyGains/stremio-vidaa-tv](https://github.com/NoobyGains/stremio-vidaa-tv)
     v6 (commit `8775223`, 2026-03-29) forked the dump: kept every UI,
     translation and asset chunk byte-identical (blob-hash verified), edited
     `main.js`, `index.html`, `runtime.js`, `service.js`, `core.chunk.js`,
     `1477.chunk.js`, `search.chunk.js` and `video.chunk.js`, and grafted the
     stremio-core-web v5 engine (`v5-worker.js`, WASM, `sw.js`). Its README
     credited the dump repo, then dropped the credit 15 minutes later
     (`54dd1b4`).
  3. This repo inherited that v6 tree and restructured it into
     `upstream/theater-1.9.2/` (restructure commit `9e2ea4a`), restoring the
     modified chunks to pristine and expressing the VIDAA edits as data in
     `patches/chunk-edits/`.
  4. **2026-10-08 re-baseline to 1.10.0**: the v6 lineage had fork mods baked
     into six upstream files (main.js, runtime.js, search/service/video chunks
     and the dead `1477.chunk.js` — referenced by nothing, dropped). The
     re-baseline took the 1.10.0 build PRISTINE from the live CDN (files
     Last-Modified 2025-12-05), cross-checked every file byte-identical
     against the community dump commit `6b44b10` ("Re-sync Hisense WebOS
     1.10.0 app dump"), and moved every surviving fork mod into
     `patches/chunk-edits/` (main, search, service, video JSONs) so upstream/
     is now fully pristine. The `runtime.js` `?v=5` cache-bust was dropped
     (the service worker normalizes query strings). Translation wrappers were
     re-baselined the same day — module ids changed wholesale in 1.10.0 and
     sk-SK/tl-TM/ur-PK were added, so the 1.9.2-era wrappers would never have
     loaded — then values re-synced from stremio-translations master.
  There is still no sync procedure for the UI: when Stremio ships 1.10.1,
  adopting it is another manual re-baseline (download from the CDN while it
  is live, cross-check against a fresh dump in the community repo, re-anchor
  every `find` in `patches/chunk-edits/`, re-anchor the two module ids in
  `patches/custom/core.chunk.js` (blob-worker-loader and worker-factory —
  find them via `n.e(<coreChunkId>)` in the new main.js), re-baseline the
  translation wrappers, then run the full verify ladder).
- **Engine**: `@stremio/stremio-core-web` from npm; `sync-core.mjs` bundles the
  package's CommonJS worker into a self-contained classic worker with esbuild.
- **Deployment**: GitHub Actions builds `app/` and force-pushes it to the
  `gh-pages` branch; GitHub Pages serves that branch.
