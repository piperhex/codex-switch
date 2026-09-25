import { expect, test, type Locator, type Page } from '@playwright/test';

async function setup(page: Page) {
  const calls: { operation: string; threadId?: string; name?: string; archived?: boolean }[] = [];
  const threads = [{ id: 'one', name: '原来的对话', archived: false },
    { id: 'two', name: '另一个对话', archived: false },
    { id: 'running', name: '正在回复的对话', archived: false }];
  let failNext = false;
  await page.route('**/thread-action', async route => {
    const input = route.request().postDataJSON() as typeof calls[number];
    calls.push(input);
    if (input.operation === 'list') return route.fulfill({ json: {
      data: threads.filter(thread => thread.archived === input.archived).map(thread => ({ ...thread,
        preview: '', updatedAt: 1, cwd: '/project', status: { type: thread.id === 'running' ? 'active' : 'idle' } })),
      nextCursor: null,
    } });
    if (failNext) { failNext = false; return route.fulfill({ status: 500, json: {} }); }
    const index = threads.findIndex(thread => thread.id === input.threadId);
    if (input.operation === 'rename') threads[index].name = input.name!;
    if (input.operation === 'archive') threads[index].archived = true;
    if (input.operation === 'unarchive') threads[index].archived = false;
    if (input.operation === 'delete') threads.splice(index, 1);
    return route.fulfill({ json: {} });
  });
  await page.goto('./e2e/thread-actions-harness.html');
  await expect(page.locator('.chat-thread')).toHaveCount(3);
  return { calls, fail: () => { failNext = true; } };
}

async function longPress(page: Page, row: Locator, touch: boolean) {
  const box = (await row.boundingBox())!;
  const x = box.x + box.width / 2; const y = box.y + box.height / 2;
  if (!touch) {
    await page.mouse.move(x, y); await page.mouse.down();
    await expect(page.getByText('对话操作', { exact: true })).toBeVisible();
    await page.mouse.up(); return;
  }
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await expect(page.getByText('对话操作', { exact: true })).toBeVisible();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

test('long press renames without selecting; archive, restore and confirmed deletion target the correct chat',
  async ({ page, isMobile }) => {
    const { calls } = await setup(page);
    await longPress(page, page.getByRole('button', { name: '原来的对话', exact: true }), isMobile);
    await expect(page.getByTestId('selected')).toHaveText('none');
    await page.screenshot({ path: `../../.codex-tmp/thread-actions-${isMobile ? 'mobile' : 'desktop'}.png` });
    expect(await page.locator('.chat-thread-actions').evaluate(element => element.getBoundingClientRect().width))
      .toBeLessThanOrEqual(400);
    await page.getByRole('button', { name: '重命名对话', exact: true }).click();
    await page.getByRole('textbox', { name: '对话名称' }).fill('   ');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await page.getByRole('textbox', { name: '对话名称' }).fill('  新的名称  ');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('button', { name: '新的名称', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '管理对话：新的名称', exact: true }).click();
    await page.getByRole('button', { name: '归档', exact: true }).click();
    await expect(page.getByRole('button', { name: '新的名称', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '最近聊天 ▾', exact: true }).click();
    await page.getByRole('button', { name: '管理对话：新的名称', exact: true }).click();
    await page.getByRole('button', { name: '恢复', exact: true }).click();
    await expect(page.getByRole('button', { name: '新的名称', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '已归档 ▾', exact: true }).click();
    await page.getByRole('button', { name: '管理对话：新的名称', exact: true }).click();
    await page.getByRole('button', { name: '删除对话', exact: true }).click();
    await expect(page.getByText('删除这条对话？', { exact: true })).toBeVisible();
    expect(calls.filter(call => call.operation === 'delete')).toHaveLength(0);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '管理对话：新的名称', exact: true }).click();
    await page.getByRole('button', { name: '删除对话', exact: true }).click();
    await page.getByRole('button', { name: '删除对话', exact: true }).click();
    await expect(page.getByRole('button', { name: '新的名称', exact: true })).toHaveCount(0);
    expect(calls.filter(call => call.operation === 'delete')).toEqual([{ operation: 'delete', threadId: 'one' }]);
    await expect(page.getByRole('button', { name: '另一个对话', exact: true })).toBeVisible();
  });

test('short taps select; context menus support failures, retry and active reply guards', async ({ page }) => {
  const { fail } = await setup(page);
  await page.getByRole('button', { name: '另一个对话', exact: true }).click();
  await expect(page.getByTestId('selected')).toHaveText('two');
  await page.getByRole('button', { name: '原来的对话', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: '重命名对话', exact: true }).click();
  await page.getByRole('textbox', { name: '对话名称' }).fill('重试名称'); fail();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('操作未完成，请稍后重试。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试名称', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '管理对话：正在回复的对话', exact: true }).click();
  await expect(page.getByRole('button', { name: '归档', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '删除对话', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveText('请等待回复结束后再操作。');
});

test('moving the pointer cancels a long press without opening the menu', async ({ page }) => {
  await setup(page);
  const row = page.getByRole('button', { name: '原来的对话', exact: true });
  await row.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0, clientX: 40, clientY: 220 });
  await row.dispatchEvent('pointermove', { pointerType: 'touch', isPrimary: true, clientX: 40, clientY: 250 });
  await page.waitForTimeout(600);
  await row.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
  await expect(page.getByText('对话操作', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('selected')).toHaveText('none');
});
