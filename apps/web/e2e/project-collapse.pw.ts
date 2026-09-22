import { expect, test, type Locator } from '@playwright/test';
import type { Thread } from '../src/chat/types';

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
