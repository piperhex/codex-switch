// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import type { ChatConnection } from '../../../../../../shared/remote-chat/client/connection';
import type { ChatState } from '../../../../../../shared/remote-chat/client/types';
import { RemoteGuiSidebar } from './RemoteGuiSidebar';
import styles from '../styles.module.less';

let root: Root;
let container: HTMLDivElement;
let controller: ChatController;
const request = vi.fn<ChatConnection['request']>();
const thread = { id: 'current', cwd: 'D:/project', name: '已有对话', preview: '', updatedAt: 1 };
const older = { ...thread, id: 'older', name: '更早的对话' };
const actions = { newChat: vi.fn(), onClose: vi.fn(), openSearch: vi.fn() };

function Harness() {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <RemoteGuiSidebar state={state} controller={controller} actions={actions} accountPicker={null}
    focusMode={{ focused: false, onToggleFocus: vi.fn() }} />;
}
const render = () => act(async () => root.render(<Harness />));
const list = () => container.querySelector<HTMLDivElement>(`.${styles.threadList}`)!;
const footer = () => container.querySelector('[role="status"]');
const wheel = (deltaY = 50) => act(async () => {
  list().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
});
const scroll = (top: number) => act(async () => {
  list().scrollTop = top;
  list().dispatchEvent(new Event('scroll', { bubbles: true }));
});
function dimensions(height = 1000) {
  Object.defineProperties(list(), {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: height },
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => original(element));
  request.mockReset().mockResolvedValue({ data: [older], nextCursor: null });
  controller = new ChatController(() => ({ start() {}, stop() {},
    request: <T,>(...args: Parameters<ChatConnection['request']>) => request(...args) as Promise<T>,
  }));
  Object.assign(controller.snapshot(), { ready: true, cursor: 'next', threads: [thread] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  controller.stop(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('retries the failed remote page on downward scrolling with the local hint and no overlapping requests', async () => {
  request.mockRejectedValueOnce(new Error('连接暂时中断'));
  await render(); dimensions();
  expect(request).not.toHaveBeenCalled();
  await scroll(200);
  expect(request).not.toHaveBeenCalled();
  await scroll(490);
  expect(request).toHaveBeenCalledExactlyOnceWith('request', {
    operation: 'list', search: '', archived: false, cursor: 'next',
  });
  expect(container.textContent).toContain('已有对话');
  expect(container.textContent).not.toContain('加载失败，点击重试');
  expect(footer()?.textContent).toBe('向下滚动，查看更多');
  expect(footer()?.querySelector('button')).toBeNull();
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await wheel();
  expect(footer()?.textContent).toBe('正在加载更多对话…');
  await wheel(); await scroll(520);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  await act(async () => finish({ data: [older], nextCursor: null }));
  expect(container.textContent).toContain('已有对话');
  expect(container.textContent).toContain('更早的对话');
  expect(footer()).toBeNull();
  await wheel();
  expect(request).toHaveBeenCalledTimes(2);
});

it('loads archived conversations with the wheel when collapsed groups leave no scrollable overflow', async () => {
  Object.assign(controller.snapshot(), { archived: true });
  await render(); dimensions(400);
  const group = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  await act(async () => group.click());
  expect(group.getAttribute('aria-expanded')).toBe('false');
  expect(request).not.toHaveBeenCalled();
  await wheel();
  expect(request).toHaveBeenCalledExactlyOnceWith('request', {
    operation: 'list', search: '', archived: true, cursor: 'next',
  });
});

it.each<Partial<ChatState>>([{ ready: false }, { loading: true }, { cursor: null }])(
  'pauses pagination when unavailable: %j', async patch => {
    Object.assign(controller.snapshot(), patch);
    await render(); dimensions();
    await scroll(500); await wheel();
    expect(request).not.toHaveBeenCalled();
  },
);

it('ignores upward gestures and downward gestures away from the bottom', async () => {
  await render(); dimensions();
  await wheel();
  list().scrollTop = 600;
  await wheel(-50);
  expect(request).not.toHaveBeenCalled();
});
