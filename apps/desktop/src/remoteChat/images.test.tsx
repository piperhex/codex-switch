// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatImage, ChatImageContext } from '../../../web/src/chat/ChatImage';

const dataUrl = 'data:image/png;base64,aW1hZ2U=';
const load = vi.fn<() => Promise<string>>();
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  load.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

async function render(source: string, ready = true, threadId = 'task') {
  await act(async () => root.render(<ChatImageContext.Provider value={{ ready, threadId, load }}>
    <ChatImage source={source} description="照片" />
  </ChatImageContext.Provider>));
}

it('loads bounded remote previews through the PC and remounts a failed image when retrying', async () => {
  load.mockResolvedValue(dataUrl);
  await render('https://example.test/photo.jpg');
  const first = container.querySelector('img')!;
  expect(first.getAttribute('src')).toBe(dataUrl);
  expect(first.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(load).toHaveBeenCalledWith('task', 'https://example.test/photo.jpg');
  await act(async () => first.dispatchEvent(new Event('error')));
  expect(container.textContent).toContain('图片加载失败');
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('img')).not.toBe(first);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(dataUrl);
});

it('waits for the PC, uses scoped image previews, and retries failed reads', async () => {
  load.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(dataUrl);
  await render('C:/photos/page.png', false);
  expect(load).not.toHaveBeenCalled();
  await render('C:/photos/page.png');
  expect(load).toHaveBeenCalledWith('task', 'C:/photos/page.png');
  expect(container.textContent).toContain('图片加载失败');
  await act(async () => container.querySelector('button')!.click());
  expect(load).toHaveBeenCalledTimes(2);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(dataUrl);
});

it('ignores a late image from a previously selected task', async () => {
  let finish: (url: string) => void = () => undefined;
  load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(dataUrl);
  await render('./page.png', true, 'old-task');
  await render('./page.png', true, 'new-task');
  await act(async () => finish('data:image/png;base64,b2xk'));
  expect(container.querySelector('img')?.getAttribute('src')).toBe(dataUrl);
});

it('never renders application endpoints or executable URLs as images', async () => {
  for (const source of ['javascript:alert.png', '/__codex_switch__/api/private.png', 'file://server/photo.png']) {
    await render(source);
    expect(container.querySelector('img')).toBeNull();
  }
  expect(load).not.toHaveBeenCalled();
});
