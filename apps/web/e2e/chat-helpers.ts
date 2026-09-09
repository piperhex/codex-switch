import { expect, type Locator, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import type { Thread } from '../src/chat/types';

interface FixtureState {
  operations: Array<Record<string, unknown>>;
  threads: Thread[];
  streamErrors: string[];
  errors: string[];
  mobileConnections: number;
  connectedMobiles: number;
  relayFrames: number;
}
export const fixtureUrl = 'http://127.0.0.1:1490';
export async function state(request: APIRequestContext): Promise<FixtureState> {
  return (await request.get(`${fixtureUrl}/test/state`)).json();
}
export async function operationCount(request: APIRequestContext, operation: string) {
  return (await state(request)).operations.filter((entry) => entry.operation === operation).length;
}
export async function navigate(page: Page, label: string) {
  const mobile = (page.viewportSize()?.width ?? 0) <= 860;
  await click(page.locator(mobile ? '.mobile-tabbar' : '.desktop-sidebar nav').getByText(label, { exact: true }));
}
export async function connect(page: Page) {
  await navigate(page, '聊天');
  await click(page.getByRole('button', { name: /我的工作电脑/ }));
}
export async function send(page: Page, text: string, steer = false) {
  await page.getByRole('textbox', { name: '聊天消息' }).fill(text);
  await click(page.getByRole('button', { name: steer ? '补充消息' : '发送消息', exact: true }));
}
export async function settled(page: Page) {
  await expect(page.getByRole('button', { name: '停止回复' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '聊天消息' })).toHaveValue('');
}
export async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

export async function login(page: Page) {
  await page.goto('http://127.0.0.1:1422/web/', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('name@example.com').fill('mobile-test@example.test');
  await page.getByPlaceholder('输入登录密码').fill('local-test');
  await page.getByPlaceholder('输入登录密码').press('Enter');
  await expect(page.locator('.app-shell')).toBeVisible();
}

const beforeClick = new WeakMap<Page, () => Promise<void>>();
export function useNativeKeyboard(page: Page, dismiss: () => Promise<void>) { beforeClick.set(page, dismiss); }
export async function click(locator: Locator) {
  await beforeClick.get(locator.page())?.();
  await locator.click();
}
