#!/usr/bin/env node
/*
 * Assemble the deployable site (app/) from replaceable upstream artifacts plus
 * the VIDAA patch layer:
 *
 *   upstream/theater-<ver>/*       pristine Theater build (never hand-edited;
 *                                   dir resolved from UPSTREAM.lock.json)
 *   upstream/core-web/<ver>/*     stremio-core-web worker + wasm (from npm)
 *   upstream/translations/*       translation chunks
 *   upstream/vendor/webtorrent/   pinned webtorrent 3.0.21 bundles (see that
 *                                 dir's README.md — min.js is re-bundled to a
 *                                 classic ES2017 IIFE at vendor time)
 *   patches/custom/core.chunk.js  custom worker-factory shim (webpack chunk 9114)
 *   patches/chunk-edits/*.json    surgical {find, replace} ops applied to pristine
 *                                 chunks — each op must match EXACTLY once or the
 *                                 build fails loudly
 *   patches/head/<area>/<name>.js  patch scripts (kernel/ + domain folders),
 *                                 inlined into index.html in TEMPLATE order —
 *                                 the template is the manifest, not filenames
 *   patches/index.template.html   page skeleton with {{patches/...}}/{{VERSION}}
 *   patches/sw.template.js        service worker; cache manifest generated
 *
 * Verifies every upstream file against UPSTREAM.lock.json (SHA-256) before
 * building. Pass --update-lock to record new hashes after a sync. Pass
 * --compare-git=<ref> to diff the output against a git ref (e.g. the last
 * shipped site) — used as the Stage 0 no-behavior-change gate.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(root, 'app');
const args = process.argv.slice(2);
const compareRef = (args.find(a => a.startsWith('--compare-git=')) || '').split('=')[1];
const updateLock = args.includes('--update-lock');
// P2.1: minify the patch layer at inline time (output-only — patches/ sources
// stay readable). --no-minify ships the readable layer (debugging builds).
const minifyPatches = !args.includes('--no-minify');

const die = (msg) => { console.error(`build: ${msg}`); process.exit(1); };
const sha256 = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');
const toLf = (s) => s.replace(/\r\n/g, '\n');

// ES5 minification via esbuild. Inputs are ES5 by project rule, so this is
// pure minification (no transpilation surprises); a parse failure in a patch
// fails the build rather than silently shipping unminified.
let esbuild = null;
try { esbuild = await import('esbuild'); }
catch { die('esbuild not installed — run npm ci (it is a devDependency)'); }
function minifyEs5(code, what) {
  try {
    const r = esbuild.transformSync(code, { minify: true, target: 'es5', legalComments: 'none' });
    return r.code.replace(/\n$/, '');
  } catch (e) {
    die(`esbuild failed on ${what}: ${e.message}`);
  }
}

function git(args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch { return null; }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const VERSION = String(pkg.siteVersion || die('package.json missing "siteVersion"'));
const COMMIT = (git(['rev-parse', '--short', 'HEAD']) || 'nogit').trim();

// ---------- 1. Lock: verify (or record) upstream integrity ----------
const LOCK_PATH = join(root, 'UPSTREAM.lock.json');
const lock = existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, 'utf8')) : { schema: 1, components: {} };

function collectFiles(dir, base) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collectFiles(p, base));
    else out.push({ rel: relative(base, p).replaceAll('\\', '/'), abs: p });
  }
  return out;
}

const upstreamFiles = collectFiles(join(root, 'upstream'), root); // keys like theater-1.9.2/main.js
if (upstreamFiles.length === 0) die('upstream/ is empty');

let lockDirty = false;
for (const comp of Object.values(lock.components || {})) {
  if (updateLock) break; // update mode records the new state instead of verifying the old one
  for (const [rel, expected] of Object.entries(comp.files || {})) {
    const abs = join(root, 'upstream', rel);
    if (!existsSync(abs)) die(`lock mismatch: upstream/${rel} is missing (locked ${expected})`);
    if (!updateLock && sha256(readFileSync(abs)) !== expected) {
      die(`lock mismatch: upstream/${rel} does not match locked hash.\n` +
          `  If you intentionally replaced it, rerun with --update-lock after reviewing the change.`);
    }
  }
}
if (updateLock) {
  // Rebuild per-component file maps from the directory contents.
  for (const comp of Object.values(lock.components)) {
    if (!comp.dir) continue;
    const dirAbs = join(root, comp.dir);
    if (!existsSync(dirAbs)) continue;
    const prefix = comp.dir.replace(/^upstream\//, '');
    comp.files = {};
    for (const f of collectFiles(dirAbs, join(root, 'upstream'))) {
      comp.files[f.rel] = sha256(readFileSync(join(root, 'upstream', f.rel)));
    }
  }
  lockDirty = true;
}

// Which core-web version are we shipping?
const coreDirs = readdirSync(join(root, 'upstream', 'core-web'));
const coreVersion = lock.components?.['core-web']?.version
  ?? (coreDirs.length === 1 ? coreDirs[0] : die(`multiple upstream/core-web/* dirs and no lock entry: ${coreDirs.join(', ')}`));

// Which Theater build are we shipping? (dir recorded by the last sync/re-baseline)
const theaterDir = lock.components?.theater?.dir || die('UPSTREAM.lock.json has no theater dir');
if (!existsSync(join(root, theaterDir))) die(`theater dir ${theaterDir} does not exist`);

// ---------- 2. Assemble app/ ----------
rmSync(APP, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });

const copyIn = (abs, appRel) => {
  const dest = join(APP, appRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(abs, dest);
  return dest;
};

for (const f of collectFiles(join(root, theaterDir), join(root, theaterDir))) copyIn(f.abs, f.rel);
for (const f of collectFiles(join(root, 'upstream', 'translations'), join(root, 'upstream', 'translations'))) copyIn(f.abs, f.rel);
{
  const coreDir = join(root, 'upstream', 'core-web', coreVersion);
  for (const f of collectFiles(coreDir, coreDir)) copyIn(f.abs, f.rel);
}
copyIn(join(root, 'patches', 'custom', 'core.chunk.js'), 'core.chunk.js');

// Pinned WebTorrent (loaded by patches/head/torrents/webtorrent-streaming.js; sw.min.js is importScripts'd by the
// app service worker for its streaming server). Explicit copies, not a
// collectFiles sweep — the vendor dir's README.md is documentation, not a
// shipped asset.
copyIn(join(root, 'upstream', 'vendor', 'webtorrent', '3.0.21', 'webtorrent.min.js'), 'webtorrent.min.js');
copyIn(join(root, 'upstream', 'vendor', 'webtorrent', '3.0.21', 'sw.min.js'), 'webtorrent-sw.min.js');

// Nothing from installer/ ships in app/. The installer page only works on
// the vidaahub.com domain (VIDAA injects Hisense_*/HiUtils_* there), so it
// is served by the LOCAL DNS-spoof flow: installer/server.py serves the
// repo's installer/ folder while the page registers the DEPLOYED site as
// the app URL. Publishing it on gh-pages would be a dead, confusing copy —
// the tests load it straight from the repo instead (route fulfilment).

// ---------- 3. Apply chunk edits ----------
const editsDir = join(root, 'patches', 'chunk-edits');
for (const defFile of readdirSync(editsDir).filter(n => n.endsWith('.json')).sort()) {
  const def = JSON.parse(readFileSync(join(editsDir, defFile), 'utf8'));
  const target = join(APP, def.chunk);
  let text = toLf(readFileSync(target, 'utf8'));
  for (const [i, op] of def.ops.entries()) {
    const n = text.split(op.find).length - 1;
    if (n !== 1) {
      die(`${def.chunk} op #${i + 1} (${op.note || 'unnamed'}) matched ${n} times (expected exactly 1).\n` +
          `The upstream chunk no longer fits this patch — update patches/chunk-edits/${defFile}.`);
    }
    text = text.replace(op.find, () => op.replace);
  }
  if (def.fixTrailingNewline === 'ensure' && !text.endsWith('\n')) text += '\n';
  if (def.fixTrailingNewline === 'strip' && text.endsWith('\n')) text = text.slice(0, -1);
  writeFileSync(target, text);
}

// ---------- 4. index.html ----------
let html = toLf(readFileSync(join(root, 'patches', 'index.template.html'), 'utf8'));
// Kernel-first guard: within each script region (head = before the deferred
// app bundles, body = after), every kernel/ patch must inline before any
// feature patch, so load-time kernel calls always resolve. With the old NNN
// prefixes gone, this check is what keeps template edits from silently
// reordering the kernel behind a consumer.
{
  const boundary = html.indexOf('src="runtime.js?v={{VERSION}}"');
  if (boundary === -1) die('kernel-first guard: deferred bundle marker not found in the template');
  const orderRe = /\{\{patches\/(head\/[0-9a-z][0-9a-z-]*(?:\/[0-9a-z][0-9a-z-]*)*\.js)\}\}/g;
  const sawFeature = { head: false, body: false };
  let m;
  while ((m = orderRe.exec(html)) !== null) {
    const region = m.index < boundary ? 'head' : 'body';
    if (m[1].indexOf('head/kernel/') === 0) {
      if (sawFeature[region]) die(`kernel-first violation: ${m[1]} inlines after a feature patch in the ${region} region`);
    } else {
      sawFeature[region] = true;
    }
  }
}
const placeholderRe = /\{\{patches\/(head\/[0-9a-z][0-9a-z-]*(?:\/[0-9a-z][0-9a-z-]*)*\.js)\}\}/g;
const referenced = new Set();
let minifyStats = { files: 0, raw: 0, min: 0 };
let ph;
while ((ph = placeholderRe.exec(html)) !== null) {
  const patchPath = join(root, 'patches', ph[1]);
  if (!existsSync(patchPath)) die(`template references missing patch ${ph[1]}`);
  referenced.add(ph[1]);
  let body = toLf(readFileSync(patchPath, 'utf8')).replace(/\n$/, '');
  if (minifyPatches) {
    const min = minifyEs5(body, `patches/${ph[1]}`);
    minifyStats.files++;
    minifyStats.raw += body.length;
    minifyStats.min += min.length;
    // Path marker keeps the built artifact debuggable (which blob is which);
    // a leading comment cannot affect parsing.
    body = `/* ${ph[1]} */\n` + min;
  }
  html = html.replace(ph[0], () => body);
}
// Reverse check: a patch file the template forgot would silently never ship.
for (const f of collectFiles(join(root, 'patches', 'head'), join(root, 'patches'))) {
  if (!f.rel.endsWith('.js')) continue;
  if (!referenced.has(f.rel)) die(`patches/${f.rel} exists but the template never inlines it`);
}
if (/\{\{patches\//.test(html)) die('unresolved {{patches/...}} placeholder in the template');
html = html.replaceAll('{{VERSION}}', VERSION);
// Stamp tolerance: minified output drops the spaces around `=` and may
// requote the literal, so match both the readable and minified shapes.
const stampRe = /(__BUILD_COMMIT__\s*=\s*)(['"])[a-f0-9]+\2/;
if (!stampRe.test(html)) die('__BUILD_COMMIT__ stamp not found — platform/sw-register.js no longer matches the build stamp pattern');
html = html.replace(stampRe, (_m, head, q) => `${head}${q}${COMMIT}${q}`);
if (!(new RegExp(`__BUILD_COMMIT__\\s*=\\s*['"]${COMMIT}['"]`)).test(html)) die('__BUILD_COMMIT__ stamp failed to land in index.html');
writeFileSync(join(APP, 'index.html'), html);

// ---------- 5. sw.js ----------
let sw = toLf(readFileSync(join(root, 'patches', 'sw.template.js'), 'utf8'));
const assets = ['./', ...collectFiles(APP, APP).map(f => `./${f.rel}`).sort()];
sw = sw.replace('{{CACHE_NAME}}', `stremio-vidaa-v${VERSION}-${COMMIT}`)
       .replace('{{ASSETS}}', JSON.stringify(assets, null, 2));
if (/\{\{(CACHE_NAME|ASSETS)\}\}/.test(sw)) die('unresolved placeholder in sw.template.js');
// Deliberately NOT minified: sw.js is ~10 KB served once and cached by the
// browser, and tests/webtorrent.spec.js pins its assembled structure
// byte-level (the documented source exception) — the win isn't worth the churn.
writeFileSync(join(APP, 'sw.js'), sw);

if (lockDirty) {
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
  console.log('build: UPSTREAM.lock.json hashes updated');
}

// ---------- 6. Optional gate: compare against a git ref ----------
if (compareRef) {
  const shipBuf = (rel) => {
    try {
      return execFileSync('git', ['cat-file', 'blob', `${compareRef}:${rel}`], { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return null; }
  };
  const diffs = [];
  const appFiles = collectFiles(APP, APP);
  for (const f of appFiles) {
    const name = f.rel;
    const built = readFileSync(f.abs);
    const refBlob = shipBuf(name);
    if (refBlob === null) { diffs.push(`+ ${name} (not in ${compareRef})`); continue; }
    if (!built.equals(refBlob)) {
      if (/\.(png|ttf|wasm|ico)$/i.test(name)) { diffs.push(`~ ${name} (binary differs)`); continue; }
      const a = refBlob.toString('utf8').split('\n'), b = built.toString('utf8').split('\n');
      let first = -1, count = 0;
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) { if (first === -1) first = i + 1; count++; }
      }
      diffs.push(`~ ${name} (${count} line(s), first at ${first})`);
    }
  }
  // Files in the ref but not built (expected: index.html/sw.js always rebuilt; nothing else may vanish).
  const REPO_META = new Set(['package.json', 'package-lock.json', 'playwright.config.js', 'README.md', '.gitattributes', '.gitignore', 'UPSTREAM.lock.json', 'Dockerfile']);
  const refFiles = (git(['ls-tree', '--name-only', compareRef]) || '').split('\n').filter(Boolean);
  for (const f of refFiles) {
    if (REPO_META.has(f) || !/\.(js|html|png|ttf|svg|wasm)$/.test(f)) continue;
    if (!existsSync(join(APP, f))) diffs.push(`- ${f} (in ${compareRef}, not built!)`);
  }
  console.log(`compare[${compareRef}]: ${diffs.length} difference(s)`);
  diffs.forEach(d => console.log('  ' + d));
}

console.log(`build: app/ assembled (v${VERSION}, commit ${COMMIT}, core-web ${coreVersion})`);
if (minifyPatches) console.log(`build: patch layer minified — ${minifyStats.files} files, ${minifyStats.raw} → ${minifyStats.min} bytes (${Math.round((1 - minifyStats.min / minifyStats.raw) * 100)}% cut)`);
else console.log("build: patch minification DISABLED (--no-minify)");
