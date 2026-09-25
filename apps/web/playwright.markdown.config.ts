import { defineConfig } from '@playwright/test';
import chatConfig from './playwright.chat.config';

export default defineConfig({
  ...chatConfig, testMatch: '**/chat-markdown.pw.ts',
  use: { ...chatConfig.use, channel: undefined },
  outputDir: '../../.codex-tmp/markdown-playwright',
  reporter: [['list']],
  projects: [
    { name: 'chromium-mobile', use: { channel: undefined, browserName: 'chromium',
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'webkit-mobile', use: { channel: undefined, browserName: 'webkit',
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { channel: undefined, browserName: 'chromium',
      viewport: { width: 1280, height: 900 } } },
  ],
});
