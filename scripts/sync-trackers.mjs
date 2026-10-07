#!/usr/bin/env node
/*
 * Sync the WebTorrent tracker list (patch 031) from ngosang/trackerslist.
 *
 * Public trackers decay constantly (btorrent.xyz is dead, openwebtorrent.com
 * intermittent), so the list is data, not code. ngosang/trackerslist is a bot
 * auto-checked list (dead trackers are pruned daily, sorted by popularity).
 * The repo splits trackers per announce protocol — 82 total at the time of
 * writing, but only its websocket list matters here:
 *
 *   trackers_all_ws.txt   wss:// — the ONLY kind a browser can announce to.
 *
 * Everything else (udp://, http(s)://, i2p, yggdrasil) requires a native
 * BitTorrent client; a browser has no raw UDP and webtorrent's tracker
 * client only speaks WebSocket announce. For belt and suspenders we also
 * scan trackers_all.txt for wss:// strays (currently zero).
 *
 * Plain ws:// entries are dropped: the app is served over HTTPS, and
 * browsers block insecure WebSocket from a secure context. The :443 default
 * port is stripped so diffs stay stable when upstream adds/removes it.
 *
 * Usage:
 *   node scripts/sync-trackers.mjs
 *
 * After running: review the diff, run `npm run build && npx playwright test`,
 * then commit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const die = (msg) => { console.error(`sync-trackers: ${msg}`); process.exit(1); };

const PATCH = join(root, 'patches', 'head', '031-webtorrent-streaming.js');
const BASE = 'https://raw.githubusercontent.com/ngosang/trackerslist/master';
const WS_LIST = `${BASE}/trackers_all_ws.txt`;
const ALL_LIST = `${BASE}/trackers_all.txt`;
const REF_API = 'https://api.github.com/repos/ngosang/trackerslist/commits?path=trackers_all_ws.txt&per_page=1';

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) die(`fetch failed: ${url} -> HTTP ${res.status}`);
  return res.text();
}

// 1. Fetch the websocket list, the catch-all list, and best-effort provenance
//    (the list's last commit — the raw endpoint doesn't tell you what you got).
const wsRaw = await fetchText(WS_LIST);
const allRaw = await fetchText(ALL_LIST);
let ref = 'unknown';
try {
  const res = await fetch(REF_API, { headers: { 'User-Agent': 'stremio-vidaa-tv (tracker sync)' } });
  if (res.ok) {
    const [commit] = await res.json();
    if (commit?.sha) ref = `${commit.sha.slice(0, 12)} (last bot update ${commit.commit?.committer?.date?.slice(0, 10) || 'unknown'})`;
  }
} catch { /* provenance is best-effort */ }

// 2. Extract + normalize. wss only, :443 stripped, upstream order preserved,
//    ws-list entries first then any strays from the catch-all list.
const normalize = (line) => line.trim().replace(/:443$/, '').replace(/\/$/, '');
const collect = (raw) => raw.split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const seen = new Set();
const trackers = [];
const dropped = [];
for (const line of [...collect(wsRaw), ...collect(allRaw)]) {
  const t = normalize(line);
  if (seen.has(t)) continue;
  seen.add(t);
  if (!line.startsWith('wss://')) dropped.push(t);
  else trackers.push(t);
}
if (trackers.length === 0) die('upstream lists contain no wss:// trackers — refusing to write an empty list');
if (dropped.length) console.log(`dropped ${dropped.length} non-wss entries (udp/http announce is unusable in a browser)`);

// 3. Rewrite the TRACKERS array in patch 031. The provenance comment above it
//    is part of the synced block — the sync replaces it wholesale.
const body = readFileSync(PATCH, 'utf8');
const arrayRe = /^[ \t]*var TRACKERS = \[[\s\S]*?\];/m;
if ((body.match(new RegExp(arrayRe.source, 'gm')) || []).length !== 1) {
  die('TRACKERS array did not match exactly once — patch 031 changed shape, review manually');
}
const oldTrackers = (body.match(/var TRACKERS = \[([\s\S]*?)\];/) || ['', ''])[1]
  .split(',')
  .map((s) => s.trim().replace(/^'|'$/g, ''))
  .filter(Boolean);

const added = trackers.filter((t) => !oldTrackers.includes(t));
const removed = oldTrackers.filter((t) => !trackers.includes(t));

const provenance = `    // Synced from ngosang/trackerslist trackers_all_ws.txt @ ${ref} (last bot update); synced ${new Date().toISOString().slice(0, 10)} by scripts/sync-trackers.mjs`;
const replacement = `${provenance}\n    var TRACKERS = [\n${trackers.map((t) => `        '${t}'`).join(',\n')}\n    ];`;

let next = body.replace(/^ *\/\/ Synced from ngosang\/trackerslist[^\n]*\n/m, '');
next = next.replace(arrayRe, () => replacement);
writeFileSync(PATCH, next);

// 4. The patch is inlined into index.html at build — it must stay parseable.
try {
  execFileSync(process.execPath, ['--check', PATCH], { stdio: 'pipe' });
} catch (e) {
  die(`rewritten patch no longer parses: ${e.stderr}`);
}

console.log(`synced ${trackers.length} wss trackers (list @ ${ref}):`);
for (const t of trackers) console.log(`  ${oldTrackers.includes(t) ? ' ' : '+'} ${t}`);
for (const t of removed) console.log(`  - ${t}`);
if (added.length === 0 && removed.length === 0) console.log('no changes to the tracker set');
