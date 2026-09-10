import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { click, connect, navigate, operationCount, send, settled, screenshot, state, fixtureUrl } from './chat-helpers';
import { sidebarJourney } from './chat-sidebar';

interface Journey { page: Page; request: APIRequestContext; info: TestInfo; transport?: 'direct' | 'either' }
const ready = (page: Page, transport?: Journey['transport']) => expect(page.getByRole('status')
  .filter({ hasText: transport === 'either' ? /已直连|通过服务器连接/ : '已直连' }))
  .toBeVisible({ timeout: 16_000 });

async function initialChat({ page, request, info, transport }: Journey) {
  await connect(page);
  await ready(page, transport);
  await expect(page.getByText('欢迎回来', { exact: true })).toHaveCount(0);
  await screenshot(page, info, '00-new-chat');
  await click(page.getByRole('button', { name: '打开聊天列表' }));
  await expect(page.getByRole('region', { name: '演示项目', exact: true })).toBeVisible();
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
  await click(page.getByRole('button', { name: /测试模型 · 中/ }));
  await chooseSetting(page, '模型', '测试模型');
  await chooseSetting(page, '推理强度', '高');
  await chooseSetting(page, '访问权限', '请求批准');
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

async function chooseSetting(page: Page, label: string, value: string) {
  await click(page.getByRole('button', { name: `设置${label}`, exact: true }));
  await click(page.getByRole('radio', { name: value, exact: true }));
  await expect(page.getByRole('button', { name: `设置${label}`, exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
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
  await click(page.getByRole('button', { name: '打开聊天列表', exact: true }));
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

async function imagePreview({ page, request, info }: Journey) {
  await send(page, 'image preview');
  await settled(page);
  for (const description of ['本地图片', '网络图片']) {
    const image = page.getByRole('img', { name: description, exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await click(page.getByRole('button', { name: '放大查看：本地图片', exact: true }));
  await expect(page.getByRole('dialog', { name: '本地图片' })).toBeVisible();
  await click(page.getByRole('button', { name: '关闭图片', exact: true }));
  expect(await operationCount(request, 'imagePreview')).toBeGreaterThan(0);
  await screenshot(page, info, '04-inline-images');
}

async function synchronizeComposer({ page, request, info }: Journey) {
  await request.post(`${fixtureUrl}/test/composer`, { data: {
    model: 'second-model', effort: 'xhigh', access: 'danger-full-access',
  } });
  await expect(page.getByRole('button', { name: /第二模型 · 极高/ })).toBeVisible();
  await click(page.getByRole('button', { name: /第二模型 · 极高/ }));
  await expect(page.locator('.chat-setting-entry')).toHaveCount(3);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '设置模型' })).toContainText('第二模型');
  await expect(page.getByRole('button', { name: '设置推理强度' })).toContainText('极高');
  await screenshot(page, info, '05-settings-menu');
  await click(page.getByRole('button', { name: '设置模型' }));
  await expect(page.getByRole('radio', { name: '第二模型', exact: true })).toBeChecked();
  await screenshot(page, info, '06-model-drawer');
  await click(page.getByRole('button', { name: '返回上一层' }));
  await expect(page.getByRole('button', { name: '设置模型' })).toBeVisible();
  for (const [label, access] of [['请求批准', 'read-only'], ['帮我批准', 'workspace-write'],
    ['完全访问', 'danger-full-access']]) {
    await chooseSetting(page, '访问权限', label);
    await expect.poll(async () => (await state(request)).composer.settings.access).toBe(access);
  }
  await chooseSetting(page, '模型', '测试模型');
  await chooseSetting(page, '推理强度', '高');
  await click(page.getByRole('button', { name: '完成', exact: true }));
  await expect(page.getByRole('button', { name: /测试模型 · 高/ })).toBeVisible();
  await send(page, 'send with synced settings');
  await settled(page);
  expect((await state(request)).operations.filter((entry) => entry.operation === 'send').at(-1))
    .toMatchObject({ model: 'test-model', effort: 'high', access: 'danger-full-access' });
  await screenshot(page, info, '05-synced-composer');
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
  await imagePreview(context);
  await synchronizeComposer(context);
  await sidebarJourney(context);
  expect(errors).toEqual([]);
}
