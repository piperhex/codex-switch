import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: '**/remote-desktop.pw.ts', workers: 1, timeout: 60_000,
  outputDir: '../../.codex-tmp/remote-desktop-web', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1438/web/', channel: 'msedge', headless: true,
    // Only the isolated coturn test uses a generated, temporary certificate.
    launchOptions: { args: process.env.DESKTOP_RELAY_TEST_INSECURE_TLS === '1'
      ? ['--ignore-certificate-errors'] : [] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'portrait', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'landscape', use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1438 --strictPort',
    url: 'http://127.0.0.1:1438/web/', reuseExistingServer: true },
});
