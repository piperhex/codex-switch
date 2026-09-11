// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGuiAccounts } from '../../../../shared/remote-chat/client/useGuiAccounts';
import type { GuiAccountsClient, GuiAccountsSnapshot, GuiAccountSelection } from '../../../../shared/remote-chat/guiAccounts';

const snapshot = (id = 'first'): GuiAccountsSnapshot => ({
  selection: { kind: 'account', id }, running: true,
  choices: ['first', 'second'].map((id) => ({ kind: 'account', id, name: id, detail: '', available: true })),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let client: GuiAccountsClient;
let changed: () => void;
let stop = vi.fn<() => void>();
let view: ReturnType<typeof useGuiAccounts>;
let root: Root;
let container: HTMLDivElement;
function Fixture({ active = true }: { active?: boolean }) {
  view = useGuiAccounts(client, active);
  return <span>{JSON.stringify(view.snapshot?.selection)}</span>;
}
const render = (active = true) => act(async () => { root.render(<Fixture active={active} />); });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  stop = vi.fn();
  client = { read: vi.fn().mockResolvedValue(snapshot()), select: vi.fn(),
    subscribe: (listener) => { changed = listener; return stop; } };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

it('receives desktop changes and resyncs after reconnection without polling', async () => {
  await render();
  expect(view.snapshot?.selection).toEqual({ kind: 'account', id: 'first' });
  vi.mocked(client.read).mockResolvedValue(snapshot('second'));
  await act(async () => changed());
  expect(view.snapshot?.selection).toEqual({ kind: 'account', id: 'second' });
  await render(false);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(view.snapshot).toBeNull();
  vi.mocked(client.read).mockResolvedValue(snapshot('first'));
  await render();
  expect(view.snapshot?.selection).toEqual({ kind: 'account', id: 'first' });
});

it('coalesces account events during a read and never applies the stale response', async () => {
  const pending = deferred<GuiAccountsSnapshot>();
  vi.mocked(client.read).mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => { changed(); changed(); });
  expect(client.read).toHaveBeenCalledTimes(1);
  vi.mocked(client.read).mockResolvedValue(snapshot('second'));
  await act(async () => pending.resolve(snapshot('first')));
  expect(client.read).toHaveBeenCalledTimes(2);
  expect(view.snapshot?.selection).toEqual({ kind: 'account', id: 'second' });
});

it('waits for the computer to accept a switch and blocks duplicate taps', async () => {
  await render();
  const pending = deferred<GuiAccountSelection>();
  vi.mocked(client.select).mockReturnValue(pending.promise);
  let first!: Promise<boolean>;
  await act(async () => {
    first = view.select({ kind: 'account', id: 'second' });
    expect(await view.select({ kind: 'account', id: 'second' })).toBe(false);
  });
  expect(view.snapshot?.selection).toEqual({ kind: 'account', id: 'first' });
  expect(client.select).toHaveBeenCalledTimes(1);
  vi.mocked(client.read).mockResolvedValue(snapshot('second'));
  await act(async () => { pending.resolve({ kind: 'account', id: 'second' }); expect(await first).toBe(true); });
  expect(view.snapshot?.selection).toEqual({ kind: 'account', id: 'second' });
});

it('keeps the current account after a failed switch and allows retry', async () => {
  await render();
  vi.mocked(client.select).mockRejectedValueOnce(new Error('failed'));
  await act(async () => { expect(await view.select({ kind: 'account', id: 'second' })).toBe(false); });
  expect(view.snapshot?.selection).toEqual({ kind: 'account', id: 'first' });
  expect(view.error).toContain('请重试');
  vi.mocked(client.select).mockResolvedValue({ kind: 'account', id: 'second' });
  vi.mocked(client.read).mockResolvedValue(snapshot('second'));
  await act(async () => { expect(await view.select({ kind: 'account', id: 'second' })).toBe(true); });
  expect(view.error).toBe('');
});

it('ignores a response from the previous computer and blocks unavailable choices', async () => {
  const pending = deferred<GuiAccountsSnapshot>();
  vi.mocked(client.read).mockReturnValue(pending.promise);
  await render();
  await render(false);
  await act(async () => pending.resolve(snapshot()));
  expect(view.snapshot).toBeNull();
  vi.mocked(client.read).mockResolvedValue({ ...snapshot(), running: false });
  await render();
  await act(async () => { expect(await view.select({ kind: 'account', id: 'second' })).toBe(false); });
  expect(client.select).not.toHaveBeenCalled();
});

it('shows an update hint for an older computer without disrupting chat', async () => {
  vi.mocked(client.read).mockRejectedValue(new Error('当前手机端暂不支持此操作。'));
  await render();
  expect(view.loading).toBe(false);
  expect(view.error).toContain('更新电脑端');
  vi.mocked(client.read).mockResolvedValue(snapshot());
  await act(async () => view.refresh());
  expect(view.error).toBe('');
});

it('does not overwrite a newer desktop selection with a delayed switch acknowledgement', async () => {
  await render();
  const switching = deferred<GuiAccountSelection>();
  const reread = deferred<GuiAccountsSnapshot>();
  vi.mocked(client.select).mockReturnValue(switching.promise);
  let pending!: Promise<boolean>;
  await act(async () => { pending = view.select({ kind: 'account', id: 'second' }); });
  // The desktop switches back before the phone receives the acknowledgement.
  await act(async () => changed());
  vi.mocked(client.read).mockReturnValue(reread.promise);
  await act(async () => {
    switching.resolve({ kind: 'account', id: 'second' });
    expect(await pending).toBe(true);
  });
  expect(view.snapshot?.selection).toEqual({ kind: 'account', id: 'first' });
  await act(async () => reread.resolve(snapshot('first')));
  expect(view.snapshot?.selection).toEqual({ kind: 'account', id: 'first' });
});
