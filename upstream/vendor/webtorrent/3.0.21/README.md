# Vendored WebTorrent 3.0.21

Pinned third-party artifact, hash-locked in `UPSTREAM.lock.json` like the other
upstream components. **Not written by hand — regenerate it with the commands
below when bumping the version.**

## What ships

| File | Source | Transform |
|---|---|---|
| `webtorrent.min.js` | `https://registry.npmjs.org/webtorrent/-/webtorrent-3.0.21.tgz` → `package/dist/webtorrent.min.js` | Bundled to classic IIFE + syntax lowered to ES2017 (see below) |
| `sw.min.js` | same tarball → `package/dist/sw.min.js` | none, as published |

## Why the transform

Upstream's `dist/webtorrent.min.js` is an **ES module** (`export { i as default }`) — a
classic `<script src>` tag cannot evaluate it, so `window.WebTorrent` would never
appear. It also ships untranspiled modern JS: real `?.` (48×), `??` (12×) and
`??=` (1×), which requires Chromium 85+ to even parse. VIDAA TV browsers are
older and the rest of this app (Stremio Theater 1.9.2) is deliberately
transpiled conservative. One-time transform at vendor time — not at build time —
keeps `scripts/build.mjs` toolchain-free:

```sh
curl -sL -o wt.tgz https://registry.npmjs.org/webtorrent/-/webtorrent-3.0.21.tgz
tar -xzf wt.tgz package/dist/webtorrent.min.js package/dist/sw.min.js
npx -y esbuild package/dist/webtorrent.min.js --bundle --format=iife \
  --global-name=WebTorrent --target=es2017 --minify --outfile=webtorrent.min.js
cp package/dist/sw.min.js sw.min.js
```

Then verify: `grep -cF '?.' webtorrent.min.js` (and `??`, `??=`, `||=`, `&&=`)
must all be 0, `node --check webtorrent.min.js` must pass, and update
`UPSTREAM.lock.json` with `node scripts/build.mjs --update-lock`.

`build.mjs` copies these two files to `app/webtorrent.min.js` (loaded by patch
031) and `app/webtorrent-sw.min.js` (importScripts'd by the app service worker).
