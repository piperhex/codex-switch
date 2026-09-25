import { expect, test } from '@playwright/test';
import type { Thread } from '../src/chat/types';

test('groups adjacent tools, preserves commentary and keeps inspected output current after completion', async ({ page }, info) => {
  const value: Thread = { id: 'activities', cwd: '', preview: '', updatedAt: 1, turns: [{
    id: 'turn', status: 'inProgress', items: [
      { id: 'user', type: 'userMessage', text: '检查操作顺序' },
      { id: 'read', type: 'commandExecution', status: 'completed', command: 'read first', aggregatedOutput: 'FIRST' },
      { id: 'run', type: 'commandExecution', status: 'inProgress', command: 'npm test', aggregatedOutput: 'START' },
      { id: 'done', type: 'commandExecution', status: 'completed', command: 'read last', aggregatedOutput: 'LAST' },
      { id: 'comment', type: 'agentMessage', phase: 'commentary', text: '接着检查页面。' },
      { id: 'other', type: 'commandExecution', status: 'completed', command: 'another command' },
    ],
  }] };
  await page.route('**/display-fixture.json', route => route.fulfill({ json: value }));
  await page.goto('e2e/chat-display-harness.html');
  const group = page.locator('.chat-entry-activities');
  await expect(group).toHaveCount(1);
  await expect(group).toContainText('npm test');
  await expect(group.locator('.is-running')).toHaveCount(1);
  const commentary = page.getByText('接着检查页面。');
  expect((await group.boundingBox())!.y).toBeLessThan((await commentary.boundingBox())!.y);
  await group.getByRole('button').click();
  await page.getByRole('button', { name: /执行命令.*npm test/ }).last().click();
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  value.turns![0].status = 'completed';
  value.turns![0].items[2] = { ...value.turns![0].items[2], status: 'completed', aggregatedOutput: 'FINISHED' };
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);
  await expect(page.getByText('FINISHED', { exact: true })).toBeVisible();
  if (info.project.name === 'desktop') await page.getByRole('button', { name: /执行命令.*npm test/ }).last().click();
  else await page.getByRole('button', { name: '返回上一层' }).click();
  await expect(page.getByRole('button', { name: /执行命令.*read first/ }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: /执行命令.*read last/ }).last()).toBeVisible();
});
