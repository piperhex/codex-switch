import { afterEach, expect, it, vi } from 'vitest';
import { remoteTerminalApi } from './terminalApi';
import { connectTerminal } from '../../../../../../shared/terminal/connection';
import type { TerminalRead } from '../../../../../../shared/terminal/types';

afterEach(() => vi.useRealTimers());

it('keeps remote output reads single-flight and cancels polling when a tab closes', async () => {
  vi.useFakeTimers();
  let finish!: (events: TerminalRead) => void;
  const client = { open: vi.fn(async () => ({ id: 'remote', cwd: '/remote', shell: 'bash' })),
    list: vi.fn(async () => []),
    read: vi.fn(() => new Promise<TerminalRead>(resolve => { finish = resolve; })),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const api = remoteTerminalApi(client);
  const receive = vi.fn();
  await api.open('/remote', { cols: 90, rows: 30 }, receive);
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.read).toHaveBeenCalledOnce();
  finish({ found: true, cursor: 1, truncated: false, events: [{ type: 'output', data: [0xe4, 0xb8] }] });
  await vi.advanceTimersByTimeAsync(100);
  expect(receive).toHaveBeenCalledWith({ type: 'output', data: [0xe4, 0xb8] });
  expect(client.read).toHaveBeenCalledTimes(2);
  expect(client.read).toHaveBeenLastCalledWith('remote', 1);
  await api.write('remote', 'echo test\r');
  await api.resize('remote', { cols: 120, rows: 40 });
  expect(client.write).toHaveBeenCalledWith('remote', 'echo test\r');
  expect(client.resize).toHaveBeenCalledWith('remote', { cols: 120, rows: 40 });
  await api.close('remote');
  finish({ found: true, cursor: 2, truncated: false, events: [{ type: 'output', data: [0xad] }] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(receive).toHaveBeenCalledOnce();
  expect(client.read).toHaveBeenCalledTimes(2);
  expect(client.close).toHaveBeenCalledWith('remote');
});

it('keeps a replacement attachment alive when StrictMode disposes the previous pending attachment', async () => {
  vi.useFakeTimers();
  const info = { id: 'retained', cwd: '/remote', shell: 'bash' };
  const client = { open: vi.fn(async () => info), list: vi.fn(async () => [info]),
    read: vi.fn(async (): Promise<TerminalRead> => ({ found: true, cursor: 0, events: [], truncated: false })),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const api = remoteTerminalApi(client);
  const options = { api, session: info, cwd: info.cwd, size: { cols: 80, rows: 24 },
    onEvent: vi.fn(), onReady: vi.fn(), onError: vi.fn() };
  const first = connectTerminal(options);
  first.dispose();
  const second = connectTerminal(options);
  await vi.advanceTimersByTimeAsync(500);
  expect(client.read.mock.calls.length).toBeGreaterThan(2);
  expect(client.close).not.toHaveBeenCalled();
  expect(client.open).not.toHaveBeenCalled();
  second.dispose();
  const reads = client.read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.read).toHaveBeenCalledTimes(reads);
});

it('resumes polling the same shell after failure and detaches without closing it', async () => {
  vi.useFakeTimers();
  const client = { open: vi.fn(async () => ({ id: 'remote', cwd: '/remote', shell: 'bash' })),
    list: vi.fn(async () => []),
    read: vi.fn(async (): Promise<TerminalRead> => { throw new Error('Disconnected'); }),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const receive = vi.fn();
  const api = remoteTerminalApi(client);
  await api.open('/remote', { cols: 90, rows: 30 }, receive);
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.read).toHaveBeenCalledTimes(2);
  expect(receive).toHaveBeenCalledWith({ type: 'connection', connected: false });
  client.read.mockResolvedValue({ found: true, events: [{ type: 'output', data: [65] }], cursor: 1, truncated: false });
  await vi.advanceTimersByTimeAsync(1000);
  expect(receive).toHaveBeenCalledWith({ type: 'connection', connected: true });
  expect(receive).toHaveBeenCalledWith({ type: 'output', data: [65] });
  api.detach!('remote');
  const reads = client.read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(client.read).toHaveBeenCalledTimes(reads);
  expect(client.open).toHaveBeenCalledOnce();
  expect(client.close).not.toHaveBeenCalled();
  expect(receive.mock.calls.some(([event]) => event.type === 'exit')).toBe(false);
});
