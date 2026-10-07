const fs = require('fs');
const s = fs.readFileSync('upstream/theater-1.9.2/main.js', 'utf8');
const i = s.indexOf('"./ar-AR.json"');
// Find the table bounds: from the anchor to the closing of module 9047's object.
const endMarker = s.indexOf('function webpackContext', i);
const seg = s.slice(i, endMarker === -1 ? i + 20000 : endMarker);
const re = /\.\/([a-zA-Z-]+\.json)"\s*:\s*\[(\d+),\s*(\d+)\]/g;
let m; const rows = [];
while ((m = re.exec(seg)) !== null) rows.push(`${m[1].replace('.json','')} module=${m[2]} chunk=${m[3]}`);
console.log(rows.join('\n'));
console.log('count:', rows.length);
// module 1227 lookup
const hit = rows.find(r => r.includes('module=1227'));
console.log('module 1227 ->', hit || 'NOT FOUND');
// what does translations31 contain?
const t31 = fs.readFileSync('upstream/translations/translations31.chunk.js', 'utf8');
const idm = t31.match(/\[(\d+)\], \{\s*(\d+):/);
console.log('translations31 chunkId=', idm && idm[1], 'moduleId=', idm && idm[2]);
const jm = t31.match(/JSON\.parse\('([\s\S]{0,120})/);
console.log('translations31 starts:', jm && jm[1].slice(0, 100));
