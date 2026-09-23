import { beforeEach, expect, it, vi } from 'vitest';
import { chatAccountKey } from './notificationTarget';
import { loadLastSelectedDevice, saveLastSelectedDevice } from './lastSelectedDevice';

const disk = vi.hoisted(() => ({ values: new Map<string, string>(), read: vi.fn(), write: vi.fn() }));
vi.mock('expo-secure-store', () => ({ getItemAsync: disk.read, setItemAsync: disk.write }));
const session = { baseUrl: 'https://example.test', email: 'user@example.test' };
const account = chatAccountKey(session);

beforeEach(() => {
  disk.values.clear();
  disk.read.mockReset().mockImplementation(async (key: string) => disk.values.get(key) ?? null);
  disk.write.mockReset().mockImplementation(async (key: string, value: string) => { disk.values.set(key, value); });
});

it('restores a selection from persistent storage and separates accounts and servers', async () => {
  await saveLastSelectedDevice(account, 'laptop');
  expect(await loadLastSelectedDevice(account)).toBe('laptop');
  const normalized = chatAccountKey({ baseUrl: session.baseUrl + '/', email: ' USER@EXAMPLE.TEST ' });
  expect(await loadLastSelectedDevice(normalized)).toBe('laptop');
  const otherAccount = chatAccountKey({ ...session, email: 'other@example.test' });
  const otherServer = chatAccountKey({ ...session, baseUrl: 'https://other.test' });
  expect(await loadLastSelectedDevice(otherAccount)).toBeNull();
  expect(await loadLastSelectedDevice(otherServer)).toBeNull();
  await saveLastSelectedDevice(otherAccount, 'desktop');
  expect(await loadLastSelectedDevice(account)).toBe('laptop');
});

it('serializes rapid selections and waits for the latest write before restoring on remount', async () => {
  let finish!: () => void;
  disk.write.mockImplementationOnce((key: string, value: string) => new Promise<void>((resolve) => {
    finish = () => { disk.values.set(key, value); resolve(); };
  }));
  const first = saveLastSelectedDevice(account, 'desktop');
  const second = saveLastSelectedDevice(account, 'laptop');
  const restored = loadLastSelectedDevice(account);
  await vi.waitFor(() => expect(disk.write).toHaveBeenCalledOnce());
  expect(disk.read).not.toHaveBeenCalled();
  finish();
  await Promise.all([first, second]);
  expect(await restored).toBe('laptop');
});

it('recovers from unavailable storage and permits later selections to be saved', async () => {
  disk.read.mockRejectedValueOnce(new Error('unavailable'));
  expect(await loadLastSelectedDevice(account)).toBeNull();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    disk.write.mockRejectedValueOnce(new Error('full'));
    await saveLastSelectedDevice(account, 'desktop');
    await saveLastSelectedDevice(account, 'laptop');
    expect(await loadLastSelectedDevice(account)).toBe('laptop');
    expect(warning).toHaveBeenCalledOnce();
  } finally { warning.mockRestore(); }
});
