// One-off live probe: does the 0.64.1 core accept the ?server= URL and actually
// talk to a streaming server? Boots the built app against a local mock server
// that logs every request it receives.
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_PORT = 8131;
const MOCK_PORT = 8124;

const requests = [];
// Shapes per the real stremio-server v3 API: /settings options is a SEQUENCE,
// /casting is a device list, /network-info and /device-info are objects.
const RESPONSES = {
  '/settings': { options: [{ id: 'cacheSize', type: 'switch', name: 'cacheSize', label: 'Cache size', value: '100', description: 'Cache size' }], values: { appPath: "/tmp/stremio-cache", cacheRoot: "/tmp/stremio-cache", serverVersion: "4.20.0", remoteHttps: "", cacheSize: 100, btMaxConnections: 100, btDownloadEnabled: true, btHandshakeTimeout: 10, btRequestTimeout: 10, btKnownMetadataTotal: 3, btKnownFilesTotal: 3, btKnownPeersTotal: 3, btDownloadSpeedSoftLimit: 0, btDownloadSpeedHardLimit: 0, btUploadSpeedSoftLimit: 0, btUploadSpeedHardLimit: 0, btMinPeersForStable: 3 }, baseUrl: `http://127.0.0.1:${MOCK_PORT}/`, remoteUrl: `http://127.0.0.1:${MOCK_PORT}/` },
  '/casting': [],
  '/network-info': { local_ip: '127.0.0.1', public_ip: '203.0.113.1', availableInterfaces: [] },
  '/device-info': { info: { model: 'probe', version: '1' } },
};
const mock = createServer((req, res) => {
  requests.push(`${req.method} ${req.url}`);
  const path = req.url.split('?')[0];
  const body = JSON.stringify(RESPONSES[path] ?? {});
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' });
  res.end(body);
});
mock.on('options', (req, res) => { requests.push(`OPTIONS ${req.url}`); res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' }); res.end(); });
await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));

const serveJs = createRequire(import.meta.url).resolve('serve/build/main.js');
const serve = spawn(process.execPath, [serveJs, 'app', '-l', String(SITE_PORT), '--no-clipboard'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => { serve.kill(); mock.close(); });

let up = false;
for (let i = 0; i < 20 && !up; i++) {
  await new Promise(r => setTimeout(r, 500));
  up = await fetch(`http://localhost:${SITE_PORT}/`).then(() => true).catch(() => false);
}
if (!up) { console.error('probe: site server never came up'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !t.includes('PalmServiceBridge')) errors.push(t);
  if (t.includes('[server-sync]') || t.includes('[server-watch]')) console.log('page>', t);
});
page.on('pageerror', e => errors.push(String(e)));

await page.goto(`http://localhost:${SITE_PORT}/?server=http://127.0.0.1:${MOCK_PORT}`, { waitUntil: 'load', timeout: 30000 });

// Give the sync patch (waits for window.core) and the core's server client time to run.
await page.waitForTimeout(12000);

const result = await page.evaluate(async () => {
  const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj ? obj[k] : undefined]));
  const ctx = await window.core.getState('ctx').catch(e => ({ err: String(e) }));
  const ss = await window.core.getState('streaming_server').catch(e => ({ err: String(e) }));
  return {
    settingsUrl: ctx?.profile?.settings?.streamingServerUrl ?? null,
    localStorageUrl: localStorage.getItem('stremio_server_url'),
    windowUrl: window.__STREMIO_SERVER_URL__ ?? null,
    streamingServerState: typeof ss === 'object' ? pick(ss, Object.keys(ss).slice(0, 12)) : ss,
  };
}).catch(e => ({ evalError: String(e) }));

console.log('core state:', JSON.stringify(result, null, 2));
console.log('mock server requests:', requests.length ? requests : 'NONE');
console.log('console errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();
mock.close(); serve.kill();

const norm = (u) => String(u || '').replace(/\/+$/, '');
const ok = norm(result.settingsUrl) === `http://127.0.0.1:${MOCK_PORT}`
  && requests.length > 0
  && result.streamingServerState?.settings?.type === 'Ready';
console.log(ok ? 'VERDICT: server integration WORKS (URL in core settings, core queried the server, settings resource Ready)' : 'VERDICT: PROBLEM — see above');
process.exit(ok ? 0 : 1);
