'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  webServer: [
    {
      command: 'npm run dev --prefix ../ui',
      port: 5173,
      reuseExistingServer: true,
      timeout: 60000,
    },
    {
      command: 'npm run start --prefix ../api',
      port: 3001,
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
