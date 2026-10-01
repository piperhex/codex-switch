// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn(), emit: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ emit: native.emit, listen: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  localStorage.clear();
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
});
afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  vi.restoreAllMocks();
});

it('saves rapid language choices in order and broadcasts only the latest choice', async () => {
  const { publishLanguageChange } = await import('./backend');
  let finish!: () => void;
  native.invoke.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }))
    .mockResolvedValue(undefined);
  const first = publishLanguageChange('en');
  const latest = publishLanguageChange('ru');
  await Promise.resolve();
  expect(native.invoke).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, latest]);
  expect(native.invoke.mock.calls).toEqual([
    ['set_app_language', { language: 'en' }], ['set_app_language', { language: 'ru' }],
  ]);
  expect(native.emit.mock.calls).toEqual([['codex-switch:language-changed', 'ru']]);
});

it('keeps broadcasting with blocked browser storage and recovers after a failed save', async () => {
  const { publishLanguageChange } = await import('./backend');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  native.invoke.mockRejectedValueOnce(new Error('save failed')).mockResolvedValue(undefined);
  await expect(publishLanguageChange('en')).rejects.toThrow('save failed');
  await publishLanguageChange('ru');
  expect(native.emit).toHaveBeenCalledWith('codex-switch:language-changed', 'ru');
});
