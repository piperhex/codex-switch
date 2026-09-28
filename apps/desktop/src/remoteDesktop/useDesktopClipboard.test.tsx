// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDesktopClipboard } from '../../../web/src/chat/desktop/useDesktopClipboard';
import type { ClipboardContent } from '../../../../shared/remote-desktop/clipboard';

const text = (value: string): ClipboardContent => ({ format: 'text', text: value });
const clipboard = { read: vi.fn(), write: vi.fn() };
const localClipboard = { files: true, read: vi.fn(), write: vi.fn() };
let state: ReturnType<typeof useDesktopClipboard>;
let root: Root;
function Harness({ active = true, native = true }) {
  state = useDesktopClipboard({ active, clipboard, localClipboard: native ? localClipboard : undefined });
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  clipboard.read.mockResolvedValue(text('remote')); clipboard.write.mockResolvedValue(undefined);
  localClipboard.read.mockResolvedValue(text('local')); localClipboard.write.mockResolvedValue(undefined);
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

it('queues consecutive paste gestures without overlapping or losing transfers', async () => {
  const first = deferred<void>(); clipboard.write.mockImplementationOnce(() => first.promise);
  await act(async () => { state.pasteLocal(); state.pasteLocal(); });
  expect(clipboard.write).toHaveBeenCalledTimes(1); expect(state.busy).toBe(true);
  await act(async () => first.resolve());
  expect(clipboard.write).toHaveBeenCalledTimes(2); expect(state.busy).toBe(false);
});

it('discards queued work and late copy results after the viewer becomes inactive', async () => {
  const reading = deferred<ClipboardContent>(); clipboard.read.mockReturnValueOnce(reading.promise);
  await act(async () => { state.copy('copy'); state.pasteLocal(); });
  act(() => root.render(<Harness active={false} />));
  await act(async () => reading.resolve(text('old session')));
  expect(localClipboard.write).not.toHaveBeenCalled(); expect(localClipboard.read).not.toHaveBeenCalled();
  expect(clipboard.write).not.toHaveBeenCalled(); expect(state.status).toBe(''); expect(state.busy).toBe(false);
  act(() => root.render(<Harness />));
  await act(async () => state.pasteLocal());
  expect(clipboard.write).toHaveBeenCalledTimes(1);
});

it('keeps native file copies available for retry after a system clipboard write fails', async () => {
  const files: ClipboardContent = { format: 'files', files: [{ name: 'report.txt', data: 'YQ==' }] };
  clipboard.read.mockResolvedValueOnce(files); localClipboard.write.mockRejectedValueOnce('clipboard locked');
  await act(async () => state.copy('copy'));
  expect(state.received).toEqual(files); expect(state.open).toBe(true);
  await act(async () => state.save());
  expect(localClipboard.write).toHaveBeenLastCalledWith(files);
  expect(state.status).toBe('已复制到本机，可直接粘贴。');
});

it('uses the in-flight remote copy for an immediate browser paste, not stale event text', async () => {
  act(() => root.render(<Harness native={false} />));
  const reading = deferred<ClipboardContent>(); clipboard.read.mockReturnValueOnce(reading.promise);
  await act(async () => { state.copy('copy'); state.paste({} as DataTransfer); });
  await act(async () => reading.resolve(text('fresh remote')));
  expect(clipboard.write).toHaveBeenCalledWith(text('fresh remote'), true, expect.any(Function));
});

it('shows native errors and allows the next paste to proceed', async () => {
  localClipboard.read.mockRejectedValueOnce('暂不支持复制文件夹，请先压缩后再复制。');
  await act(async () => state.pasteLocal());
  expect(state.status).toContain('文件夹'); expect(state.busy).toBe(false);
  await act(async () => state.pasteLocal());
  expect(clipboard.write).toHaveBeenCalledTimes(1);
});
