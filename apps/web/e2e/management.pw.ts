import { expect, test, type Page } from '@playwright/test';
import { navigate } from './chat-helpers';

async function closeSheet(page: Page) {
  const back = page.getByRole('button', { name: '返回上一层', exact: true });
  if (await back.isVisible()) await back.click();
  else await page.locator('.ant-modal-close:visible, .sheet-close[aria-label="关闭"]:visible').click();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const selector of ['.adaptive-sheet-content', '.account-details', '.verification-card']) {
    const fits = await page.locator(selector).evaluateAll(nodes =>
      nodes.every(node => node.scrollWidth <= node.clientWidth + 1));
    expect(fits).toBe(true);
  }
}

test.beforeEach(async ({ page, request }) => {
  await request.post('http://127.0.0.1:1491/test/reset');
  await page.goto('./');
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('review@example.test');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-review');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByText('欢迎回来', { exact: true })).toBeVisible();
  await expect(page.getByText('欢迎回来', { exact: true })).toBeHidden();
});

test('account overview, private details, 2FA, and nested sheets', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await navigate(page, '账号');
  await expect(page.locator('.account-row')).toHaveCount(4);
  await expect(page.locator('.account-row').first()).not.toContainText('alex@example.test');
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('accounts.png') });
  await page.getByRole('button', { name: '显示账号邮箱' }).click();
  await expect(page.locator('.account-row').first()).toContainText('alex@example.test');
  await page.getByRole('button', { name: 'alex@example.test 的账号信息' }).click();
  await expect(page.getByRole('button', { name: '复制当前验证码', exact: true })).toHaveText(/\d{6}/);
  await expect(page.locator('.account-info-row').filter({ hasText: '到期时间' })).toContainText('2027-10-01');
  await page.screenshot({ path: info.outputPath('account-details-top.png') });
  await expect(page.locator('.account-info-row').filter({ hasText: '密码' })).not.toContainText('sample-password');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(page.locator('.account-info-row').filter({ hasText: '密码' })).toContainText('sample-password');
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
  await page.screenshot({ path: info.outputPath('account-details.png') });
  await page.getByRole('button', { name: '查看完整备注' }).click();
  await expect(page.locator('.account-full-note')).toContainText('完整内容');
  await closeSheet(page);
  await page.getByRole('button', { name: '查看重置卡详情' }).click();
  await expect(page.locator('.reset-credit-summary')).toContainText('1 张');
  await page.getByRole('button', { name: '使用重置卡', exact: true }).click();
  await expect(page.getByText('确认使用重置卡？')).toBeVisible();
  await page.getByText('取消', { exact: true }).click();
  await expect(page.locator('.reset-credit-summary')).toContainText('1 张');
  await closeSheet(page);
  await page.getByRole('button', { name: '编辑账号信息' }).click();
  await expect(page.getByRole('button', { name: '保存账号信息' })).toBeVisible();
  await closeSheet(page);
  await expect(page.getByRole('button', { name: '复制当前验证码', exact: true })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('2FA search, sorting, eight digits, editing and failed clipboard', async ({ page }, info) => {
  await navigate(page, '2FA');
  await page.getByRole('button', { name: '同步 2FA 密钥', exact: true }).click();
  await expect(page.locator('.verification-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '复制 AWS 验证码', exact: true })).toContainText(/\d{4} \d{4}/);
  await page.getByRole('textbox', { name: '搜索服务名称或账号' }).fill('review-1');
  await expect(page.locator('.verification-card')).toHaveCount(1);
  await expect(page.locator('.verification-card h2')).toHaveText('OpenAI');
  await page.getByRole('textbox', { name: '搜索服务名称或账号' }).fill('missing');
  await expect(page.getByText('没有找到匹配的账号')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索服务名称或账号' }).fill('');
  await page.getByRole('button', { name: '验证码排序' }).click();
  await page.getByRole('menuitem', { name: '按服务名称' }).click();
  await expect(page.locator('.verification-card h2').first()).toHaveText('AWS');
  await page.getByRole('heading', { name: '2FA 验证码' }).click();
  await expect(page.getByText('已获取云端 2FA 密钥', { exact: true })).toBeHidden();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('totp.png') });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('denied'); } },
  }));
  await page.getByRole('button', { name: '复制 AWS 验证码', exact: true }).click();
  await expect(page.getByText('复制失败，请重试')).toBeVisible();
  await page.getByRole('button', { name: '管理 AWS 的 2FA 密钥' }).click();
  await page.getByRole('menuitem', { name: '编辑密钥' }).click();
  await expect(page.getByRole('textbox', { name: '服务名称', exact: true })).toHaveValue('AWS');
  await page.getByRole('button', { name: '保存密钥' }).click();
  await expect(page.getByRole('button', { name: '复制 AWS 验证码', exact: true })).toContainText(/\d{4} \d{4}/);
});

test('grouped settings, persisted interval, shared sync and about', async ({ page }, info) => {
  await navigate(page, '设置');
  await page.screenshot({ path: info.outputPath('settings.png') });
  await page.getByRole('button', { name: /自动刷新用量/ }).click();
  await page.getByRole('textbox', { name: '刷新间隔（分钟）' }).fill('0');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1 到 1440');
  await page.getByRole('textbox', { name: '刷新间隔（分钟）' }).fill('15');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: /自动刷新用量/ })).toContainText('15 分钟');
  await page.getByRole('button', { name: /2FA 密钥 未开启/ }).click();
  await page.getByRole('switch', { name: '云端同步' }).click();
  await closeSheet(page);
  await expect(page.getByRole('button', { name: /2FA 密钥 已开启/ })).toBeVisible();
  await page.getByRole('button', { name: /关于 Codex Switch/ }).click();
  await expect(page.getByText('Web 浏览器')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('about.png') });
  await page.getByRole('button', { name: '返回设置' }).click();
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.getByRole('textbox', { name: '新密码', exact: true }).fill('draft-password');
  await closeSheet(page);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '新密码', exact: true })).toHaveValue('');
  await closeSheet(page);
  await navigate(page, '2FA');
  await expect(page.locator('.verification-card')).toHaveCount(3);
  await page.reload();
  await navigate(page, '设置');
  await expect(page.getByRole('button', { name: /自动刷新用量/ })).toContainText('15 分钟');
});

test('slow refresh stays responsive and only one refresh runs', async ({ page }) => {
  await navigate(page, '账号');
  let calls = 0;
  let release: () => void = () => undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/sync/accounts/web-summary', async route => {
    calls += 1;
    await pending;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: '批量刷新用量' }).click();
    await expect(page.getByRole('button', { name: '批量刷新用量' })).toBeDisabled();
    await navigate(page, '设置');
    await page.getByRole('button', { name: /关于 Codex Switch/ }).click();
    await expect(page.getByText('Web 浏览器')).toBeVisible();
    expect(calls).toBe(1);
  } finally { release(); }
});

test('device model targets keep their selections separate', async ({ page }, info) => {
  await navigate(page, '设备');
  const open = async () => page.locator('.device-card').filter({ hasText: '我的工作电脑' })
    .getByRole('button', { name: /切换模型/ }).click();
  await open();
  await expect(page.getByRole('button', { name: '代理接口模型', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /alex@example.test 官方模型/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /工作分组 同时启用/ })).toBeVisible();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  await expect(page.getByRole('button', { name: /studio@example.test 官方模型/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /工作分组 同时启用/ })).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('gui-model-switch.png') });
  const guiRequest = page.waitForRequest('**/devices/sample-pc/gui-provider');
  await page.getByRole('button', { name: /测试 Provider test-model/ }).click();
  expect((await guiRequest).postDataJSON()).toEqual({ providerId: 'provider-1' });
  await expect(page.getByText('Codex GUI 模型已切换', { exact: true })).toBeVisible();
  await open();
  await expect(page.getByRole('button', { name: /alex@example.test 官方模型/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  await expect(page.getByRole('button', { name: /测试 Provider test-model/ })).toBeDisabled();
  const accountRequest = page.waitForRequest('**/devices/sample-pc/gui-account');
  await page.getByRole('button', { name: /studio@example.test 官方模型/ }).click();
  expect((await accountRequest).postDataJSON()).toEqual({ accountId: 'account-1' });
  await open();
  const proxyRequest = page.waitForRequest('**/devices/sample-pc/provider');
  await page.getByRole('button', { name: /测试 Provider test-model/ }).click();
  await proxyRequest;
  await open();
  await expect(page.getByRole('button', { name: /测试 Provider test-model/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  await expect(page.getByRole('button', { name: /studio@example.test 官方模型/ })).toBeDisabled();
});

test('pending GUI switch prevents duplicate actions and a failure preserves the selection', async ({ page }) => {
  await navigate(page, '设备');
  await page.locator('.device-card').filter({ hasText: '我的工作电脑' })
    .getByRole('button', { name: /切换模型/ }).click();
  await page.getByRole('button', { name: 'Codex GUI 模型', exact: true }).click();
  let calls = 0;
  let release: () => void = () => undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/devices/sample-pc/gui-provider', async route => {
    calls += 1;
    await pending;
    await route.fulfill({ status: 409, json: { message: '此账户已不可用，请重新选择。' } });
  });
  try {
    await page.getByRole('button', { name: /测试 Provider test-model/ }).click();
    await expect(page.getByRole('button', { name: '代理接口模型', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /alex@example.test 官方模型/ })).toBeDisabled();
    await expect(page.getByText('切换中', { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    await noOverflow(page);
  } finally { release(); }
  await expect(page.getByText('此账户已不可用，请重新选择。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /测试 Provider test-model/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /studio@example.test 官方模型/ })).toBeDisabled();
});
