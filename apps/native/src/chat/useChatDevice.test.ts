import { beforeEach, expect, it, vi } from 'vitest';
import type { AuthSession, RemoteDevice } from '../types';
import { resolveChatDevice, useChatDevice } from './useChatDevice';
import { chatAccountKey } from './notificationTarget';

// Replay hook renders and effect cleanup to exercise asynchronous discovery and storage ordering.
const hooks = vi.hoisted(() => ({
  state: undefined as unknown,
  effects: [] as Array<{ dependencies: unknown[]; cleanup?: () => void }>,
  pending: [] as Array<() => void>,
  cursor: 0,
  load: vi.fn(), save: vi.fn(),
}));
vi.mock('./lastSelectedDevice', () => ({ loadLastSelectedDevice: hooks.load, saveLastSelectedDevice: hooks.save }));
vi.mock('react', () => ({
  useState: () => [hooks.state, (next: unknown) => {
    hooks.state = typeof next === 'function' ? next(hooks.state) : next;
  }],
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => (() => void) | void, dependencies: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.effects[index];
    if (previous && dependencies.every((value, offset) => Object.is(value, previous.dependencies[offset]))) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      hooks.effects[index] = { dependencies, cleanup: effect() || undefined };
    });
  },
}));

const session: AuthSession = { baseUrl: 'https://example.test', email: 'user@example.test',
  accessToken: 'access', refreshToken: 'refresh' };
const desktop: RemoteDevice = { deviceId: 'desktop', name: 'Desktop', platform: 'Windows', online: true,
  capabilities: [], localProxyRunning: false, lastSeenAt: '' };
const laptop = { ...desktop, deviceId: 'laptop', name: 'Laptop' };
const offline = { ...desktop, deviceId: 'offline', online: false };
const devices = [offline, desktop, laptop];
const allOffline = devices.map((device) => ({ ...device, online: false }));

function render(options: Partial<Parameters<typeof useChatDevice>[0]> = {}) {
  hooks.cursor = 0;
  const result = useChatDevice({ session, devices, devicesLoaded: true, ...options });
  const effects = hooks.pending.splice(0);
  effects.forEach((effect) => effect());
  return result;
}

beforeEach(() => {
  hooks.effects.forEach((effect) => effect.cleanup?.());
  hooks.effects = []; hooks.pending = []; hooks.cursor = 0; hooks.state = undefined;
  hooks.load.mockReset().mockResolvedValue(laptop.deviceId);
  hooks.save.mockReset().mockResolvedValue(undefined);
});

it('waits for the saved preference before choosing from the online list', async () => {
  expect(render().device).toBeUndefined();
  expect(hooks.save).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(render().device).toBe(laptop);
  expect(hooks.save).toHaveBeenLastCalledWith(chatAccountKey(session), laptop.deviceId);
});

it.each(['offline', 'removed', null])('chooses an online computer when the saved choice is %s', async (remembered) => {
  hooks.load.mockResolvedValue(remembered);
  render();
  await Promise.resolve();
  expect(render().device).toBe(desktop);
  expect(hooks.save).toHaveBeenLastCalledWith(chatAccountKey(session), desktop.deviceId);
});

it('does not pin a cached offline computer before live discovery finishes', async () => {
  render({ devices: allOffline, devicesLoaded: false });
  await Promise.resolve();
  expect(render({ devices: allOffline, devicesLoaded: false }).device?.deviceId).toBe(laptop.deviceId);
  expect(hooks.save).not.toHaveBeenCalled();
  const live = [offline, desktop, { ...laptop, online: false }];
  expect(render({ devices: live }).device).toBe(desktop);
  expect(hooks.save).toHaveBeenLastCalledWith(chatAccountKey(session), desktop.deviceId);
});

it('preserves the preference when all computers are offline or the list is empty', async () => {
  render({ devices: [] });
  await Promise.resolve();
  expect(render({ devices: [] }).device).toBeUndefined();
  expect(render({ devices: allOffline }).device?.deviceId).toBe(laptop.deviceId);
  expect(hooks.save).not.toHaveBeenCalled();
  expect(render().device).toBe(laptop);
});

it('remembers an explicit offline choice and keeps it during live updates', async () => {
  render();
  await Promise.resolve();
  render().chooseDevice(offline.deviceId);
  expect(render().device).toBe(offline);
  expect(hooks.save).toHaveBeenLastCalledWith(chatAccountKey(session), offline.deviceId);
});

it('does not overwrite a manual selection with a slow preference read', async () => {
  let finish!: (id: string) => void;
  hooks.load.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
  render().chooseDevice(desktop.deviceId);
  finish(laptop.deviceId);
  await Promise.resolve();
  expect(render().device).toBe(desktop);
});

it('opens the notification computer even when offline and retains it after the notification is handled', async () => {
  const options = { requestedDeviceId: offline.deviceId };
  expect(render(options).device).toBe(offline);
  await Promise.resolve();
  expect(render().device).toBe(offline);
  expect(hooks.save).toHaveBeenLastCalledWith(chatAccountKey(session), offline.deviceId);
  expect(resolveChatDevice({ devices, devicesLoaded: true, rememberedId: laptop.deviceId,
    selectedId: 'missing-notification-computer' })).toBeUndefined();
});

it('ignores stale preference reads after switching accounts', async () => {
  let finish!: (id: string) => void;
  hooks.load.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(desktop.deviceId);
  render();
  const otherSession = { ...session, email: 'other@example.test' };
  expect(render({ session: otherSession }).device).toBeUndefined();
  await Promise.resolve();
  expect(render({ session: otherSession }).device).toBe(desktop);
  finish(laptop.deviceId);
  await Promise.resolve();
  expect(render({ session: otherSession }).device).toBe(desktop);
});

it('keeps the active conversation when device order or presence changes', async () => {
  render();
  await Promise.resolve();
  render();
  expect(render({ devices: [desktop, { ...laptop, online: false }] }).device?.deviceId).toBe(laptop.deviceId);
});
