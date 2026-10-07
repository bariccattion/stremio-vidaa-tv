# Syncing with Stremio upstream

This repository is a **patch layer on top of replaceable Stremio artifacts**, not a
source fork. Keeping that separation mechanical is the whole point of the layout:

```
upstream/                  replaceable Stremio artifacts (never hand-edit)
  theater-1.9.2/           the compiled TV frontend (chunks, assets)
  core-web/<version>/      stremio-core-web engine (v5-worker.js + wasm)
  translations/            47 per-language translation chunks
UPSTREAM.lock.json         version + source URL + SHA-256 of every upstream file
patches/                   everything that makes this a VIDAA build
  head/001-*.js … 042-*.js ordered patch scripts, inlined into index.html at build
  chunk-edits/*.json       surgical {find, replace} ops on 3 pristine chunks
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

The compiled UI ("Stremio Theater 1.9.2") is an **unpublished** Stremio TV build;
it is not in the public Stremio/stremio-web repo (that repo is a different,
mouse-first app) and no newer version of it exists publicly. The syncable,
Stremio-published components are:

| Component | Source | Current |
|---|---|---|
| Engine | `@stremio/stremio-core-web` on npm (MIT) | 0.64.1 |
| Translations | [Stremio/stremio-translations](https://github.com/Stremio/stremio-translations) | master, synced 2026-10-07 |
| WebTorrent trackers | [ngosang/trackerslist](https://github.com/ngosang/trackerslist) websocket list | master, synced 2026-10-07 |
| TV frontend | none — frozen at Theater 1.9.2 | — |

## Sync procedure

```bash
# 1. Engine (find the latest version at https://www.npmjs.com/package/@stremio/stremio-core-web)
node scripts/sync-core.mjs --version 0.64.1

# 2. Translations (prints a per-language merge report)
node scripts/sync-translations.mjs

# 3. WebTorrent trackers (rewrites the TRACKERS array in patch 031; only the
#    repo's wss:// websocket list applies — udp/http announce is browser-unusable)
npm run sync-trackers

# 4. Rebuild (refreshes UPSTREAM.lock.json hashes after intentional changes)
node scripts/build.mjs --update-lock

# 5. Verify
npx playwright test            # 121 tests against the freshly built app/
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

- **Add a patch:** create `patches/head/043-my-patch.js`. It is inlined into
  `index.html` in filename order — head scripts run before the app's deferred
  scripts, exactly like the old monolithic `index.html` did.
- **Ship a version bump:** set `"siteVersion"` in `package.json` (drives the
  `?v=N` cache-bust, the on-screen badge, and the service-worker cache name).
  Run a build so the stamp lands everywhere.
- **Never edit `upstream/` by hand.** If a chunk truly needs a change, add an op
  to `patches/chunk-edits/<chunk>.json` (`find` must match exactly once) or a new
  patch script. `UPSTREAM.lock.json` hashes will tell on you anyway.

## Provenance

- **Theater 1.9.2 chunks**: inherited from [bariccattion/stremio-vidaa-tv](https://github.com/bariccattion/stremio-vidaa-tv)
  v6 baseline (commit `8775223`), which itself repackaged Stremio's unpublished
  TV web build. Pristine copies live in `upstream/theater-1.9.2/`; the three
  modified chunks (player, video, settings) are stored pristine there too, with
  the VIDAA edits expressed as data in `patches/chunk-edits/`.
- **Engine**: `@stremio/stremio-core-web` from npm; `sync-core.mjs` bundles the
  package's CommonJS worker into a self-contained classic worker with esbuild.
- **Deployment**: GitHub Actions builds `app/` and force-pushes it to the
  `gh-pages` branch; GitHub Pages serves that branch.
