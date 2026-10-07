#!/usr/bin/env node
/*
 * Sync translation chunks from Stremio/stremio-translations.
 *
 * Each upstream/translations/translationsN.chunk.js is a webpack chunk:
 *   (self.webpackChunkstremio_theater ||= []).push([[chunkId], { moduleId: E => { E.exports = JSON.parse('...') } }]);
 *
 * The language table lives in main.js module 9047: './<lang>.json': [moduleId, chunkId].
 * This script:
 *   1. parses every existing chunk (executing it against a fake webpack runtime),
 *   2. maps each chunk to its language via the main.js table,
 *   3. fetches the matching <lang>.json from Stremio/stremio-translations@master
 *      (falls back to a rename map for codes that moved, e.g. ca-CA -> ca-ES),
 *   4. merges: upstream values win for keys the old UI already has; old values
 *      are kept for keys upstream no longer carries (so no string goes raw),
 *   5. rewrites ONLY the JSON.parse('...') payload of each chunk, preserving the
 *      exact webpack wrapper, and validates each generated file by executing it.
 *
 * Usage: node scripts/sync-translations.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const die = (msg) => { console.error(`sync-translations: ${msg}`); process.exit(1); };

// Language codes that moved between the Theater build and stremio-translations.
const LANG_RENAMES = { 'ca-CA': 'ca-ES' };
const TRANSLATIONS_REPO = 'https://raw.githubusercontent.com/Stremio/stremio-translations/master';

// ---------- 1. Language table from main.js (module 9047) ----------
const mainJs = readFileSync(join(root, 'upstream', 'theater-1.9.2', 'main.js'), 'utf8');
const langTable = {}; // moduleId -> lang
{
  const anchor = mainJs.indexOf('"./ar-AR.json"');
  if (anchor === -1) die('language table not found in main.js');
  const seg = mainJs.slice(anchor, anchor + 8000);
  const re = /\.\/([a-zA-Z-]+\.json)"\s*:\s*\[(\d+),\s*(\d+)\]/g;
  let m;
  while ((m = re.exec(seg)) !== null) langTable[m[2]] = m[1].replace('.json', '');
}

// ---------- 2. Parse every existing chunk ----------
function parseChunk(file) {
  const src = readFileSync(file, 'utf8');
  const chunkId = src.match(/\[\s*\n?\s*\[(\d+)\]/) || die(`no chunk id in ${file}`);
  const exportsByModule = {};
  const savedSelf = global.self;
  global.self = {
    webpackChunkstremio_theater: {
      push(chunk) {
        const [, modules] = chunk;
        for (const [id, factory] of Object.entries(modules)) {
          exportsByModule[id] = factory; // run later for clean error attribution
        }
      },
    },
  };
  try {
    // Execute the chunk with our fake runtime in scope.
    const run = new Function('self', src.replace(/^"use strict";/, ''));
    run(global.self);
  } finally { global.self = savedSelf; }
  const moduleIds = Object.keys(exportsByModule);
  if (moduleIds.length !== 1) die(`${file}: expected 1 module, found ${moduleIds.length}`);
  const mod = moduleIds[0];
  const E = { exports: {} };
  exportsByModule[mod](E);
  const json = E.exports;
  if (typeof json !== 'object') die(`${file}: module did not export an object`);
  return { chunkId: Number(chunkId[1]), moduleId: Number(mod), json, src };
}

const chunksDir = join(root, 'upstream', 'translations');
const files = readdirSync(chunksDir).filter(f => /^translations\d+\.chunk\.js$/.test(f)).sort((a, b) =>
  Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
if (files.length === 0) die('no translation chunks found');

const parsed = files.map(f => {
  const p = parseChunk(join(chunksDir, f));
  const lang = langTable[String(p.moduleId)];
  if (!lang) {
    // e.g. the require.context 'package' chunk (translations31): main.js never
    // requests it — it stays untouched rather than failing the whole sync.
    return { file: f, ...p, lang: null };
  }
  return { file: f, ...p, lang };
});
console.log(`parsed ${files.length} chunks; ${Object.keys(langTable).length} table entries (${parsed.filter(p => !p.lang).length} non-language chunk(s) will be skipped)`);

// ---------- 3. Fetch upstream translations ----------
const work = mkdtempSync(join(tmpdir(), 'translations-'));
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });

// ---------- 4/5. Merge + rewrite ----------
function payloadFor(obj) {
  // Match webpack's JSON-module serialization: JSON string in single quotes,
  // escaping backslashes, single quotes, and 2028/2029 (JS line terminators).
  const json = JSON.stringify(obj)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return json;
}

const report = [];
for (const p of parsed) {
  if (!p.lang) { report.push(`(skip)\t${p.file} — module ${p.moduleId} is not a language chunk`); continue; }
  const upstreamLang = LANG_RENAMES[p.lang] || p.lang;
  let upstream;
  try {
    sh('curl', ['-sfL', `${TRANSLATIONS_REPO}/${upstreamLang}.json`, '-o', join(work, 'up.json')]);
    upstream = JSON.parse(readFileSync(join(work, 'up.json'), 'utf8'));
  } catch {
    report.push(`${p.lang}\tNO UPSTREAM FILE (${upstreamLang}.json) — chunk kept as-is`);
    continue;
  }

  const oldKeys = Object.keys(p.json);
  const common = oldKeys.filter(k => k in upstream);
  const updated = common.filter(k => p.json[k] !== upstream[k]);
  const merged = {};
  for (const k of oldKeys) merged[k] = common.includes(k) ? upstream[k] : p.json[k];

  if (common.length === 0) {
    report.push(`${p.lang}\tZERO KEY OVERLAP with upstream (${oldKeys.length} old keys) — chunk kept as-is`);
    continue;
  }

  const payload = payloadFor(merged);
  const next = p.src.replace(/(JSON\.parse\(')([\s\S]*?)('\))/, (mm, a, b, c) => a + payload + c);
  if (next === p.src) die(`${p.file}: failed to swap payload`);

  // Validate the rewritten file executes and yields the merged object.
  const check = parseChunkString(next, p.file);
  if (JSON.stringify(check.json) !== JSON.stringify(merged)) die(`${p.file}: validation mismatch after rewrite`);

  if (!dryRun) writeFileSync(join(chunksDir, p.file), next);
  report.push(`${p.lang}\t${oldKeys.length} keys | ${common.length} shared with upstream | ${updated.length} values updated | ${oldKeys.length - common.length} keys only in Theater (kept)`);
}
rmSync(work, { recursive: true, force: true });
console.log(report.sort().join('\n'));
if (dryRun) console.log('\n(dry run — nothing written)');

// Variant of parseChunk that takes source text (avoids read-before-write races).
function parseChunkString(src, label) {
  const exportsByModule = {};
  const fake = { webpackChunkstremio_theater: { push(chunk) {
    const [, modules] = chunk;
    for (const [id, factory] of Object.entries(modules)) exportsByModule[id] = factory;
  } } };
  new Function('self', src.replace(/^"use strict";/, ''))(fake);
  const mod = Object.keys(exportsByModule)[0];
  const E = { exports: {} };
  exportsByModule[mod](E);
  return { json: E.exports };
}
