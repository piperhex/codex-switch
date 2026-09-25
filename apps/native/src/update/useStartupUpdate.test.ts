import { beforeEach, expect, it, vi } from 'vitest';
import { useStartupUpdate } from '../../../../shared/app-update/useStartupUpdate';

const hooks = vi.hoisted(() => ({
  release: null as { version: string } | null,
  refs: [] as Array<{ current: unknown }>, cursor: 0,
  effect: null as (() => () => void) | null,
}));
vi.mock('react', () => ({
  useState: () => [hooks.release, (value: typeof hooks.release) => { hooks.release = value; }],
  useRef: (current: unknown) => {
    const index = hooks.cursor++;
    return hooks.refs[index] ??= { current };
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: typeof hooks.effect) => { hooks.effect = effect; },
}));
const options = { check: vi.fn(), readIgnoredVersion: vi.fn(), writeIgnoredVersion: vi.fn() };
const release = { version: '1.6.0' };

function render() {
  hooks.cursor = 0;
  return useStartupUpdate<{ version: string }>(options);
}
function launch() {
  hooks.refs = [];
  hooks.release = null;
  render();
  return hooks.effect?.();
}
beforeEach(() => {
  vi.resetAllMocks();
  options.check.mockResolvedValue(release);
  options.readIgnoredVersion.mockResolvedValue(null);
  options.writeIgnoredVersion.mockResolvedValue(undefined);
});

it('checks once during Strict Mode replay and checks again on a fresh launch', async () => {
  const cleanup = launch();
  cleanup?.();
  render();
  hooks.effect?.();
  await vi.waitFor(() => expect(hooks.release).toEqual(release));
  expect(options.check).toHaveBeenCalledOnce();
  launch();
  await vi.waitFor(() => expect(hooks.release).toEqual(release));
  expect(options.check).toHaveBeenCalledTimes(2);
});

it('persists ignoring through relaunch but allows a newer version', async () => {
  let ignored: string | null = null;
  options.readIgnoredVersion.mockImplementation(async () => ignored);
  options.writeIgnoredVersion.mockImplementation(async (version: string) => { ignored = version; });
  launch();
  await vi.waitFor(() => expect(hooks.release).toEqual(release));
  await render().ignoreVersion();
  expect(ignored).toBe(release.version);
  expect(hooks.release).toBeNull();
  launch();
  await vi.waitFor(() => expect(options.check).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(hooks.release).toBeNull();
  options.check.mockResolvedValue({ version: '1.7.0' });
  launch();
  await vi.waitFor(() => expect(hooks.release).toEqual({ version: '1.7.0' }));
});

it('keeps the prompt when saving the ignored version fails and supports retry', async () => {
  options.writeIgnoredVersion.mockRejectedValueOnce(new Error('storage'));
  launch();
  await vi.waitFor(() => expect(hooks.release).toEqual(release));
  await expect(render().ignoreVersion()).rejects.toThrow('storage');
  expect(hooks.release).toEqual(release);
  await render().ignoreVersion();
  expect(hooks.release).toBeNull();
});

it('does not require readable storage to show an available update', async () => {
  options.readIgnoredVersion.mockRejectedValue(new Error('storage'));
  launch();
  await vi.waitFor(() => expect(hooks.release).toEqual(release));
});

it('silently handles failed checks and retries on the next launch', async () => {
  options.check.mockRejectedValueOnce(new Error('offline'));
  launch();
  await vi.waitFor(() => expect(options.readIgnoredVersion).toHaveBeenCalledOnce());
  expect(hooks.release).toBeNull();
  launch();
  await vi.waitFor(() => expect(hooks.release).toEqual(release));
});

it('does not show a late response after unmounting', async () => {
  let resolve!: (value: typeof release) => void;
  options.check.mockReturnValue(new Promise((done) => { resolve = done; }));
  const cleanup = launch();
  cleanup?.();
  resolve(release);
  await options.check.mock.results[0].value;
  await Promise.resolve();
  expect(hooks.release).toBeNull();
});

it('dismisses only the current prompt without remembering the version', async () => {
  launch();
  await vi.waitFor(() => expect(hooks.release).toEqual(release));
  render().dismiss();
  expect(options.writeIgnoredVersion).not.toHaveBeenCalled();
  expect(hooks.release).toBeNull();
  launch();
  await vi.waitFor(() => expect(hooks.release).toEqual(release));
});
