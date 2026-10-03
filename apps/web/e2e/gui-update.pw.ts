import { expect, test, type Page } from '@playwright/test';

async function openUpdate(page: Page, mode = '') {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto(`./e2e/gui-update-harness.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '打开头像菜单', exact: true }).click();
  await page.getByRole('button', { name: '更新 Codex GUI', exact: true }).click();
  await expect(page.getByText('我的电脑', { exact: true })).toBeVisible();
}
async function installs(page: Page) {
  const operations = JSON.parse(await page.getByTestId('operations').textContent() ?? '[]') as { operation: string }[];
  return operations.filter(value => value.operation === 'guiCliInstall');
}

test('avatar update checks, confirms and follows installation on the selected computer', async ({ page }, info) => {
  await openUpdate(page);
  await expect(page.getByText('v0.155.0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在检查更新…', exact: true })).toBeDisabled();
  await expect(page.getByText('v0.156.0', { exact: true })).toBeVisible();
  expect((await page.locator('.desktop-version').boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('gui-update.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '安装更新', exact: true }).click();
  expect(await installs(page)).toHaveLength(0);
  await page.getByRole('button', { name: '暂不安装', exact: true }).click();
  expect(await installs(page)).toHaveLength(0);
  await page.getByRole('button', { name: '安装更新', exact: true }).click();
  await page.getByRole('button', { name: '确认安装', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '50');
  await expect(page.getByRole('button', { name: '检查更新', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText('Codex GUI 已是最新版本。');
  expect(await installs(page)).toHaveLength(1);
  await expect(page.getByRole('button', { name: '安装更新', exact: true })).toBeDisabled();
});

for (const mode of ['offline', 'running', 'unsupported']) {
  test(`blocks unsafe or unnecessary installation: ${mode}`, async ({ page }) => {
    await openUpdate(page, mode);
    const check = page.getByRole('button', { name: '检查更新', exact: true });
    if (mode === 'offline') await expect(check).toBeDisabled();
    else await check.click();
    if (mode === 'unsupported') await expect(page.getByRole('alert')).toBeVisible();
    if (mode === 'running') await expect(page.getByRole('status')).toContainText('请等任务完成');
    await expect(page.getByRole('button', { name: '安装更新', exact: true })).toBeDisabled();
    expect(await installs(page)).toHaveLength(0);
  });
}

test('keeps the latest-version result after refreshing status and allows another check', async ({ page }, info) => {
  await page.clock.install();
  await openUpdate(page, 'latest');
  await expect(page.getByRole('status')).toHaveText('点击“检查更新”查看是否有新版本。');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在检查更新…', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText('Codex GUI 已是最新版本。');
  await expect(page.getByRole('button', { name: '已是最新', exact: true })).toBeEnabled();
  await page.clock.fastForward(30_000);
  const requests = JSON.parse(await page.getByTestId('operations').textContent() ?? '[]') as { operation: string }[];
  expect(requests.filter(value => value.operation === 'guiCliStatus').length).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('status')).toHaveText('Codex GUI 已是最新版本。');
  await expect(page.getByText('可用版本', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '安装更新', exact: true })).toBeDisabled();
  expect((await page.locator('.desktop-version').boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('gui-update-latest.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '已是最新', exact: true }).click();
  await page.clock.runFor(500);
  await expect(page.getByRole('button', { name: '已是最新', exact: true })).toBeEnabled();
  expect(await installs(page)).toHaveLength(0);
});

test('shows computer refusal and permits a confirmed retry', async ({ page }) => {
  await openUpdate(page, 'failure');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByRole('button', { name: '安装更新', exact: true }).click();
  await page.getByRole('button', { name: '确认安装', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请等任务完成');
  await page.getByRole('button', { name: '安装更新', exact: true }).click();
  await page.getByRole('button', { name: '确认安装', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Codex GUI 已是最新版本。');
  expect(await installs(page)).toHaveLength(2);
});
