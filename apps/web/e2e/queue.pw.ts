import { test, expect } from '@playwright/test';
import { connect, send, state, fixtureUrl, operationCount } from './chat-helpers';

test('queues supplements on the PC, sends one immediately and restores the rest after reconnecting',
  async ({ page, request }) => {
    await request.post(`${fixtureUrl}/test/reset`);
    await page.goto('./');
    await page.getByPlaceholder('name@example.com').fill('mobile-test@example.test');
    await page.getByPlaceholder('输入登录密码').fill('local-test');
    await page.getByRole('button', { name: '登录并查看' }).click();
    await connect(page);
    await page.getByRole('button', { name: '打开聊天列表' }).click();
    await page.getByRole('button', { name: /移动端聊天体验/ }).click();
    await send(page, 'slow queue test');
    await expect(page.getByRole('button', { name: '暂停生成' })).toBeVisible();
    await send(page, '先检查边界情况');
    await send(page, '再补充回归测试');
    const queue = page.getByRole('region', { name: '待发送消息', exact: true });
    await expect(queue.getByRole('listitem')).toHaveCount(2);
    const streamed = await page.locator('.chat-markdown').last().innerText();
    await expect.poll(() => page.locator('.chat-markdown').last().innerText()).not.toBe(streamed);
    expect(await operationCount(request, 'steer')).toBe(0);
    await queue.getByRole('listitem').filter({ hasText: '先检查边界情况' })
      .getByRole('button', { name: '立即发送' }).click();
    await expect(queue.getByRole('listitem')).toHaveCount(1);
    expect(await operationCount(request, 'steer')).toBe(1);
    await request.post(`${fixtureUrl}/test/disconnect`);
    await expect(page.getByRole('status').filter({ hasText: /P2P|Relay/ }))
      .toBeVisible({ timeout: 20_000 });
    await expect(queue).toContainText('再补充回归测试');
    await page.setViewportSize({ width: 390, height: 480 });
    const bounds = (await queue.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await queue.getByRole('button', { name: '删除待发送消息' }).click();
    await expect(queue).toHaveCount(0);
    await send(page, '自动发送的后续消息');
    await expect(queue).toContainText('自动发送的后续消息');
    await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'complete' } });
    await expect(queue).toHaveCount(0);
    await expect.poll(async () => (await state(request)).operations.filter((entry) => entry.operation === 'send')
      .at(-1)?.text).toBe('自动发送的后续消息');
  });
