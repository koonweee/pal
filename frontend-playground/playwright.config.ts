import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5174);

export default defineConfig({
  testDir: './test',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    env: {
      PAL_BACKEND_URL: 'http://127.0.0.1:16991',
      PAL_DESKTOP_URL: 'http://127.0.0.1:16993',
    },
    reuseExistingServer: false,
  },
});
