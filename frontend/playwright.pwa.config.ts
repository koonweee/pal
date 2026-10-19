import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PWA_PORT ?? 4173);

export default defineConfig({
  testDir: 'test-pwa',
  workers: 1,
  timeout: 10_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    serviceWorkers: 'allow',
  },
  webServer: {
    command: `npm run preview -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    env: {
      PAL_BACKEND_URL: 'http://127.0.0.1:16991',
      PAL_DESKTOP_URL: 'http://127.0.0.1:16993',
    },
    reuseExistingServer: false,
  },
});
