const fs = require('fs');
const s = fs.readFileSync('upstream/translations/translations8.chunk.js', 'utf8'); // en-US per runtime map (chunk 8061)
const js = s.match(/JSON\.parse\('([\s\S]*?)'\)/);
// Execute the chunk properly for the payload, like sync-translations does:
const fake = { webpackChunkstremio_theater: { push(c) { globalThis.__f = Object.values(c[1])[0]; } } };
new Function('self', s.replace(/^"use strict";/, ''))(fake);
const E = { exports: {} }; globalThis.__f(E);
const old = E.exports;
const neu = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const common = Object.keys(old).filter(k => k in neu);
const changed = common.filter(k => old[k] !== neu[k]);
const kept = Object.keys(old).filter(k => !(k in neu));
console.log('changed keys:', changed.length);
for (const k of changed.slice(0, 10)) console.log(`  ${k}: ${JSON.stringify(old[k]).slice(0, 50)} -> ${JSON.stringify(neu[k]).slice(0, 50)}`);
console.log('kept (Theater-only) keys:', JSON.stringify(kept.map(k => [k, old[k]])));
