const fs = require('fs');
const mainJs = fs.readFileSync('upstream/theater-1.9.2/main.js', 'utf8');
const runtime = fs.readFileSync('upstream/theater-1.9.2/runtime.js', 'utf8');

// table: lang -> [module, chunk]
const i0 = mainJs.indexOf('"./ar-AR.json"');
const seg = mainJs.slice(i0, mainJs.indexOf('function webpackContext', i0));
const table = {};
const re = /\.\/([a-zA-Z-]+(\.json)?)\"\s*:\s*\[(\d+),\s*(\d+)\]/g;
let m;
while ((m = re.exec(seg)) !== null) table[m[1].replace('.json', '')] = { module: m[3], chunk: m[4] };

// runtime chunk map: id -> "name"
const rt = {};
const rtRe = /(\d+):\s*\"([a-zA-Z0-9]+)\"/g;
while ((m = rtRe.exec(runtime)) !== null) rt[m[1]] = m[2];

// files: parse header ids
const files = fs.readdirSync('upstream/translations').filter(f => /^translations\d+\.chunk\.js$/.test(f));
const fileInfo = {};
for (const f of files) {
  const src = fs.readFileSync('upstream/translations/' + f, 'utf8');
  const ids = src.match(/\[\s*\r?\n?\s*\[(\d+)\],\s*\{\s*\r?\n?\s*(\d+):/);
  fileInfo[f] = { chunk: ids[1], module: ids[2] };
}

let anomalies = 0;
for (const [lang, { module, chunk }] of Object.entries(table)) {
  const fname = rt[chunk];
  if (!fname) { console.log(`${lang}: chunk ${chunk} NOT in runtime map`); anomalies++; continue; }
  const file = `${fname}.chunk.js`;
  const fi = fileInfo[file];
  if (!fi) { console.log(`${lang}: runtime says ${file} but file missing`); anomalies++; continue; }
  if (fi.chunk !== chunk) { console.log(`${lang}: ${file} has chunkId ${fi.chunk}, expected ${chunk}`); anomalies++; }
  if (fi.module !== module) { console.log(`${lang}: ${file} has moduleId ${fi.module}, expected ${module} <- MODULE MISMATCH`); anomalies++; }
}
// reverse: files not reachable from table
const reachable = new Set(Object.values(table).map(t => `${rt[t.chunk]}.chunk.js`));
for (const f of files) if (!reachable.has(f)) console.log(`orphan file: ${f} (chunk ${fileInfo[f].chunk}, module ${fileInfo[f].module})`);
console.log(`\ntable entries: ${Object.keys(table).length}, files: ${files.length}, anomalies: ${anomalies}`);
