import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  // Embed extraction launches headless Chrome — run sequentially to avoid resource exhaustion
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
  },
  webServer: {
    command: 'npx vite --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
