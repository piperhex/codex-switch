import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { copyText, MAX_ANDROID_CLIPBOARD_CHARACTERS, saveTextFile } from './copyText';
import { DEFAULT_CHAT_POLICY, MIB, setChatPolicy } from '../../../../shared/remote-chat/policy';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android', Version: 31 }, clipboard: vi.fn(), mediaStore: vi.fn(),
  disk: { makeDirectoryAsync: vi.fn(), writeAsStringAsync: vi.fn(), deleteAsync: vi.fn() },
  picker: { requestDirectoryPermissionsAsync: vi.fn(), createFileAsync: vi.fn() },
}));
vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-clipboard', () => ({ setStringAsync: mocks.clipboard }));
vi.mock('expo-file-system', () => ({ ...mocks.disk, cacheDirectory: 'file:///cache/',
  EncodingType: { UTF8: 'utf8' }, StorageAccessFramework: mocks.picker }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'unique-id' }));
vi.mock('react-native-blob-util', () => ({ default: { MediaCollection: { copyToMediaStore: mocks.mediaStore } } }));

afterEach(() => setChatPolicy(DEFAULT_CHAT_POLICY));
beforeEach(() => {
  vi.resetAllMocks(); mocks.platform.OS = 'android'; mocks.platform.Version = 31;
  mocks.disk.deleteAsync.mockResolvedValue(undefined);
});

it('preserves normal clipboard behavior without writing files', async () => {
  const text = '<div>完整内容🙂</div>';
  expect(await copyText(text)).toBe('copied');
  expect(mocks.clipboard).toHaveBeenCalledWith(text);
  expect(mocks.disk.writeAsStringAsync).not.toHaveBeenCalled();
});

it('offers file saving before sending an oversized Android clipboard transaction', async () => {
  expect(await copyText('a'.repeat(MAX_ANDROID_CLIPBOARD_CHARACTERS))).toBe('copied');
  mocks.clipboard.mockClear();
  expect(await copyText('a'.repeat(MAX_ANDROID_CLIPBOARD_CHARACTERS + 1))).toBe('too-large');
  expect(mocks.clipboard).not.toHaveBeenCalled();
  expect(mocks.disk.writeAsStringAsync).not.toHaveBeenCalled();
});

it('leaves the existing iOS clipboard path intact and reports smaller clipboard failures', async () => {
  mocks.platform.OS = 'ios';
  expect(await copyText('a'.repeat(MAX_ANDROID_CLIPBOARD_CHARACTERS + 1))).toBe('copied');
  mocks.clipboard.mockRejectedValue(new Error('clipboard unavailable'));
  expect(await copyText('text')).toBe('failed');
});

it('saves every original UTF-8 character to Downloads without broad storage permissions', async () => {
  const text = '<div>完整输出🙂</div>\n'.repeat(70_000);
  expect(await saveTextFile(text)).toEqual({ filename: 'RemoteAI-output-unique-id.txt', location: 'downloads' });
  expect(mocks.disk.writeAsStringAsync).toHaveBeenCalledWith('file:///cache/save-text-unique-id/output.txt',
    text, { encoding: 'utf8' });
  expect(mocks.mediaStore).toHaveBeenCalledWith({ name: 'RemoteAI-output-unique-id.txt',
    parentFolder: 'Remote AI', mimeType: 'text/plain' }, 'Download', '/cache/save-text-unique-id/output.txt');
  expect(mocks.picker.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
  expect(mocks.disk.deleteAsync).toHaveBeenCalledWith('file:///cache/save-text-unique-id/', { idempotent: true });
});

it('preserves cancellation of the folder picker on older Android devices', async () => {
  mocks.platform.Version = 28;
  mocks.picker.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });
  expect(await saveTextFile('complete')).toBeNull();
  expect(mocks.disk.writeAsStringAsync).not.toHaveBeenCalled();
  expect(mocks.mediaStore).not.toHaveBeenCalled();
});

it('uses updated download settings for text exports above the old cap', async () => {
  const text = 'a'.repeat(21 * MIB);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: 100 });
  await expect(saveTextFile(text)).resolves.toMatchObject({ location: 'downloads' });
  expect(mocks.mediaStore).toHaveBeenCalledOnce();
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: 10 });
  await expect(saveTextFile(text)).rejects.toThrow('10 MB');
  expect(mocks.mediaStore).toHaveBeenCalledOnce();
});

it('writes only to the system-selected folder when scoped downloads are unavailable', async () => {
  mocks.platform.Version = 28;
  mocks.picker.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://chosen' });
  mocks.picker.createFileAsync.mockResolvedValue('content://chosen/output');
  expect(await saveTextFile('完整文本')).toMatchObject({ location: 'selected' });
  expect(mocks.picker.createFileAsync).toHaveBeenCalledWith('content://chosen',
    'RemoteAI-output-unique-id.txt', 'text/plain');
  expect(mocks.disk.writeAsStringAsync).toHaveBeenCalledWith('content://chosen/output', '完整文本', { encoding: 'utf8' });
});

it('reports failed saves and cleans up temporary text without pretending a copy succeeded', async () => {
  mocks.mediaStore.mockRejectedValue(new Error('disk full'));
  await expect(saveTextFile('full text')).rejects.toThrow('disk full');
  expect(mocks.disk.deleteAsync).toHaveBeenCalledWith('file:///cache/save-text-unique-id/', { idempotent: true });
  expect(mocks.clipboard).not.toHaveBeenCalled();
});
