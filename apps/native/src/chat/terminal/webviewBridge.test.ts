import { expect, it, vi } from 'vitest';
import { createTerminalBridge, parseTerminalMessage } from '../../../../../shared/terminal/webviewBridge';
import type { TerminalApi, TerminalEvent } from '../../../../../shared/terminal/types';

const ready = JSON.stringify({ type: 'ready', cols: 45, rows: 30 });
const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
function fixture() {
  let output!: (value: TerminalEvent) => void;
  const api: TerminalApi = { open: vi.fn(async (_cwd, _size, receive) => {
    output = receive; return { id: 'terminal', cwd: '/project', shell: 'bash' };
  }), write: vi.fn(async () => {}), resize: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const emit = vi.fn(); const status = vi.fn();
  return { api, emit, status, output: (value: TerminalEvent) => output(value),
    bridge: createTerminalBridge({ api, cwd: '/project', emit, status }) };
}

it('rejects malformed input and invalid terminal dimensions at the WebView boundary', () => {
  for (const value of ['null', '[]', 'bad', '{"type":"input","data":1}',
    '{"type":"ready","cols":0,"rows":24}', '{"type":"resize","cols":80,"rows":501}',
    JSON.stringify({ type: 'input', data: 'x'.repeat(32769) })]) expect(parseTerminalMessage(value)).toBeNull();
  expect(parseTerminalMessage(ready)).toEqual({ type: 'ready', cols: 45, rows: 30 });
});

it('keeps one shell across hide/reopen, restores output and sends keyboard input to that shell', async () => {
  const { api, bridge, emit, output } = fixture();
  bridge.receive(ready); await flush();
  expect(api.open).toHaveBeenCalledWith('/project', { cols: 45, rows: 30 }, expect.any(Function));
  bridge.receive(JSON.stringify({ type: 'input', data: 'echo 中文\r' })); await flush();
  expect(api.write).toHaveBeenCalledWith('terminal', 'echo 中文\r');
  bridge.detach();
  output({ type: 'output', data: [65, 66] });
  expect(emit).not.toHaveBeenCalled();
  bridge.receive(ready); await flush();
  expect(api.open).toHaveBeenCalledTimes(1);
  expect(api.resize).toHaveBeenCalledWith('terminal', { cols: 45, rows: 30 });
  expect(emit).toHaveBeenCalledWith({ type: 'output', data: [65, 66] });
  bridge.dispose();
  expect(api.close).toHaveBeenCalledWith('terminal');
  bridge.receive(ready);
  expect(api.open).toHaveBeenCalledTimes(1);
});

it('bounds retained output and restores exit state without opening another shell', async () => {
  const { api, bridge, emit, status, output } = fixture();
  bridge.receive(ready); await flush(); bridge.detach();
  for (let index = 0; index < 5; index++) output({ type: 'output', data: Array(200_000).fill(index) });
  output({ type: 'exit', code: 0 });
  bridge.receive(ready);
  expect(emit.mock.calls.filter(([event]) => event.type === 'output')
    .reduce((sum, [event]) => sum + event.data.length, 0)).toBeLessThanOrEqual(512 * 1024);
  expect(emit).toHaveBeenLastCalledWith({ type: 'exit', code: 0 });
  expect(status).toHaveBeenLastCalledWith('终端已结束，可以关闭后重新打开。');
  expect(api.open).toHaveBeenCalledTimes(1);
  bridge.dispose();
});

it('closes a shell that finishes opening after switching computers', async () => {
  const { api, bridge } = fixture();
  let finish!: () => void;
  vi.mocked(api.open).mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ id: 'late', cwd: '', shell: 'bash' });
  }));
  bridge.receive(ready); bridge.dispose(); finish(); await flush();
  expect(api.close).toHaveBeenCalledWith('late');
});
