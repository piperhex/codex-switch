import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as storage from 'expo-secure-store';
import { getLanguage } from './index';
import { setInterfaceLanguage } from '../../../../shared/i18n/interfaceLanguage';
import { LANGUAGE_KEY, loadLanguage, setLanguage } from './preference';

vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.setItemAsync).mockResolvedValue(undefined);
  setInterfaceLanguage('zh');
});
afterEach(() => setInterfaceLanguage('zh'));

it.each(['zh', 'en', 'ru'] as const)('restores the saved %s preference', async language => {
  vi.mocked(storage.getItemAsync).mockResolvedValue(language);
  await loadLanguage();
  expect(getLanguage()).toBe(language);
});

it('does not let a slow startup read overwrite a newer choice', async () => {
  let finish!: (value: string) => void;
  vi.mocked(storage.getItemAsync).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const loaded = loadLanguage();
  await setLanguage('ru'); finish('zh'); await loaded;
  expect(getLanguage()).toBe('ru');
});

it('serializes preference writes and reports storage failures while retaining the chosen language', async () => {
  let finish!: () => void;
  vi.mocked(storage.setItemAsync).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const first = setLanguage('en'); const second = setLanguage('ru');
  await Promise.resolve();
  expect(storage.setItemAsync).toHaveBeenCalledTimes(1);
  finish(); await Promise.all([first, second]);
  expect(storage.setItemAsync).toHaveBeenLastCalledWith(LANGUAGE_KEY, 'ru');
  vi.mocked(storage.setItemAsync).mockRejectedValueOnce(new Error('storage unavailable'));
  expect(await setLanguage('en')).toBe(false);
  expect(getLanguage()).toBe('en');
});
