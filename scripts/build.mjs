#!/usr/bin/env node
/*
 * Assemble the deployable site (app/) from replaceable upstream artifacts plus
 * the VIDAA patch layer:
 *
 *   upstream/theater-1.9.2/*      pristine Theater 1.9.2 build (never hand-edited)
 *   upstream/core-web/<ver>/*     stremio-core-web worker + wasm (from npm)
 *   upstream/translations/*       translation chunks
 *   patches/custom/core.chunk.js  custom worker-factory shim (webpack chunk 9114)
 *   patches/chunk-edits/*.json    surgical {find, replace} ops applied to pristine
 *                                 chunks — each op must match EXACTLY once or the
 *                                 build fails loudly
 *   patches/head/NNN-*.js         ordered patch scripts, inlined into index.html
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

const die = (msg) => { console.error(`build: ${msg}`); process.exit(1); };
const sha256 = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');
const toLf = (s) => s.replace(/\r\n/g, '\n');

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

// ---------- 2. Assemble app/ ----------
rmSync(APP, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });

const copyIn = (abs, appRel) => {
  const dest = join(APP, appRel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(abs, dest);
  return dest;
};

for (const f of collectFiles(join(root, 'upstream', 'theater-1.9.2'), join(root, 'upstream', 'theater-1.9.2'))) copyIn(f.abs, f.rel);
for (const f of collectFiles(join(root, 'upstream', 'translations'), join(root, 'upstream', 'translations'))) copyIn(f.abs, f.rel);
{
  const coreDir = join(root, 'upstream', 'core-web', coreVersion);
  for (const f of collectFiles(coreDir, coreDir)) copyIn(f.abs, f.rel);
}
copyIn(join(root, 'patches', 'custom', 'core.chunk.js'), 'core.chunk.js');

// The installer UI is part of the deployed site (the DNS-spoof flow and the
// installer/ README reference it over HTTP), so it ships in app/ as well.
for (const f of collectFiles(join(root, 'installer'), join(root, 'installer'))) copyIn(f.abs, join('installer', f.rel));

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
const placeholderRe = /\{\{patches\/(head\/[0-9a-z-]+\.js)\}\}/g;
let ph;
while ((ph = placeholderRe.exec(html)) !== null) {
  const patchPath = join(root, 'patches', ph[1]);
  if (!existsSync(patchPath)) die(`template references missing patch ${ph[1]}`);
  const body = toLf(readFileSync(patchPath, 'utf8')).replace(/\n$/, '');
  html = html.replace(ph[0], () => body);
}
if (/\{\{patches\//.test(html)) die('unresolved {{patches/...}} placeholder in template');
html = html.replaceAll('{{VERSION}}', VERSION);
html = html.replace(/(__BUILD_COMMIT__ = ')[a-f0-9]+(')/, `$1${COMMIT}$2`);
writeFileSync(join(APP, 'index.html'), html);

// ---------- 5. sw.js ----------
let sw = toLf(readFileSync(join(root, 'patches', 'sw.template.js'), 'utf8'));
const assets = ['./', ...collectFiles(APP, APP).map(f => `./${f.rel}`).sort()];
sw = sw.replace('{{CACHE_NAME}}', `stremio-vidaa-v${VERSION}-${COMMIT}`)
       .replace('{{ASSETS}}', JSON.stringify(assets, null, 2));
if (/\{\{(CACHE_NAME|ASSETS)\}\}/.test(sw)) die('unresolved placeholder in sw.template.js');
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
