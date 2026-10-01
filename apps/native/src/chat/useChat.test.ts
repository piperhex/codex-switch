import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { useChat } from './useChat';

const runtime = vi.hoisted(() => ({
  controller: undefined as ChatController | undefined,
  effects: [] as Array<() => void>,
  listeners: new Set<(state: string) => void>(),
  state: 'active',
}));
vi.mock('react', () => ({
  useMemo: <T>(create: () => T) => create(),
  useState: <T>(value: T) => [value, () => undefined],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) runtime.effects.push(cleanup);
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() { return runtime.state; },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      runtime.listeners.add(listener);
      return { remove: () => runtime.listeners.delete(listener) };
    },
  },
  DeviceEventEmitter: { addListener: () => ({ remove: () => undefined }) },
}));
vi.mock('./controller', () => ({ ChatController: function Controller() { return runtime.controller; } }));
vi.mock('./backgroundConnection', () => ({ CHAT_SERVICE_STOPPED: 'chat-service-stopped' }));
vi.mock('./useChatCatalog', () => ({ useChatCatalog: () => ({}) }));

beforeEach(() => { vi.useFakeTimers(); runtime.state = 'active'; });
afterEach(() => {
  for (const cleanup of runtime.effects.splice(0)) cleanup();
  runtime.controller = undefined;
  runtime.listeners.clear();
  vi.useRealTimers();
});

function changeAppState(state: string) {
  runtime.state = state;
  for (const listener of runtime.listeners) listener(state);
}

function mount(healthy = false) {
  let events!: ConnectionEvents;
  let active = false;
  let attempts = 0;
  const stop = vi.fn(() => { active = false; events.mode('offline'); });
  const retryNow = vi.fn();
  const request = vi.fn(async (method: string) => method === 'connect' ? [] : { data: [], nextCursor: null });
  runtime.controller = new ChatController(callbacks => {
    events = callbacks;
    return {
      start: () => {
        if (active) return;
        active = true;
        attempts += 1;
        events.mode(healthy ? 'direct' : 'connecting');
        if (healthy) events.ready();
      },
      stop,
      retryNow,
      request: <T>(method: string) => request(method) as Promise<T>,
    };
  });
  useChat({ baseUrl: 'https://example.test', email: 'test@example.test',
    accessToken: 'access', refreshToken: 'refresh' }, 'device', true);
  return { controller: runtime.controller, events, attempts: () => attempts, stop, request, retryNow };
}

it('retries immediately on foreground return while the transport is waiting for automatic retry', () => {
  const client = mount();
  changeAppState('background');
  client.events.mode('offline');
  client.events.retryAt?.(Date.now() + 30_000);
  changeAppState('active');
  expect(client.attempts()).toBe(2);
  expect(client.controller.snapshot()).toMatchObject({ connecting: true, retryAt: null });
  expect(client.stop).toHaveBeenCalledOnce();
});

it('preserves the live P2P session when returning from background', async () => {
  const client = mount(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(client.controller.snapshot().ready).toBe(true);
  changeAppState('background');
  changeAppState('active');
  expect(client.attempts()).toBe(1);
  expect(client.stop).not.toHaveBeenCalled();
  expect(client.request.mock.calls.filter(([method]) => method === 'connect')).toHaveLength(1);
});

it('leaves an in-progress reconnection running when the app becomes active', () => {
  const client = mount();
  changeAppState('background');
  changeAppState('active');
  expect(client.attempts()).toBe(1);
  expect(client.stop).not.toHaveBeenCalled();
});

it('resumes a background socket retry even when the retained chat is already ready', async () => {
  const client = mount(true);
  await vi.advanceTimersByTimeAsync(0);
  changeAppState('background');
  client.events.mode('connecting');
  changeAppState('active');
  expect(client.retryNow).toHaveBeenCalledOnce();
  expect(client.controller.snapshot().ready).toBe(true);
  expect(client.stop).not.toHaveBeenCalled();
  expect(client.request.mock.calls.filter(([method]) => method === 'connect')).toHaveLength(1);
});
