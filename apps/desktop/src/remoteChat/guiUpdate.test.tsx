// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGuiToolsClient, type RemoteCliStatus } from '../../../../shared/remote-chat/guiTools';
import { useGuiUpdate } from '../../../../shared/remote-chat/useGuiUpdate';

const request = vi.fn();
const client = createGuiToolsClient(request);
const initial: RemoteCliStatus = { version: '0.155.0', release: null, installing: false, progress: null, error: '' };
let update: ReturnType<typeof useGuiUpdate>;
let root: ReturnType<typeof createRoot>;
function Fixture({ connected = true, running = false, active = true, tools = client } = {}) {
  update = useGuiUpdate({ client: tools, connected, running, active }); return null;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
  let release: RemoteCliStatus['release'] = null;
  request.mockReset().mockImplementation(async ({ operation }) => {
    if (operation === 'guiCliRelease') return release = { version: '0.156.0', size: 100 };
    return { ...initial, release };
  });
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const calls = (operation: string) => request.mock.calls.filter(([body]) => body.operation === operation);
const check = async () => { await act(async () => update.check()); };
const openConfirmation = async () => { await act(async () => update.requestInstall()); };

it('requires confirmation and blocks install when offline or a task starts before confirming', async () => {
  await act(async () => root.render(<Fixture />));
  await check(); await openConfirmation();
  expect(update.confirmation).toBe('0.156.0'); expect(calls('guiCliInstall')).toHaveLength(0);
  await act(async () => root.render(<Fixture running />));
  await act(async () => update.confirm());
  expect(update.canConfirm).toBe(false); expect(calls('guiCliInstall')).toHaveLength(0);
  await act(async () => root.render(<Fixture connected={false} />));
  expect(update.canCheck).toBe(false); expect(update.canConfirm).toBe(false);
  await act(async () => root.render(<Fixture />));
  await act(async () => update.confirm());
  expect(calls('guiCliInstall')).toEqual([[{ operation: 'guiCliInstall', version: '0.156.0' }]]);
});

it('does not reinstall the current version or install when status could not be read', async () => {
  request.mockImplementation(async ({ operation }) => operation === 'guiCliRelease'
    ? { version: initial.version, size: 100 } : initial);
  await act(async () => root.render(<Fixture />)); await check();
  expect(update.canInstall).toBe(false); expect(update.message).toBe('Codex GUI 已是最新版本。');
  expect(update.checkLabel).toBe('已是最新');
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(update.message).toBe('Codex GUI 已是最新版本。');
  request.mockRejectedValue(new Error('private internal path'));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(update.canInstall).toBe(false); expect(update.error).not.toContain('private internal path');
  expect(update.checkLabel).toBe('检查更新');
});

it('does not assume an empty pending update means the current version has been checked', async () => {
  await act(async () => root.render(<Fixture />));
  expect(update.message).toBe('点击“检查更新”查看是否有新版本。');
  expect(update.checkLabel).toBe('检查更新');
});

it('shows checking and up-to-date feedback even while chat tasks are running', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation(({ operation }) => operation === 'guiCliRelease'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(initial));
  await act(async () => root.render(<Fixture running />));
  let pending!: Promise<void>;
  await act(async () => { pending = update.check(); void update.check(); });
  expect(update.checkLabel).toBe('正在检查更新…');
  expect(update.message).toBe('正在检查更新…');
  expect(update.canCheck).toBe(false); expect(calls('guiCliRelease')).toHaveLength(1);
  await act(async () => { finish({ version: initial.version, size: 0 }); await pending; });
  expect(update.checkLabel).toBe('已是最新');
  expect(update.message).toBe('Codex GUI 已是最新版本。');
  expect(update.canCheck).toBe(true); expect(update.canInstall).toBe(false);
});

it('shows a failed recheck and allows retry instead of claiming a successful check', async () => {
  request.mockImplementation(async ({ operation }) => operation === 'guiCliRelease'
    ? { version: initial.version, size: 0 } : initial);
  await act(async () => root.render(<Fixture />)); await check();
  expect(update.checkLabel).toBe('已是最新');
  request.mockImplementation(async ({ operation }) => {
    if (operation === 'guiCliRelease') throw new Error('network unavailable');
    return initial;
  });
  await check();
  expect(update.error).toBe('未能检查远程 Codex 版本，请稍后重试。');
  expect(update.checkLabel).toBe('检查更新'); expect(update.canCheck).toBe(true);
  expect(update.message).not.toBe('Codex GUI 已是最新版本。');
});

it('ignores old computer release responses after switching computers', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation(({ operation }) => operation === 'guiCliRelease'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(initial));
  await act(async () => root.render(<Fixture />));
  let pending!: Promise<void>;
  await act(async () => { pending = update.check(); });
  const other = createGuiToolsClient(vi.fn().mockResolvedValue({ ...initial, version: '0.160.0' }));
  await act(async () => root.render(<Fixture tools={other} />));
  await act(async () => { finish({ version: '0.156.0', size: 100 }); await pending; });
  expect(update.version).toBe('0.160.0'); expect(update.release).toBeNull(); expect(update.canInstall).toBe(false);
});

it('continues observing downloads after reopening and stops polling when inactive', async () => {
  request.mockResolvedValue({ ...initial, installing: true,
    progress: { downloaded: 50, total: 100, phase: 'downloading' } });
  await act(async () => root.render(<Fixture />));
  expect(update.progress).toBe(50); expect(update.canCheck).toBe(false);
  await act(async () => root.render(<Fixture active={false} />));
  const count = request.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(request).toHaveBeenCalledTimes(count);
  request.mockResolvedValue({ ...initial, version: '0.156.0' });
  await act(async () => root.render(<Fixture />));
  expect(update.version).toBe('0.156.0'); expect(update.installing).toBe(false);
});

it('discards status reads started before installation and prevents duplicate installs', async () => {
  await act(async () => root.render(<Fixture />)); await check();
  let finish!: (value: RemoteCliStatus) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  const downloading = { ...initial, installing: true,
    progress: { downloaded: 50, total: 100, phase: 'downloading' } };
  request.mockResolvedValue(downloading);
  await openConfirmation();
  await act(async () => { update.confirm(); update.confirm(); });
  await act(async () => finish(initial));
  expect(update.installing).toBe(true); expect(calls('guiCliInstall')).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(update.progress).toBe(50);
});

it('invalidates installation confirmation when the selected computer changes', async () => {
  await act(async () => root.render(<Fixture />)); await check(); await openConfirmation();
  const otherRequest = vi.fn().mockImplementation(async ({ operation }) => operation === 'guiCliRelease'
    ? { version: '0.156.0', size: 100 } : initial);
  const other = createGuiToolsClient(otherRequest);
  await act(async () => root.render(<Fixture tools={other} />)); await check();
  expect(update.confirmation).toBeNull(); expect(update.canConfirm).toBe(false);
  await act(async () => update.confirm());
  expect(otherRequest.mock.calls.some(([body]) => body.operation === 'guiCliInstall')).toBe(false);
});
