import { defineConfig } from '@playwright/test';
import browserConfig from './playwright.chat.config';

export default defineConfig({
  ...browserConfig, projects: [{ name: 'android-chrome' }], testMatch: '**/android-chat.pw.ts', timeout: 180_000,
  outputDir: '../../.codex-tmp/h5-android-playwright',
  reporter: [['list'], ['html', { outputFolder: '../../.codex-tmp/h5-android-report', open: 'never' }]],
});
