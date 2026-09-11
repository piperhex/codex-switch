import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { connect, state } from './chat-helpers';
import { LONG_PROJECT_NAME } from '../../desktop/e2e/demo-project-directories';

export async function projectPickerJourney({ page, request, relay }: {
  page: Page; request: APIRequestContext; relay: boolean;
}) {
  if (relay) await page.evaluate(() => {
    window.RTCPeerConnection = class {
      constructor() { throw new Error('Use relay for this test'); }
    } as unknown as typeof RTCPeerConnection;
  });
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: relay ? 'Relay' : 'P2P' })).toBeVisible({ timeout: 16_000 });
  const project = page.getByRole('button', { name: '选择项目', exact: true });
  const draft = page.getByRole('textbox', { name: '聊天消息' });
  await expect(project).toHaveText('未选择项目');
  await draft.fill('保留这条尚未发送的消息');
  await project.click();
  const picker = page.locator('.chat-project-picker');
  await expect(picker.getByRole('button', { name: '选择此文件夹' })).toBeDisabled();
  await picker.getByRole('button', { name: 'F:', exact: true }).click();
  await picker.getByRole('button', { name: 'projects', exact: true }).click();
  await picker.getByRole('button', { name: '不可访问的文件夹' }).click();
  await expect(picker.getByRole('alert')).toBeVisible();
  await picker.getByRole('button', { name: '此电脑', exact: true }).click();
  await picker.getByRole('button', { name: 'F:', exact: true }).click();
  await picker.getByRole('button', { name: 'projects', exact: true }).click();
  await picker.getByRole('button', { name: LONG_PROJECT_NAME, exact: true }).click();
  await picker.getByRole('button', { name: '返回上一级' }).click();
  await picker.getByRole('button', { name: LONG_PROJECT_NAME, exact: true }).click();
  await picker.getByRole('button', { name: '选择此文件夹' }).click();
  await expect(project).toHaveText(LONG_PROJECT_NAME);
  await expect(draft).toHaveValue('保留这条尚未发送的消息');
  expect(await project.evaluate((element) => element.scrollWidth > element.clientWidth
    && getComputedStyle(element).textOverflow === 'ellipsis')).toBe(true);
  await project.click();
  await page.getByRole('button', { name: /^(关闭|Close)$/ }).click();
  await expect(project).toHaveText(LONG_PROJECT_NAME);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(async () => (await state(request)).operations.find((entry) => entry.operation === 'start')?.cwd)
    .toBe(`F:/projects/${LONG_PROJECT_NAME}`);
}
