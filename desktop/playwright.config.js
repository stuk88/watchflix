const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  workers: 1,
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
