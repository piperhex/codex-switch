import { beforeEach, expect, it, vi } from 'vitest';
import { startupUpdateOptions } from './startupUpdate';

const native = vi.hoisted(() => ({
  check: vi.fn(), refresh: vi.fn(), state: vi.fn(), get: vi.fn(), set: vi.fn(),
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: native.get, setItemAsync: native.set }));
vi.mock('./appUpdate', () => ({ checkForAppUpdate: native.check,
  refreshAndroidUpdateDownloadState: native.refresh, getAndroidUpdateDownloadState: native.state }));
const release = { version: '1.6.0' };

beforeEach(() => {
  vi.resetAllMocks();
  native.check.mockResolvedValue({ updateAvailable: true, release });
  native.refresh.mockResolvedValue({ status: 'idle' });
  native.state.mockReturnValue({ status: 'idle' });
});

it('checks on every launch and returns the available release without downloading', async () => {
  expect(await startupUpdateOptions.check()).toEqual(release);
  expect(await startupUpdateOptions.check()).toEqual(release);
  expect(native.check).toHaveBeenCalledTimes(2);
});

it('does not offer the current version', async () => {
  native.check.mockResolvedValue({ updateAvailable: false, release });
  expect(await startupUpdateOptions.check()).toBeNull();
});

it.each(['downloading', 'downloaded'])('avoids a duplicate prompt when an update is %s', async (status) => {
  native.state.mockReturnValue({ status });
  expect(await startupUpdateOptions.check()).toBeNull();
  expect(native.check).toHaveBeenCalledOnce();
});

it('still offers an update after a failed download', async () => {
  native.state.mockReturnValue({ status: 'failed' });
  expect(await startupUpdateOptions.check()).toEqual(release);
});

it('persists the exact ignored version in device storage', async () => {
  native.get.mockResolvedValue(release.version);
  await startupUpdateOptions.writeIgnoredVersion(release.version);
  expect(native.set).toHaveBeenCalledWith('codex-switch.mobile.ignored-update-version.v1', release.version);
  expect(await startupUpdateOptions.readIgnoredVersion()).toBe(release.version);
});
