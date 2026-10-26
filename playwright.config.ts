import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 1,
  timeout: 65000, expect: { timeout: 10000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
  webServer: [
    { command: 'npx tsx tests/mock-api.ts', url: 'http://127.0.0.1:8790/health', reuseExistingServer: false },
    { command: 'npm run server', url: 'http://127.0.0.1:8787/health', reuseExistingServer: false,
      env: { TYPESAFE_API_KEY: 'jda-fake-test-key', TYPESAFE_BASE_URL: 'http://127.0.0.1:8790' } },
  ],
});
