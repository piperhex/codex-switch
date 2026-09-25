// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useRemoteTerminalPanel } from '../../../../shared/remote-chat/useRemoteTerminalPanel';
import type { TerminalInfo } from '../../../../shared/terminal/types';

const info = { id: 'retained', cwd: '/original-project', shell: 'bash' };
function fixture() {
  const client = { list: vi.fn(async (): Promise<TerminalInfo[]> => [info]),
    open: vi.fn(async () => ({ ...info, id: 'new' })), close: vi.fn(async () => {}),
    read: vi.fn(async () => ({ found: true, cursor: 0, truncated: false, events: [] })),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}) };
  const root = createRoot(document.createElement('div'));
  let panel!: ReturnType<typeof useRemoteTerminalPanel>;
  function Fixture({ connected }: { connected: boolean }) {
    panel = useRemoteTerminalPanel({ client, cwd: '/new-project', connected }); return null;
  }
  return { client, panel: () => panel, root,
    render: (connected = true) => act(async () => root.render(<Fixture connected={connected} />)) };
}
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.restoreAllMocks());

it('restores the PC list after remount, hides without closing, and closes only on explicit removal', async () => {
  const test = fixture();
  try {
    await test.render();
    expect(test.panel().tabs[0].session).toEqual(info);
    await act(async () => test.panel().toggle());
    expect(test.panel().open).toBe(true);
    await act(async () => test.panel().hide());
    expect(test.client.close).not.toHaveBeenCalled();
    expect(test.client.open).not.toHaveBeenCalled();
    await act(async () => test.panel().remove(info.id));
    expect(test.client.close).toHaveBeenCalledWith(info.id);
    expect(test.panel().tabs).toEqual([]);
  } finally { await act(async () => test.root.unmount()); }
});

it('keeps failed close actions visible and discovers shells created while the phone was disconnected', async () => {
  const test = fixture();
  try {
    await test.render();
    test.client.close.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => test.panel().remove(info.id));
    expect(test.panel().error).not.toBe('');
    expect(test.panel().tabs).toHaveLength(1);
    await test.render(false);
    test.client.list.mockResolvedValue([info, { ...info, id: 'another' }]);
    await test.render();
    expect(test.panel().tabs.map(tab => tab.id)).toEqual(['retained', 'another']);
    expect(test.client.open).not.toHaveBeenCalled();
  } finally { await act(async () => test.root.unmount()); }
});

it('does not let a stale initial list replace a newly opened terminal', async () => {
  const test = fixture();
  let finish!: (sessions: TerminalInfo[]) => void;
  test.client.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  test.client.list.mockResolvedValue([]);
  try {
    await test.render();
    await act(async () => test.panel().toggle());
    expect(test.client.open).toHaveBeenCalledOnce();
    await act(async () => finish([]));
    expect(test.panel().tabs[0].id).toBe('new');
    await act(async () => test.root.unmount());
    expect(test.client.close).not.toHaveBeenCalled();
  } finally { await act(async () => test.root.unmount()); }
});
