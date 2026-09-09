import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { click, connect, navigate, operationCount, send, settled, screenshot, state, fixtureUrl } from './chat-helpers';

interface Journey { page: Page; request: APIRequestContext; info: TestInfo; transport?: 'direct' | 'either' }
const ready = (page: Page, transport?: Journey['transport']) => expect(page.getByRole('status')
  .filter({ hasText: transport === 'either' ? /已直连|通过服务器连接/ : '已直连' }))
  .toBeVisible({ timeout: 16_000 });

async function initialChat({ page, request, info, transport }: Journey) {
  await connect(page);
  await ready(page, transport);
  await click(page.getByRole('button', { name: /移动端聊天体验/ }));
  await expect(page.getByText('帮我整理今天的工作计划。')).toBeVisible();
  await send(page, 'H5 regression message');
  await expect(page.locator('.chat-markdown pre')).toHaveText('const connected = true;');
  await settled(page);
  expect(await operationCount(request, 'send')).toBe(1);
  if (transport !== 'either') expect((await state(request)).relayFrames).toBe(0);
  await screenshot(page, info, '01-connected-chat');
}

async function settingsAndSteer({ page, request }: Journey) {
  await click(page.getByRole('button', { name: /沿用电脑模型/ }));
  await page.getByLabel('模型', { exact: true }).selectOption('test-model');
  await page.getByLabel('思考深度', { exact: true }).selectOption('high');
  await page.getByLabel('文件权限', { exact: true }).selectOption('read-only');
  await click(page.getByRole('button', { name: '完成', exact: true }));
  await send(page, 'slow task');
  await expect(page.getByRole('button', { name: '停止回复' })).toBeVisible();
  await send(page, 'additional detail', true);
  await expect.poll(() => operationCount(request, 'steer')).toBe(1);
  await click(page.getByRole('button', { name: '停止回复' }));
  await settled(page);
  expect((await state(request)).operations.filter((entry) => entry.operation === 'send').at(-1))
    .toMatchObject({ model: 'test-model', effort: 'high', access: 'read-only' });
}

async function approvals({ page, request, info }: Journey) {
  await send(page, 'approval accept');
  await expect(page.getByRole('region', { name: '需要你的确认' })).toBeVisible();
  await screenshot(page, info, '02-approval');
  await click(page.getByRole('button', { name: '允许这一次' }));
  await settled(page);
  await send(page, 'approval decline');
  await click(page.getByRole('button', { name: '拒绝', exact: true }));
  await settled(page);
  await send(page, 'question test');
  await page.getByRole('radio', { name: /继续验证/ }).check();
  await click(page.getByRole('button', { name: '提交回答' }));
  await settled(page);
  const decisions = (await state(request)).operations;
  expect(decisions.filter((entry) => entry.decision === 'accept')).toHaveLength(1);
  expect(decisions.filter((entry) => entry.decision === 'decline')).toHaveLength(1);
  expect(decisions.find((entry) => entry.answers)?.answers).toEqual({ choice: { answers: ['继续验证'] } });
}

async function manageHistory({ page, request }: Journey) {
  await click(page.getByRole('button', { name: '返回', exact: true }));
  await page.getByRole('textbox', { name: '搜索聊天' }).fill('不存在的任务');
  await click(page.getByRole('button', { name: '搜索', exact: true }));
  await expect(page.getByText('暂时没有聊天')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索聊天' }).fill('');
  await click(page.getByRole('button', { name: '搜索', exact: true }));
  await click(page.getByRole('button', { name: '最近聊天 ▾' }));
  await click(page.getByRole('button', { name: '新聊天', exact: true }));
  await send(page, 'new chat from H5');
  await settled(page);
  expect((await state(request)).threads).toHaveLength(2);
  await click(page.getByRole('button', { name: '归档', exact: true }));
  await click(page.getByRole('button', { name: '最近聊天 ▾' }));
  await click(page.getByRole('button', { name: /手机新聊天/ }));
  await click(page.getByRole('button', { name: '恢复', exact: true }));
  await click(page.getByRole('button', { name: '已归档 ▾' }));
  await click(page.getByRole('button', { name: /移动端聊天体验/ }));
}

async function recoverConnection({ page, request, info, transport }: Journey) {
  const before = await state(request);
  const sent = await operationCount(request, 'send');
  const reads = await operationCount(request, 'read');
  await request.post(`${fixtureUrl}/test/disconnect`);
  await expect.poll(async () => (await state(request)).mobileConnections).toBeGreaterThan(before.mobileConnections);
  await ready(page, transport);
  await expect.poll(() => operationCount(request, 'read')).toBeGreaterThan(reads);
  expect(await operationCount(request, 'send')).toBe(sent);
  await navigate(page, '账号');
  await expect.poll(async () => (await state(request)).connectedMobiles).toBe(0);
  await navigate(page, '聊天');
  await ready(page, transport);
  await expect(page.getByRole('heading', { name: '移动端聊天体验', exact: true })).toBeVisible();
  await request.post(`${fixtureUrl}/test/fallback`);
  await expect(page.getByRole('status').filter({ hasText: '通过服务器连接' })).toBeVisible();
  await send(page, 'message after direct interruption');
  await settled(page);
  expect((await state(request)).relayFrames).toBeGreaterThan(0);
  expect((await state(request)).streamErrors).toEqual([]);
  expect((await state(request)).errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, info, '03-relay-recovery');
}

export async function chatJourney(context: Journey) {
  const errors: string[] = [];
  context.page.on('pageerror', (error) => errors.push(error.message));
  await initialChat(context);
  await settingsAndSteer(context);
  await approvals(context);
  await manageHistory(context);
  await recoverConnection(context);
  expect(errors).toEqual([]);
}
