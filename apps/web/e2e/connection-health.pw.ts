import { expect, test } from '@playwright/test';

test('shows both public endpoints, wraps IPv6 and clears addresses on reconnect', async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('e2e/connection-health-harness.html');
  const panel = page.locator('.connection-health');
  const endpoints = panel.locator('.connection-health-addresses');
  await expect(endpoints.getByText('本机公网 IP 和端口', { exact: true })).toBeVisible();
  await expect(endpoints.getByText('电脑公网 IP 和端口', { exact: true })).toBeVisible();
  await expect(endpoints).toContainText('203.0.113.8:42123 · UDP');
  await expect(endpoints).toContainText('[2001:db8:1234:5678:abcd:ef01:2345:6789]:65535 · TCP');
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(400);
  expect(await endpoints.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await endpoints.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('public-endpoints.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(endpoints.getByText('尚未识别', { exact: true })).toHaveCount(2);
  await expect(endpoints).not.toContainText('203.0.113.8');
});
