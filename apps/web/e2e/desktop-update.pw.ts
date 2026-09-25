import { expect, test } from '@playwright/test';

const harness = 'e2e/desktop-update-harness.html';
test.beforeEach(async ({ request }) => { await request.get('http://127.0.0.1:1459/reset'); });

test('reads versions over WS and confirms the installed version', async ({ page, request }) => {
  await page.goto(harness);
  await expect(page.getByText('1.5.0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.getByText('v1.6.0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '安装更新', exact: true }).click();
  await expect(page.getByText(/安装后电脑端会重启/)).toBeVisible();
  let state = await (await request.get('http://127.0.0.1:1459')).json();
  expect(state.requests.filter((entry: { action: string }) => entry.action === 'install')).toHaveLength(0);
  const width = await page.locator('.desktop-version').evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: `../../.codex-tmp/desktop-update-${test.info().project.name}.png` });
  await page.getByRole('button', { name: '安装并重启', exact: true }).click();
  await expect(page.getByText('电脑端已更新。', { exact: true })).toBeVisible();
  await expect(page.getByText('1.6.0', { exact: true })).toBeVisible();
  state = await (await request.get('http://127.0.0.1:1459')).json();
  expect(state.requests.filter((entry: { action: string }) => entry.action === 'install')).toHaveLength(1);
});

test('disables offline and legacy computers and avoids stale versions after selection', async ({ page }) => {
  await page.goto(harness);
  await page.getByLabel('选择电脑').selectOption('offline');
  await expect(page.getByText('电脑已离线，请打开电脑端后重试。')).toBeVisible();
  await expect(page.getByRole('button', { name: '检查更新', exact: true })).toBeDisabled();
  await page.getByLabel('选择电脑').selectOption('old');
  await expect(page.getByText('请先在电脑上更新 Codex Switch，再使用远程更新。')).toBeVisible();
  await expect(page.getByText('1.3.0', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '安装更新', exact: true })).toBeDisabled();
});

test('shows no update and keeps installation unavailable', async ({ page, request }) => {
  await request.get('http://127.0.0.1:1459/reset?scenario=latest');
  await page.goto(harness);
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.getByText('电脑端已是最新版本。')).toBeVisible();
  await expect(page.getByRole('button', { name: '安装更新', exact: true })).toBeDisabled();
});

test('shows download failure and restores retry controls', async ({ page, request }) => {
  await request.get('http://127.0.0.1:1459/reset?scenario=failure');
  await page.goto(harness);
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByRole('button', { name: '安装更新', exact: true }).click();
  await page.getByRole('button', { name: '安装并重启', exact: true }).click();
  await expect(page.getByText('安装更新失败，请稍后重试。')).toBeVisible();
  await expect(page.getByRole('button', { name: '检查更新', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '安装更新', exact: true })).toBeEnabled();
});
