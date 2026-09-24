import { expect, test, type Page } from '@playwright/test';

async function credentials(page: Page) {
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('review@example.test');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-review');
}

test.beforeEach(async ({ page, request }) => {
  await request.post('http://127.0.0.1:1491/test/reset');
  await page.goto('./');
});

test('reading and cancelling do not log in; consent resumes one login', async ({ page }, info) => {
  let logins = 0;
  page.on('request', request => { if (request.url().endsWith('/auth/login')) logins++; });
  const checkbox = page.getByRole('checkbox', { name: '我已阅读并同意用户协议' });
  await expect(checkbox).not.toBeChecked();
  await page.getByRole('button', { name: '《用户协议》', exact: true }).click();
  const reader = page.getByRole('dialog', { name: 'Codex Switch 用户协议' });
  await expect(reader).toBeVisible();
  await expect(reader.getByText('九、联系与争议处理')).toBeAttached();
  expect(await reader.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('agreement-reader.png'), animations: 'disabled' });
  await reader.getByRole('button', { name: '关闭协议', exact: true }).last().click();
  await expect(checkbox).not.toBeChecked();
  await credentials(page);
  await page.getByRole('textbox', { name: '密码', exact: true }).press('Enter');
  const prompt = page.getByRole('dialog', { name: '请阅读并同意用户协议' });
  await expect(prompt).toBeVisible();
  expect((await prompt.boundingBox())!.width).toBeLessThanOrEqual(400);
  expect(logins).toBe(0);
  await page.screenshot({ path: info.outputPath('agreement-prompt.png'), animations: 'disabled' });
  await prompt.getByRole('button', { name: '暂不同意' }).click();
  await expect(checkbox).not.toBeChecked();
  expect(logins).toBe(0);
  await page.getByRole('button', { name: '登录并查看' }).click();
  await prompt.getByRole('button', { name: '《用户协议》', exact: true }).click();
  await expect(reader).toBeVisible();
  await reader.getByRole('button', { name: '关闭协议', exact: true }).last().click();
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: '同意并登录' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  expect(logins).toBe(1);
});

test('checked consent signs in directly; unchecked consent returns to the prompt', async ({ page }) => {
  await credentials(page);
  const checkbox = page.getByRole('checkbox');
  await checkbox.check();
  await checkbox.uncheck();
  await page.getByRole('button', { name: '登录并查看' }).click();
  await page.getByRole('button', { name: '暂不同意' }).click();
  await checkbox.check();
  await page.getByRole('button', { name: '登录并查看' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('English agreement fits a short landscape screen', async ({ page }, info) => {
  await page.evaluate(() => localStorage.setItem('codex-switch.web.language.v1', 'en'));
  await page.setViewportSize({ width: 667, height: 375 });
  await page.reload();
  await page.getByRole('button', { name: 'User Agreement', exact: true }).click();
  const reader = page.getByRole('dialog', { name: 'Codex Switch User Agreement' });
  await expect(reader).toBeVisible();
  const bounds = (await reader.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reader.getByText('9. Contact and disputes').scrollIntoViewIfNeeded();
  await expect(reader.getByText('9. Contact and disputes')).toBeVisible();
  await page.screenshot({ path: info.outputPath('agreement-landscape-en.png'), animations: 'disabled' });
  await reader.getByRole('button', { name: 'Close agreement', exact: true }).last().click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
});

test('agreement remains readable while a login request is pending', async ({ page }) => {
  let release!: () => void;
  let logins = 0;
  await page.route('**/auth/login', async route => {
    logins++;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"登录失败，请重试"}' });
  });
  await credentials(page);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '登录并查看' }).click();
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await page.getByRole('textbox', { name: '密码', exact: true }).press('Enter');
  await page.getByRole('button', { name: '《用户协议》', exact: true }).click();
  const reader = page.getByRole('dialog', { name: 'Codex Switch 用户协议' });
  await expect(reader).toBeVisible();
  await reader.getByRole('button', { name: '关闭协议', exact: true }).last().click();
  expect(logins).toBe(1);
  release();
  await expect(page.getByRole('checkbox')).toBeEnabled();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await expect(page.locator('.form-error')).toBeVisible();
});
