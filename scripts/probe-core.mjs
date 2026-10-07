// One-off probe: boot the built app and confirm the core-web WASM worker initializes.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8123;
const serveJs = createRequire(import.meta.url).resolve('serve/build/main.js');
// Spawn serve directly (no npx shell wrapper) so .kill() actually stops it on Windows.
const serve = spawn(process.execPath, [serveJs, 'app', '-l', String(PORT), '--no-clipboard'], { cwd: root, stdio: 'ignore' });
const shutdown = () => serve.kill();
process.on('exit', shutdown);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => {
  if (m.type() === 'error' && !m.text().includes('PalmServiceBridge')) errors.push(m.text()); // webOS bridge is absent on desktop by design
});
page.on('pageerror', e => errors.push(String(e)));

// Wait for the server to accept connections (max ~10s).
let up = false;
for (let i = 0; i < 20 && !up; i++) {
  await new Promise(r => setTimeout(r, 500));
  up = await fetch(`http://localhost:${PORT}/`).then(() => true).catch(() => false);
}
if (!up) { console.error('probe: local server never came up'); await browser.close(); process.exit(1); }

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
// Wait up to 20s for the patch layer to observe a booted core (splash removal is driven by core readiness).
let coreState = null;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(500);
  coreState = await page.evaluate(() => ({
    hasCore: !!window.core,
    splashGone: !document.getElementById('splash'),
    patchVersion: window.__STREMIO_PATCH_VERSION__ || null,
    buildCommit: window.__BUILD_COMMIT__ || null,
  })).catch(() => null);
  if (coreState?.hasCore && coreState.splashGone) break;
}
console.log(JSON.stringify(coreState, null, 2));
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
serve.kill();
process.exit(coreState?.hasCore && coreState.splashGone && errors.length === 0 ? 0 : 1);
