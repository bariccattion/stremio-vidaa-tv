#!/usr/bin/env node
/*
 * Sync the stremio-core-web engine from npm into upstream/core-web/<version>/.
 *
 * The npm package (@stremio/stremio-core-web) ships CommonJS sources, not a
 * runnable worker: this script bundles package/worker.js (bridge + wasm glue)
 * into a self-contained classic-worker script with esbuild, shimming the
 * webpack-style `require('./stremio_core_web_bg.wasm')` to the relative URL
 * string 'stremio_core_web_bg.wasm' (resolved against the worker's own URL —
 * the same convention the 0.55.0 worker used via import.meta.url).
 *
 * Usage:
 *   node scripts/sync-core.mjs --version 0.64.1
 *
 * After running: review the diff, run `npm run build && npx playwright test`,
 * then commit. If the new core breaks the old Theater UI, bisect versions with
 * the same command (e.g. --version 0.60.2) — the lock keeps a single active
 * upstream/core-web/<version>/ and git history holds every predecessor.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const version = (args.find(a => a.startsWith('--version=')) || '').split('=')[1] || args[args.indexOf('--version') + 1];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/sync-core.mjs --version <x.y.z>');
  process.exit(1);
}
const die = (msg) => { console.error(`sync-core: ${msg}`); process.exit(1); };
const sh = (cmd, cmdArgs, cwd, opts = {}) => execFileSync(cmd, cmdArgs, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024, ...opts,
});

// 1. Fetch + unpack the npm tarball into a temp workspace.
const work = mkdtempSync(join(tmpdir(), 'core-sync-'));
try {
  const tarball = sh('npm', ['pack', `@stremio/stremio-core-web@${version}`], work).trim().split('\n').pop();
  sh('tar', ['xzf', tarball], work);
  sh('npm', ['install', '--no-fund', '--no-audit', '--ignore-scripts', `@stremio/stremio-core-web@${version}`, 'esbuild@0.25'], work);
} catch (e) { die(`npm pack/install failed: ${e.message}`); }

const pkgDir = join(work, 'package');
for (const f of ['worker.js', 'bridge.js', 'stremio_core_web.js', 'stremio_core_web_bg.wasm']) {
  if (!existsSync(join(pkgDir, f))) die(`npm package is missing ${f} — distribution format changed, review manually`);
}

// 2. Bundle worker.js into a self-contained classic worker (esbuild JS API).
const buildScript = `
const esbuild = require('esbuild');
const path = require('path');
const pkgDir = ${JSON.stringify(pkgDir)};
const wasmUrlPlugin = {
  name: 'wasm-url',
  setup(build) {
    build.onResolve({ filter: /\\.wasm$/ }, (args) => ({ path: args.path, namespace: 'wasm-url' }));
    build.onLoad({ filter: /.*/, namespace: 'wasm-url' }, () => ({
      contents: "module.exports = 'stremio_core_web_bg.wasm';",
      loader: 'js',
    }));
  },
};
esbuild.build({
  entryPoints: [path.join(pkgDir, 'worker.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2018'],
  outfile: ${JSON.stringify(join(work, 'v5-worker.js'))},
  plugins: [wasmUrlPlugin],
  logLevel: 'info',
}).catch(() => process.exit(1));
`;
writeFileSync(join(work, 'build-worker.cjs'), buildScript);
try { sh('node', ['build-worker.cjs'], work); } catch (e) { die('esbuild bundle failed'); }

// 3. Verify the bridge contract the old Theater main.js expects.
const worker = readFileSync(join(work, 'v5-worker.js'), 'utf8');
const RPC = ['init', 'getState', 'getDebugState', 'dispatch', 'analytics', 'decodeStream', 'onCoreEvent'];
const missing = RPC.filter(name => !worker.includes(name));
if (missing.length) die(`bundled worker is missing RPC surface: ${missing.join(', ')} — protocol changed, review manually`);
if (!worker.includes('stremio_core_web_bg.wasm')) die('bundled worker does not reference the wasm URL — shim failed');

// 4. Install into upstream/core-web/<version>/ (single active version).
const dest = join(root, 'upstream', 'core-web', version);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
copyFileSync(join(work, 'v5-worker.js'), join(dest, 'v5-worker.js'));
copyFileSync(join(pkgDir, 'stremio_core_web_bg.wasm'), join(dest, 'stremio_core_web_bg.wasm'));
for (const old of readdirSync(join(root, 'upstream', 'core-web'))) {
  if (old !== version) rmSync(join(root, 'upstream', 'core-web', old), { recursive: true, force: true });
}

// 5. Update lock metadata + refresh hashes via the build script.
const lockPath = join(root, 'UPSTREAM.lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
lock.components['core-web'].version = version;
lock.components['core-web'].dir = `upstream/core-web/${version}`;
lock.components['core-web'].origin = `@stremio/stremio-core-web@${version} (https://www.npmjs.com/package/@stremio/stremio-core-web, MIT). v5-worker.js is the package worker.js bundled self-contained by scripts/sync-core.mjs (esbuild, wasm required as relative URL 'stremio_core_web_bg.wasm').`;
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

// 6. Keep the core.chunk.js shim header honest.
const shimPath = join(root, 'patches', 'custom', 'core.chunk.js');
let shim = readFileSync(shimPath, 'utf8');
shim = shim.replace(/Loads v5 stremio-core-web \(.*?\) WASM backend/, `Loads v5 stremio-core-web (${version}) WASM backend`);
writeFileSync(shimPath, shim);

rmSync(work, { recursive: true, force: true });

const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
console.log(`sync-core: stremio-core-web ${version} installed`);
console.log(`  ${kb(join(dest, 'v5-worker.js'))} v5-worker.js, ${kb(join(dest, 'stremio_core_web_bg.wasm'))} wasm`);
console.log(`  RPC surface verified: ${RPC.join(', ')}`);
console.log('Next: npm run build && npx playwright test  — then run the TV smoke checklist before committing.');
