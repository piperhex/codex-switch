import { afterEach, expect, it, vi } from 'vitest';
import { remoteTerminalApi } from './terminalApi';
import type { TerminalEvent } from '../terminal/api';

afterEach(() => vi.useRealTimers());

it('keeps remote output reads single-flight and cancels polling when a tab closes', async () => {
  vi.useFakeTimers();
  let finish!: (events: TerminalEvent[]) => void;
  const client = { open: vi.fn(async () => ({ id: 'remote', cwd: '/remote', shell: 'bash' })),
    read: vi.fn(() => new Promise<TerminalEvent[]>(resolve => { finish = resolve; })),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const api = remoteTerminalApi(client);
  const receive = vi.fn();
  await api.open('/remote', { cols: 90, rows: 30 }, receive);
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.read).toHaveBeenCalledOnce();
  finish([{ type: 'output', data: [0xe4, 0xb8] }]);
  await vi.advanceTimersByTimeAsync(100);
  expect(receive).toHaveBeenCalledWith({ type: 'output', data: [0xe4, 0xb8] });
  expect(client.read).toHaveBeenCalledTimes(2);
  await api.write('remote', 'echo test\r');
  await api.resize('remote', { cols: 120, rows: 40 });
  expect(client.write).toHaveBeenCalledWith('remote', 'echo test\r');
  expect(client.resize).toHaveBeenCalledWith('remote', { cols: 120, rows: 40 });
  await api.close('remote');
  finish([{ type: 'output', data: [0xad] }]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(receive).toHaveBeenCalledOnce();
  expect(client.read).toHaveBeenCalledTimes(2);
  expect(client.close).toHaveBeenCalledWith('remote');
});

it('ends polling after a transport failure without retrying input on another session', async () => {
  vi.useFakeTimers();
  const client = { open: vi.fn(async () => ({ id: 'remote', cwd: '/remote', shell: 'bash' })),
    read: vi.fn(async (): Promise<TerminalEvent[]> => { throw new Error('Disconnected'); }),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const receive = vi.fn();
  await remoteTerminalApi(client).open('/remote', { cols: 90, rows: 30 }, receive);
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.read).toHaveBeenCalledOnce();
  expect(receive).toHaveBeenCalledWith({ type: 'exit', code: null });
  expect(client.close).toHaveBeenCalledWith('remote');
});
