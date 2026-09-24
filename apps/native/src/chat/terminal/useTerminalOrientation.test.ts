import { beforeEach, expect, it, vi } from 'vitest';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useTerminalOrientation } from './useTerminalOrientation';

const observed = vi.hoisted(() => ({ effects: [] as Array<() => (() => void) | undefined>,
  updates: [] as unknown[], remove: vi.fn() }));
vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, (value: unknown) => observed.updates.push(value)],
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => (() => void) | undefined) => observed.effects.push(effect),
}));
vi.mock('react-native', () => ({ Keyboard: { dismiss: vi.fn() } }));
vi.mock('expo-screen-orientation', () => ({
  Orientation: { PORTRAIT_UP: 1, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 },
  OrientationLock: { PORTRAIT_UP: 3, LANDSCAPE: 5 },
  lockAsync: vi.fn(async () => {}),
  getOrientationAsync: vi.fn(async () => 1),
  addOrientationChangeListener: vi.fn(() => ({ remove: observed.remove })),
}));

const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function open() {
  const orientation = useTerminalOrientation(true);
  const cleanup = observed.effects[0]()!;
  return { ...orientation, cleanup };
}
beforeEach(() => { vi.clearAllMocks(); observed.effects = []; observed.updates = []; });

it('ignores repeated presses and restores portrait after an in-flight rotation finishes', async () => {
  let finish!: () => void;
  vi.mocked(ScreenOrientation.lockAsync).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const orientation = open();
  orientation.rotate(); orientation.rotate();
  await flush();
  expect(ScreenOrientation.lockAsync).toHaveBeenCalledExactlyOnceWith(ScreenOrientation.OrientationLock.LANDSCAPE);
  orientation.cleanup();
  expect(observed.remove).toHaveBeenCalledOnce();
  expect(ScreenOrientation.lockAsync).toHaveBeenCalledTimes(1);
  finish(); await flush();
  expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.PORTRAIT_UP);
});

it('cancels a queued rotation when the terminal is hidden immediately', async () => {
  const orientation = open();
  orientation.rotate(); orientation.cleanup(); await flush();
  expect(ScreenOrientation.lockAsync).toHaveBeenCalledExactlyOnceWith(ScreenOrientation.OrientationLock.PORTRAIT_UP);
});

it('allows retry after rotation fails and shows a concise error', async () => {
  vi.mocked(ScreenOrientation.lockAsync).mockRejectedValueOnce(new Error('Native orientation failure'));
  const orientation = open();
  orientation.rotate(); await flush();
  expect(observed.updates).toContain('旋转失败，请重试');
  orientation.rotate(); await flush();
  expect(ScreenOrientation.lockAsync).toHaveBeenCalledTimes(2);
  orientation.cleanup(); await flush();
});

it('reads actual screen orientation instead of treating a keyboard resize as rotation', async () => {
  vi.mocked(ScreenOrientation.getOrientationAsync).mockResolvedValueOnce(ScreenOrientation.Orientation.LANDSCAPE_LEFT);
  const orientation = open(); await flush();
  expect(observed.updates.at(-1)).toBe(true);
  const listener = vi.mocked(ScreenOrientation.addOrientationChangeListener).mock.calls[0][0];
  listener({ orientationInfo: { orientation: ScreenOrientation.Orientation.PORTRAIT_UP },
    orientationLock: ScreenOrientation.OrientationLock.PORTRAIT_UP });
  expect(observed.updates.at(-1)).toBe(false);
  orientation.cleanup(); await flush();
});
