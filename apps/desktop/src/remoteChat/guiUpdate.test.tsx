// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGuiToolsClient, type RemoteCliStatus } from '../../../../shared/remote-chat/guiTools';
import { useGuiUpdate } from '../../../../shared/remote-chat/useGuiUpdate';

const request = vi.fn();
const client = createGuiToolsClient(request);
const initial: RemoteCliStatus = { version: '0.155.0', installing: false, progress: null, error: '' };
let update: ReturnType<typeof useGuiUpdate>;
let root: ReturnType<typeof createRoot>;
function Fixture({ connected = true, running = false, active = true, tools = client } = {}) {
  update = useGuiUpdate({ client: tools, connected, running, active }); return null;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
  request.mockReset().mockImplementation(async ({ operation }) => operation === 'guiCliRelease'
    ? { version: '0.156.0', size: 100 } : initial);
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
  request.mockRejectedValue(new Error('private internal path'));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(update.canInstall).toBe(false); expect(update.error).not.toContain('private internal path');
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
