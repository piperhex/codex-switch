import { expect, test } from '@playwright/test';

test('connection details stay responsive during live traffic updates and wrap within 400px', async ({ page }, info) => {
  await page.goto('/e2e/connection-details-harness.html');
  await page.getByRole('button', { name: '查看设备连接详情' }).click();
  const popup = page.locator('.ant-popover-inner');
  await expect(popup).toContainText('Pixel 9');
  await expect(popup).toContainText('P2P 直连');
  await expect(popup).toContainText('Relay 转发');
  await expect(popup).toContainText('48 MB / 1 GB');
  const width = await popup.evaluate(node => node.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('connections.png') });
  await page.getByRole('button', { name: '界面响应检查 0' }).click();
  await expect(page.getByRole('button', { name: '界面响应检查 1' })).toBeVisible();
  await page.getByRole('button', { name: '断开测试设备' }).click();
  await page.getByRole('button', { name: '查看设备连接详情' }).click();
  await expect(page.locator('.ant-popover-inner')).toContainText('暂无设备连接到这台电脑。');
});
