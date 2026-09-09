import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: '**/chat.pw.ts', workers: 1, timeout: 90_000,
  outputDir: '../../.codex-tmp/h5-chat-playwright',
  reporter: [['list'], ['html', { outputFolder: '../../.codex-tmp/h5-chat-report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:1422/web/', channel: process.env.CHAT_TEST_BROWSER ?? 'msedge',
    headless: true, actionTimeout: 15_000, navigationTimeout: 20_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: [
    { command: 'node e2e/mobile-fixture.mjs', cwd: '../desktop', url: 'http://127.0.0.1:1490/test/state' },
    { command: 'npx vite --host 127.0.0.1 --strictPort', url: 'http://127.0.0.1:1422/web/',
      env: { VITE_DEV_API_URL: 'http://127.0.0.1:1490' } },
  ],
});
