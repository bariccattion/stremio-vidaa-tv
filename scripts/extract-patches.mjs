#!/usr/bin/env node
/*
 * One-time migration tool (Stage 0 of the restructure).
 * Splits the monolithic index.html into:
 *   - patches/head/NNN-slug.js   (verbatim inline patch scripts, load order = number)
 *   - patches/index.template.html (index.html with {{patches/...}} placeholders + {{VERSION}} stamps)
 * and derives patches/sw.template.js from sw.js.
 *
 * Verifies round-trip: template + patch files reassemble to the original
 * index.html byte-for-byte, except the intentional {{VERSION}} stamp lines.
 *
 * Safe to keep for provenance; never needs to run again.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

// Block start line (1-based) -> patch file slug, in document order.
const NAMES = {
  33: '001-server-url-config',
  47: '002-esc-helper',
  51: '003-vidaa-keyboard-fix',
  131: '004-build-commit-sw-register',
  151: '005-server-url-sync-to-core',
  188: '006-server-url-auto-reload',
  216: '007-dv-hdr-smart-handling',
  455: '008-error-messages-tv',
  482: '009-splash-screen',
  517: '010-resolution-indicator',
  592: '011-remote-color-buttons',
  718: '012-native-player-launcher',
  1029: '013-server-health-monitor',
  1073: '014-watchdog',
  1096: '015-memory-pressure-monitor',
  1110: '016-vidaa-api-integration',
  1210: '017-install-to-launcher-prompt',
  1299: '018-vidaa-diagnostics-blob',
  1719: '019-lazy-poster-loading',
  1741: '020-channel-seek',
  1775: '021-720p-zoom-correction',
  2007: '022-fkey-crash-suppress',
  2024: '023-exit-button',
  2037: '024-playback-speed-volume-persist',
  2113: '025-subtitle-size-fix',
  2170: '026-subtitle-language-memory',
  2271: '027-subtitle-off-option',
  2353: '028-native-handoff-title-watched',
  2371: '029-subtitle-full-filenames',
  2458: '030-prefetch-next-episode',
  2538: '031-webtorrent-streaming',
  2995: '032-vidaa-settings-community-features',
  4134: '033-low-memory-mode',
  4274: '034-auto-rebuffer',
  4520: '035-stream-stats-overlay',
  4730: '036-video-element-prep',
  4917: '037-quiet-player-mode',
  4963: '038-auto-native-player',
  5083: '039-pollers-honor-quiet-mode',
  5105: '040-honest-stall-messaging',
  5177: '041-vidaa-diagnostic-panel',
  5387: '042-heavy-stream-help',
};

const lineOf = (idx) => html.slice(0, idx).split('\n').length; // 1-based

const blockRe = /([ \t]*)<script\b([^>]*)>([\s\S]*?)<\/script>/g;
let m;
const blocks = [];
while ((m = blockRe.exec(html)) !== null) {
  const [, indent, attrs, inner] = m;
  if (/\bsrc\s*=/.test(attrs)) continue; // app entry scripts stay in the template
  const startLine = lineOf(m.index);
  const slug = NAMES[startLine];
  if (!slug) throw new Error(`No name mapped for inline script at line ${startLine}`);
  const contentMatch = inner.match(/^\n([\s\S]*?)\n?([ \t]*)$/);
  if (!contentMatch) throw new Error(`Unexpected script body shape at line ${startLine}`);
  blocks.push({ indent, attrs: attrs.trim(), content: contentMatch[1], closeIndent: contentMatch[2] || '', slug, startLine, full: m[0] });
}

if (blocks.length !== Object.keys(NAMES).length) {
  throw new Error(`Expected ${Object.keys(NAMES).length} inline blocks, found ${blocks.length}`);
}

mkdirSync(join(root, 'patches', 'head'), { recursive: true });
for (const b of blocks) {
  writeFileSync(join(root, 'patches', 'head', `${b.slug}.js`), b.content + '\n');
}

// Template: replace each inline block with open tag / placeholder / close tag.
let template = html;
for (const b of blocks) {
  const open = `${b.indent}<script${b.attrs ? ' ' + b.attrs : ''}>`;
  const replacement = `${open}\n{{patches/head/${b.slug}.js}}\n${b.closeIndent}</script>`;
  template = template.replace(b.full, replacement);
}

// Version stamps (the only content changes Stage 0 introduces).
template = template.replaceAll('?v=7', '?v={{VERSION}}');
template = template.replace(/>v7<\/div>/, '>v{{VERSION}}</div>');

writeFileSync(join(root, 'patches', 'index.template.html'), template);

// --- sw.template.js: same strategies, generated manifest + cache name ---
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const nl = sw.includes('\r\n') ? '\r\n' : '\n';
const swTemplate = sw.replace(
  /^var CACHE_NAME = '[^']+';\r?\nvar ASSETS = \[[\s\S]*?\];/,
  `var CACHE_NAME = '{{CACHE_NAME}}';${nl}var ASSETS = {{ASSETS}};`
);
if (swTemplate === sw) throw new Error('sw.js header did not match expected shape');
writeFileSync(join(root, 'patches', 'sw.template.js'), swTemplate);

// --- Round-trip verification ---
let rebuilt = template.replaceAll('{{VERSION}}', '7');
for (const b of blocks) {
  const open = `${b.indent}<script${b.attrs ? ' ' + b.attrs : ''}>`;
  rebuilt = rebuilt.replace(
    `${open}\n{{patches/head/${b.slug}.js}}\n${b.closeIndent}</script>`,
    `${open}\n${b.content}\n${b.closeIndent}</script>`
  );
}
if (rebuilt === html) {
  console.log('round-trip: PERFECT (byte-identical)');
} else {
  const a = html.split('\n');
  const b2 = rebuilt.split('\n');
  const diffs = [];
  for (let i = 0; i < Math.max(a.length, b2.length); i++) {
    if (a[i] !== b2[i]) diffs.push(`  line ${i + 1}:\n    orig: ${JSON.stringify(a[i])}\n    new:  ${JSON.stringify(b2[i])}`);
  }
  console.log(`round-trip: ${diffs.length} differing lines`);
  console.log(diffs.slice(0, 10).join('\n'));
  process.exitCode = 1;
}
console.log(`extracted ${blocks.length} patch blocks -> patches/head/`);
