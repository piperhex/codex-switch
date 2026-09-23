import { expect, test, type Page } from '@playwright/test';
import type { RemoteDevice } from '../src/types';
import { connect, fixtureUrl, login } from './chat-helpers';

const STORAGE_PREFIX = 'codex-switch.web.last-connected-device.v1';
const COMPUTER = 'computer';
const LAPTOP = 'laptop';

function computers(): RemoteDevice[] {
  return [
    { deviceId: 'offline', name: '离线电脑', online: false },
    { deviceId: COMPUTER, name: '我的工作电脑', online: true },
    { deviceId: LAPTOP, name: '另一台电脑', online: true },
  ].map((device) => ({ ...device, platform: 'Windows', capabilities: [],
    localProxyRunning: false, lastSeenAt: new Date().toISOString() }));
}

async function provideComputers(page: Page, devices: () => RemoteDevice[]) {
  // The local chat fixture routes every device ID to the same emulated computer.
  await page.route('**/devices', (route) => route.fulfill({ json: { devices: devices() } }));
  await page.routeWebSocket('**/device-switch', (socket) => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: 'devices-snapshot', devices: devices() })));
  });
}

async function rememberedComputer(page: Page) {
  return page.evaluate((prefix) => {
    const session = JSON.parse(localStorage.getItem('codex-switch.web.session.v1') ?? '{}');
    const key = `${prefix}.${encodeURIComponent(`${session.baseUrl}|${session.email.toLowerCase()}`)}`;
    return localStorage.getItem(key);
  }, STORAGE_PREFIX);
}

async function connectedTo(page: Page, name: string) {
  await expect(page.getByRole('button', { name: '选择电脑', exact: true })).toContainText(name);
  await expect(page.getByRole('status').filter({ hasText: /P2P|Relay/ })).toBeVisible({ timeout: 20_000 });
}

async function chooseLaptop(page: Page) {
  await page.getByRole('button', { name: '选择电脑', exact: true }).click();
  await page.getByRole('button', { name: '另一台电脑 在线', exact: true }).click();
}

test.beforeEach(async ({ request }) => {
  await request.post(`${fixtureUrl}/test/reset`);
});

test('remembers the first successful connection and restores a manually chosen computer after reload',
  async ({ page }) => {
    await provideComputers(page, computers);
    await login(page);
    await connect(page);
    await connectedTo(page, '我的工作电脑');
    await expect.poll(() => rememberedComputer(page)).toBe(COMPUTER);
    await chooseLaptop(page);
    await connectedTo(page, '另一台电脑');
    await expect.poll(() => rememberedComputer(page)).toBe(LAPTOP);
    await page.reload();
    await connect(page);
    await connectedTo(page, '另一台电脑');
    await expect.poll(() => rememberedComputer(page)).toBe(LAPTOP);
  });

for (const unavailable of ['offline', 'removed'] as const) {
  test(`connects to the first online computer when the remembered computer is ${unavailable}`, async ({ page }) => {
    let devices = computers();
    await provideComputers(page, () => devices);
    await login(page);
    await connect(page);
    await connectedTo(page, '我的工作电脑');
    await chooseLaptop(page);
    await connectedTo(page, '另一台电脑');
    await expect.poll(() => rememberedComputer(page)).toBe(LAPTOP);
    devices = unavailable === 'removed' ? devices.filter((device) => device.deviceId !== LAPTOP)
      : devices.map((device) => ({ ...device, online: device.deviceId === COMPUTER }));
    await page.reload();
    await connect(page);
    await connectedTo(page, '我的工作电脑');
    await expect.poll(() => rememberedComputer(page)).toBe(COMPUTER);
  });
}

test('keeps the remembered computer when no computers are online and restores it when available', async ({ page }) => {
  let devices = computers();
  await provideComputers(page, () => devices);
  await login(page);
  await connect(page);
  await connectedTo(page, '我的工作电脑');
  await chooseLaptop(page);
  await connectedTo(page, '另一台电脑');
  await expect.poll(() => rememberedComputer(page)).toBe(LAPTOP);
  devices = devices.map((device) => ({ ...device, online: false }));
  await page.reload();
  await connect(page);
  await expect(page.getByRole('button', { name: '选择电脑', exact: true })).toHaveText('选择电脑，开始聊天');
  expect(await rememberedComputer(page)).toBe(LAPTOP);
  devices = computers();
  await page.reload();
  await connect(page);
  await connectedTo(page, '另一台电脑');
});

test('only updates the remembered computer after a successful connection', async ({ page }) => {
  let rejectConnection = true;
  await provideComputers(page, computers);
  await page.routeWebSocket('**/device-chat', (socket) => {
    if (!rejectConnection) { socket.connectToServer(); return; }
    socket.onMessage(() => socket.close({ code: 4004, reason: 'Unavailable test computer' }));
  });
  await login(page);
  await connect(page);
  await expect(page.getByRole('status')).toHaveText('连接未完成');
  expect(await rememberedComputer(page)).toBeNull();
  rejectConnection = false;
  await connectedTo(page, '我的工作电脑');
  await expect.poll(() => rememberedComputer(page)).toBe(COMPUTER);
  rejectConnection = true;
  await chooseLaptop(page);
  await expect(page.getByRole('status')).toHaveText('连接未完成');
  expect(await rememberedComputer(page)).toBe(COMPUTER);
  rejectConnection = false;
  await page.reload();
  await connect(page);
  await connectedTo(page, '我的工作电脑');
});

test('keeps computer preferences separate for each account', async ({ page }) => {
  await provideComputers(page, computers);
  await login(page);
  await connect(page);
  await connectedTo(page, '我的工作电脑');
  await chooseLaptop(page);
  await connectedTo(page, '另一台电脑');
  await expect.poll(() => rememberedComputer(page)).toBe(LAPTOP);
  await page.evaluate(() => {
    const key = 'codex-switch.web.session.v1';
    const session = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...session, email: 'another@example.test' }));
  });
  await page.reload();
  await connect(page);
  await connectedTo(page, '我的工作电脑');
  await expect.poll(() => rememberedComputer(page)).toBe(COMPUTER);
  const preferences = await page.evaluate((prefix) => Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix)).map((key) => localStorage.getItem(key)), STORAGE_PREFIX);
  expect(preferences.sort()).toEqual([COMPUTER, LAPTOP].sort());
});
