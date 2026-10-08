// @ts-check
const { defineConfig } = require('@playwright/test');

// 8080 everywhere by default; TEST_PORT exists because Windows machines can
// have 8080 inside a reserved exclusion range (Hyper-V/WSL) where binding
// fails with EACCES. Specs derive origins from the page, never hardcode it.
const PORT = Number(process.env.TEST_PORT) || 8080;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  workers: 4,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
  },
  webServer: {
    command: `node scripts/build.mjs && npx serve app -l ${PORT} --no-clipboard`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 60000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
