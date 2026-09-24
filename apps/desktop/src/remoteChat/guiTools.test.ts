// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../pages/codexGui/api';
import { invoke } from '../api/backend';
import { terminalApi, type TerminalEvent } from '../pages/codexGui/terminal/api';
import { subscribeGuiEvent } from '../pages/codexGui/webEvents';

const state = vi.hoisted(() => ({ sending: false, workspaceBusy: false, approvals: [],
  conversations: {} as Record<string, { activeTurn: string | null }> }));
vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../pages/codexGui/api', () => ({ guiApi: { connect: vi.fn() } }));
vi.mock('../pages/codexGui/webEvents', () => ({ subscribeGuiEvent: vi.fn(async () => vi.fn()) }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: () => ({ getSnapshot: () => state }) }));
vi.mock('../pages/codexGui/terminal/api', () => ({
  terminalApi: { open: vi.fn(), write: vi.fn(), resize: vi.fn(), close: vi.fn() },
}));

const request = (id: string, body: object) => ({ kind: 'request' as const, method: 'request' as const, id, body });
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
beforeEach(() => {
  vi.clearAllMocks(); state.conversations = {};
  vi.mocked(invoke).mockImplementation(async () => ({ version: '0.155.0' }));
  vi.mocked(terminalApi.open).mockResolvedValue({ id: 'terminal', cwd: '/remote', shell: 'bash' });
  vi.mocked(terminalApi.close).mockResolvedValue();
});

it('scopes terminal handles and replayed requests to their authenticated session', async () => {
  const operations = new ChatOperations();
  const open = request('open', { operation: 'guiTerminalOpen', cwd: '/remote', size: { cols: 80, rows: 24 } });
  await operations.execute(open, 'relay', 'one');
  const write = request('write', { operation: 'guiTerminalWrite', id: 'terminal', data: 'hello\r' });
  expect((await operations.execute(write, 'relay', 'one')).error).toBeUndefined();
  await operations.execute(write, 'direct', 'one');
  expect(terminalApi.write).toHaveBeenCalledOnce();
  expect((await operations.execute(write, 'relay', 'two')).error).toContain('已关闭');
  operations.release('two'); expect(terminalApi.close).not.toHaveBeenCalled();
  operations.release('one'); expect(terminalApi.close).toHaveBeenCalledWith('terminal');
});

it('replays output reads without losing bytes and bounds output when a receiver stops reading', async () => {
  let receive!: (event: TerminalEvent) => void;
  vi.mocked(terminalApi.open).mockImplementation(async (_cwd, _size, listener) => {
    receive = listener; return { id: 'terminal', cwd: '/remote', shell: 'bash' };
  });
  const operations = new ChatOperations();
  await operations.execute(request('open', { operation: 'guiTerminalOpen', cwd: '/remote', size: {} }));
  receive({ type: 'output', data: [228, 184] });
  const read = request('read', { operation: 'guiTerminalRead', id: 'terminal' });
  expect((await operations.execute(read)).data).toEqual([{ type: 'output', data: [228, 184] }]);
  receive({ type: 'output', data: [173] });
  expect((await operations.execute(read)).data).toEqual([{ type: 'output', data: [228, 184] }]);
  expect((await operations.execute({ ...read, id: 'next' })).data).toEqual([{ type: 'output', data: [173] }]);
  receive({ type: 'output', data: Array(256 * 1024 + 1).fill(1) as number[] });
  expect(terminalApi.close).toHaveBeenCalledWith('terminal');
  expect((await operations.execute({ ...read, id: 'overflow' })).data).toEqual([
    { type: 'error', message: expect.any(String) }, { type: 'exit', code: null },
  ]);
  operations.release();
});

it('closes a pending terminal if its remote session disconnects before opening completes', async () => {
  let finish!: (info: { id: string; cwd: string; shell: string }) => void;
  vi.mocked(terminalApi.open).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const operations = new ChatOperations();
  const opening = operations.execute(request('open', { operation: 'guiTerminalOpen', cwd: '/remote', size: {} }));
  operations.release(); finish({ id: 'late', cwd: '/remote', shell: 'bash' }); await opening;
  expect(terminalApi.close).toHaveBeenCalledWith('late');
});

it('rejects updates and restarts while any remote conversation is running', async () => {
  state.conversations = { other: { activeTurn: 'turn' } };
  const operations = new ChatOperations();
  for (const operation of ['guiCliInstall', 'guiReconnect']) {
    const result = await operations.execute(request(operation, { operation, version: '0.156.0' }));
    expect(result.error).toContain('任务在运行');
  }
  expect(invoke).not.toHaveBeenCalled(); expect(guiApi.connect).not.toHaveBeenCalled();
});

it('returns an update job immediately, reports progress, and reconnects after completion', async () => {
  let finish!: () => void;
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'codex_gui_cli_install') await new Promise<void>(resolve => { finish = resolve; });
    return { version: '0.156.0' };
  });
  const operations = new ChatOperations();
  const result = await operations.execute(request('install', { operation: 'guiCliInstall', version: '0.156.0' }));
  expect(result.data).toMatchObject({ installing: true });
  const progress = { downloaded: 50, total: 100, phase: 'downloading' };
  vi.mocked(subscribeGuiEvent).mock.calls[0][1](progress);
  expect((await operations.execute(request('status', { operation: 'guiCliStatus' }))).data)
    .toMatchObject({ installing: true, progress });
  operations.release(); // The download is independent of the initiating connection.
  finish(); await flush();
  expect(guiApi.connect).toHaveBeenCalledOnce();
  expect((await operations.execute(request('done', { operation: 'guiCliStatus' }))).data)
    .toMatchObject({ installing: false, version: '0.156.0' });
});
