// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteTerminals } from './terminals';
import { terminalApi } from '../pages/codexGui/terminal/api';
import { createGuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { terminalProjectKey } from '../../../../shared/remote-chat/terminalProject';

vi.mock('../pages/codexGui/terminal/api', () => ({
  terminalApi: { open: vi.fn(), write: vi.fn(), resize: vi.fn(), close: vi.fn() },
}));
beforeEach(() => vi.resetAllMocks());
const list = (cwd: string) => ({ operation: 'guiTerminalList', cwd });
const open = (cwd: string) => ({ operation: 'guiTerminalOpen', cwd, size: { cols: 80, rows: 24 } });

it('keeps project shells and their output separate across reconnects and explicit closes', async () => {
  const terminals = new RemoteTerminals();
  let sequence = 0;
  vi.mocked(terminalApi.open).mockImplementation(async (cwd, _size, receive) => {
    receive({ type: 'output', data: [...new TextEncoder().encode(cwd)] });
    return { id: `shell-${++sequence}`, cwd, shell: 'bash' };
  });
  const first = await terminals.request(open('/one'), 'account');
  const second = await terminals.request(open('/two'), 'account');
  expect(await terminals.request(list('/one'), 'account')).toEqual([first]);
  expect(await terminals.request(list('/two'), 'account')).toEqual([second]);
  expect(await terminals.request(list('/empty'), 'account')).toEqual([]);
  expect(await terminals.request(list('/one'), 'other-account')).toEqual([]);
  await terminals.request({ operation: 'guiTerminalWrite', id: 'shell-1', data: 'cd /two\r' }, 'account');
  expect(await terminals.request(list('/two'), 'account')).toEqual([second]);
  const client = createGuiToolsClient(<T>(body: object) =>
    terminals.request(body as Record<string, unknown>, 'account') as Promise<T>);
  expect(await client.terminal.list('/one')).toEqual([first]);
  expect(await client.terminal.read('shell-2', 0)).toMatchObject({
    events: [{ type: 'output', data: [...new TextEncoder().encode('/two')] }],
  });
  await client.terminal.close('shell-1');
  expect(await client.terminal.list('/one')).toEqual([]);
  expect(await client.terminal.list('/two')).toEqual([second]);
});

it('retains project identity when Rust resolves a symlink or chooses the default home directory', async () => {
  const terminals = new RemoteTerminals();
  vi.mocked(terminalApi.open).mockResolvedValueOnce({ id: 'link', cwd: '/real', shell: 'bash' });
  vi.mocked(terminalApi.open).mockResolvedValueOnce({ id: 'home', cwd: '/home/user', shell: 'bash' });
  const linked = await terminals.request(open('/link'), 'account');
  const unassigned = await terminals.request(open(''), 'account');
  expect(await terminals.request(list('/link/'), 'account')).toEqual([linked]);
  expect(await terminals.request(list('/real'), 'account')).toEqual([]);
  expect(await terminals.request(list(''), 'account')).toEqual([unassigned]);
  expect(await terminals.request(list('/home/user'), 'account')).toEqual([]);
  await expect(terminals.request({ operation: 'guiTerminalList', cwd: 1 }, 'account')).rejects.toThrow('项目目录');
});

it.each([
  ['F:\\Projects\\Demo\\', 'f:/projects/demo'],
  ['\\\\?\\F:\\projects\\demo', 'f:/projects/demo/'],
  ['\\\\?\\UNC\\server\\share\\demo', '//server/share/demo'],
  ['/projects/demo/', '/projects/demo'],
  ['', '   '],
])('recognizes equivalent project paths %s and %s', (left, right) => {
  expect(terminalProjectKey(left)).toBe(terminalProjectKey(right));
});

it.each([['/Project', '/project'], ['/project', '/project/sub'], ['', '/'],
  ['/project\\name', '/project/name']])('keeps distinct projects %s and %s separate', (left, right) => {
  expect(terminalProjectKey(left)).not.toBe(terminalProjectKey(right));
});
