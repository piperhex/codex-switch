import { expect, test, type Page } from '@playwright/test';
import { navigate } from './chat-helpers';
import { messages } from '../src/i18n/messages';
import { setLanguage, t } from '../src/i18n';

const LANGUAGE_KEY = 'codex-switch.web.language.v1';

async function signIn(page: Page) {
  await page.goto('./');
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('review@example.test');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-review');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await page.getByRole('button', { name: '同意并登录' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function chooseEnglish(page: Page) {
  await navigate(page, '设置');
  await page.getByRole('button', { name: '语言 简体中文' }).click();
  await expect(page.getByRole('radio', { name: '简体中文' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
}

test('Chinese default, immediate English switch, persistence and switching back', async ({ page, request }, info) => {
  await request.post('http://127.0.0.1:1491/test/reset');
  await signIn(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await chooseEnglish(page);
  await expect(page.getByRole('button', { name: 'Language English' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto-refresh usage 30 minutes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toBeVisible();
  await expect(page.getByText('欢迎回来', { exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('settings-english.png') });
  await page.reload();
  await navigate(page, 'Settings');
  await expect(page.getByRole('button', { name: 'Language English' })).toBeVisible();
  await page.getByRole('button', { name: /About Codex Switch/ }).click();
  await expect(page.getByText('Web browser', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to settings' }).click();
  await navigate(page, 'Accounts');
  await expect(page.getByRole('button', { name: 'Show account emails' })).toBeVisible();
  await navigate(page, 'Devices');
  await expect(page.getByRole('heading', { name: 'Devices', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /More actions for/ }).last().click();
  await page.getByRole('menuitem', { name: 'Remove device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await navigate(page, '2FA');
  await expect(page.getByRole('textbox', { name: 'Search services or accounts' })).toBeVisible();
  await navigate(page, 'Settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Sign out of this account?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stay signed in' }).click();
  await page.getByRole('button', { name: 'Language English' }).click();
  await page.getByRole('radio', { name: '简体中文' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('button', { name: '语言 简体中文' })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_KEY)).toBe('zh');
});

test('invalid preference falls back to Chinese and language changes reach other tabs', async ({ page, context }) => {
  await page.addInitScript(key => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, 'unsupported');
  }, LANGUAGE_KEY);
  await signIn(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  const second = await context.newPage();
  await second.goto('./');
  await expect(second.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await chooseEnglish(page);
  await expect(second.locator('html')).toHaveAttribute('lang', 'en');
  await second.close();
});

test('language switching works when preference storage is unavailable', async ({ page }) => {
  await signIn(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Unavailable', 'SecurityError');
      original.call(this, name, value);
    };
  }, LANGUAGE_KEY);
  await chooseEnglish(page);
  await expect(page.getByRole('button', { name: 'Language English' })).toBeVisible();
});

test('translations keep placeholders intact and leave unknown content unchanged', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
  for (const [source, translated] of Object.entries(messages)) {
    expect(translated.trim(), source).not.toBe('');
    expect(placeholders(translated), source).toEqual(placeholders(source));
  }
  setLanguage('en');
  expect(t('“{value1}”再次登录桌面端后仍会重新出现在这里。', { value1: '我的电脑 {value1}' }))
    .toContain('我的电脑 {value1}');
  expect(t('A user-supplied title')).toBe('A user-supplied title');
  expect(t('toString')).toBe('toString');
  setLanguage('zh');
  expect(t('语言')).toBe('语言');
});
