// One-off probe: boot the built app and confirm the core-web WASM worker initializes.
import { chromium } from '@playwright/test';

const serve = (await import('node:child_process')).spawn('npx', ['serve', 'app', '-l', '8090', '--no-clipboard'], { shell: true, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => {
  if (m.type() === 'error' && !m.text().includes('PalmServiceBridge')) errors.push(m.text()); // webOS bridge is absent on desktop by design
});
page.on('pageerror', e => errors.push(String(e)));

await page.goto('http://localhost:8090/', { waitUntil: 'load' });
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
