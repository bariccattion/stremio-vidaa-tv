#!/usr/bin/env node
/*
 * One-time migration tool (Stage 0). Derives patches/chunk-edits/*.json —
 * the surgical edits that turn PRISTINE upstream chunks into the shipped ones —
 * by diffing the v6 baseline commit (8775223, pristine Theater 1.9.2 chunks)
 * against the current working tree.
 *
 * Each op must match its `find` string exactly once in the pristine chunk;
 * the generator escalates diff context until that holds, and the final gate is:
 * applying ops to pristine must reproduce the current file byte-for-byte.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = '8775223'; // v6 root commit: pristine Theater 1.9.2 chunks

const NOTES = {
  'player.chunk.js': [
    'Error display routed through window.__STREMIO_ERROR_ENHANCER__ (codec-specific TV error messages).',
  ],
  'video.chunk.js': [
    'forceTranscoding now also honors the window.__FORCE_TRANSCODE__ flag set by the Blue remote key / patch layer.',
    'Propagates the forced-transcode decision into the server URL params.',
    'Trailing newline added to the minified file.',
  ],
  'settings.chunk.js': [
    'STREMIO TV label row added to the Settings navigation list.',
    'Hand-written STREMIO TV settings section: readBool/writeBool/makeToggle helpers driving __registerVidaaSettingsItem/__registerCommunityToggle toggles.',
  ],
};

const CHUNKS = ['player.chunk.js', 'video.chunk.js', 'settings.chunk.js'];

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function parseHunks(diff) {
  const hunks = [];
  let cur = null;
  let sawNoNewlineMinus = false, sawNoNewlinePlus = false;
  for (const line of diff.split('\n')) {
    const h = line.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (h) { cur = []; hunks.push(cur); continue; }
    if (!cur) continue;
    if (line.startsWith(' ')) cur.push({ type: 'ctx', text: line.slice(1) });
    else if (line.startsWith('-')) cur.push({ type: 'minus', text: line.slice(1) });
    else if (line.startsWith('+')) cur.push({ type: 'plus', text: line.slice(1) });
    else if (line.startsWith('\\')) { if (cur.some(e => e.type === 'minus')) sawNoNewlineMinus = true; if (cur.some(e => e.type === 'plus')) sawNoNewlinePlus = true; }
  }
  return { hunks, sawNoNewlineMinus, sawNoNewlinePlus };
}

function countOccurrences(hay, needle) {
  if (needle.length === 0) return Infinity; // empty needle matches everywhere — never unique
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function applyOps(pristine, ops, fixEol) {
  let out = pristine;
  for (const op of ops) {
    if (countOccurrences(out, op.find) !== 1) return null;
    // Function replacer: a string replacement would interpret $&/$`/$' in op.replace.
    out = out.replace(op.find, () => op.replace);
  }
  if (fixEol === 'ensure' && !out.endsWith('\n')) out += '\n';
  if (fixEol === 'strip' && out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

mkdirSync(join(root, 'patches', 'chunk-edits'), { recursive: true });

for (const chunk of CHUNKS) {
  // Raw blobs on both sides — `git show` applies CRLF smudging on Windows;
  // blobs are the bytes GitHub Pages actually serves, and are pure LF.
  const pristine = git(['cat-file', 'blob', `${BASELINE}:${chunk}`]);
  const current = git(['cat-file', 'blob', `HEAD:${chunk}`]);

  let ops = null, fixEol = null;
  for (const ctxSize of [3, 10, 30, 80]) {
    const diff = git(['diff', `-U${ctxSize}`, BASELINE, 'HEAD', '--', chunk]);
    const { hunks, sawNoNewlineMinus, sawNoNewlinePlus } = parseHunks(diff);
    const candidate = [];
    for (const h of hunks) {
      const find = h.filter(e => e.type !== 'plus').map(e => e.text).join('\n');
      const replace = h.filter(e => e.type !== 'minus').map(e => e.text).join('\n');
      if (find === replace) continue;
      candidate.push({ find, replace });
    }
    if (sawNoNewlineMinus || sawNoNewlinePlus) {
      fixEol = current.endsWith('\n') && !pristine.endsWith('\n') ? 'ensure'
             : !current.endsWith('\n') && pristine.endsWith('\n') ? 'strip' : null;
    }
    if (candidate.every(op => countOccurrences(pristine, op.find) === 1)) {
      // Merge ops whose find strings overlap (adjacent hunks at high context).
      ops = candidate;
      break;
    }
  }
  if (!ops) throw new Error(`${chunk}: could not derive unique edit ops`);

  const result = applyOps(pristine, ops, fixEol);
  if (result !== current) {
    // Locate first divergence for the error message.
    let i = 0;
    while (i < result.length && i < current.length && result[i] === current[i]) i++;
    throw new Error(`${chunk}: applying derived ops does not reproduce current file (diverges at offset ${i}: ${JSON.stringify(current.slice(i, i + 80))} vs ${JSON.stringify(result.slice(i, i + 80))})`);
  }

  const notes = NOTES[chunk] || [];
  const def = {
    chunk,
    description: `Surgical edits turning the pristine Theater 1.9.2 ${chunk} into the VIDAA build. Derived from git baseline ${BASELINE}.`,
    ops: ops.map((op, i) => ({ note: notes[i] || '', ...op })),
    ...(fixEol ? { fixTrailingNewline: fixEol } : {}),
  };
  writeFileSync(join(root, 'patches', 'chunk-edits', `${chunk}.json`), JSON.stringify(def, null, 2) + '\n');
  console.log(`${chunk}: ${ops.length} op(s), fixEol=${fixEol || 'none'} — verified byte-identical to shipped file`);
}
