import { expect, test, type Locator } from '@playwright/test';
import type { Thread } from '../src/chat/types';
import type { SidebarSnapshot } from '../../../shared/remote-chat/sidebar';

const threads = (count: number): Thread[] => [
  ...Array.from({ length: count }, (_, index) => ({ id: `project-${index}`, name: `项目聊天 ${index}`,
    preview: '', updatedAt: 1, cwd: '/project' })),
  { id: 'other', name: '其他项目聊天', preview: '', updatedAt: 1, cwd: '/other' },
];
const activate = (button: Locator, touch: boolean) => touch ? button.tap() : button.click();

test('collapses projects independently by name and resets expanded conversations to the five-chat preview',
  async ({ page, isMobile }, info) => {
    await page.route('**/thread-page?*', route => route.fulfill({ json: { data: threads(7), nextCursor: null } }));
    await page.goto('./e2e/thread-pagination-harness.html');
    const project = page.getByRole('region', { name: 'project', exact: true });
    const other = page.getByRole('region', { name: 'other', exact: true });
    const heading = project.locator('.chat-project-toggle');
    await expect(project.locator('.chat-thread')).toHaveCount(5);
    await activate(heading, isMobile);
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await expect(project.locator('.chat-thread, .chat-group-more')).toHaveCount(0);
    await expect(other.locator('.chat-thread')).toHaveCount(1);
    await activate(project.getByRole('button', { name: '在 project 中新建对话' }), isMobile);
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await activate(heading, isMobile);
    await expect(project.locator('.chat-thread')).toHaveCount(5);
    await activate(project.getByRole('button', { name: '展开显示：project' }), isMobile);
    await expect(project.locator('.chat-thread')).toHaveCount(7);
    await activate(heading, isMobile);
    await expect(project.locator('.chat-thread')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('collapsed-project.png'), animations: 'disabled' });
    await activate(heading, isMobile);
    await expect(project.locator('.chat-thread')).toHaveCount(5);
    await expect(project.getByRole('button', { name: '展开显示：project' })).toHaveAttribute('aria-expanded', 'false');
    if (!isMobile) {
      await heading.focus();
      await page.keyboard.press('Space');
      await expect(project.locator('.chat-thread')).toHaveCount(0);
      await page.keyboard.press('Enter');
      await expect(project.locator('.chat-thread')).toHaveCount(5);
    }
  });

test('keeps a project collapsed during refresh and reveals new chats when reopened', async ({ page, isMobile }) => {
  let count = 2;
  await page.route('**/thread-page?*', route => route.fulfill({ json: { data: threads(count), nextCursor: null } }));
  await page.goto('./e2e/thread-pagination-harness.html');
  const project = page.getByRole('region', { name: 'project', exact: true });
  const heading = project.locator('.chat-project-toggle');
  await expect(project.locator('.chat-thread')).toHaveCount(2);
  await activate(heading, isMobile);
  count = 3;
  await activate(page.getByRole('button', { name: '刷新聊天' }), isMobile);
  await expect(page.locator('.chat-thread-list')).toHaveAttribute('aria-busy', 'false');
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await expect(project.locator('.chat-thread')).toHaveCount(0);
  await activate(heading, isMobile);
  await expect(project.locator('.chat-thread')).toHaveCount(3);
});

test('promotes parallel replies within project and recent groups and restores the original order',
  async ({ page, isMobile }, info) => {
    const data = [...threads(7), ...threads(7).slice(0, 7).map(thread => ({
      ...thread, id: thread.id.replace('project', 'recent'), name: thread.name.replace('项目', '最近'), cwd: '',
    }))];
    let sidebar: SidebarSnapshot = { revision: -1, threads: {}, readState: {} };
    await page.route('**/thread-page?*', route => route.fulfill({ json: { data, nextCursor: null, sidebar } }));
    await page.goto('./e2e/thread-pagination-harness.html');
    const project = page.getByRole('region', { name: 'project', exact: true });
    const recent = page.getByRole('region', { name: '最近', exact: true });
    await expect(project.locator('.chat-thread')).toHaveText([0, 1, 2, 3, 4].map(index => `项目聊天 ${index}`));
    const running = new Set(['project-5', 'project-6', 'recent-6']);
    const refresh = async (active: boolean) => {
      sidebar = { ...sidebar, revision: sidebar.revision + 1, threads: Object.fromEntries(data.map(thread => [
        thread.id, { cwd: thread.cwd, projectName: '', title: thread.name!, running: active && running.has(thread.id) },
      ])) };
      await activate(page.getByRole('button', { name: '刷新聊天' }), isMobile);
      await expect(page.locator('.chat-thread-list')).toHaveAttribute('aria-busy', 'false');
    };
    await refresh(true);
    await expect(project.locator('.chat-thread')).toHaveText([5, 6, 0, 1, 2].map(index => `项目聊天 ${index}`));
    await expect(recent.locator('.chat-thread')).toHaveText([6, 0, 1, 2, 3].map(index => `最近聊天 ${index}`));
    await expect(project.getByLabel('正在回复')).toHaveCount(2);
    await expect(page.locator('.chat-project-toggle')).toHaveText(['project', 'other', '最近']);
    await page.screenshot({ path: info.outputPath('running-chats-first.png'), animations: 'disabled' });
    await activate(project.locator('.chat-project-toggle'), isMobile);
    await expect(project.locator('.chat-thread')).toHaveCount(0);
    await activate(project.locator('.chat-project-toggle'), isMobile);
    await expect(project.locator('.chat-thread').first()).toHaveText('项目聊天 5');
    await refresh(false);
    await expect(project.locator('.chat-thread')).toHaveText([0, 1, 2, 3, 4].map(index => `项目聊天 ${index}`));
    await expect(recent.locator('.chat-thread')).toHaveText([0, 1, 2, 3, 4].map(index => `最近聊天 ${index}`));
    await activate(project.getByRole('button', { name: '展开显示：project' }), isMobile);
    await expect(project.locator('.chat-thread')).toHaveText([0, 1, 2, 3, 4, 5, 6].map(index => `项目聊天 ${index}`));
  });
