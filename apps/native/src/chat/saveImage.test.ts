import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageSavePermissionError, saveImage } from './saveImage';
import { DEFAULT_CHAT_POLICY, MIB, setChatPolicy } from '../../../../shared/remote-chat/policy';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android', Version: 35 },
  disk: { makeDirectoryAsync: vi.fn(), writeAsStringAsync: vi.fn(), downloadAsync: vi.fn(),
    moveAsync: vi.fn(), deleteAsync: vi.fn(), getInfoAsync: vi.fn() },
  permission: vi.fn(), album: vi.fn(), mediaStore: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-file-system', () => ({
  ...mocks.disk, cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' },
}));
vi.mock('expo-media-library', () => ({
  requestPermissionsAsync: mocks.permission, saveToLibraryAsync: mocks.album,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'unique-id' }));
vi.mock('react-native-blob-util', () => ({
  default: { MediaCollection: { copyToMediaStore: mocks.mediaStore } },
}));
const directory = 'file:///cache/save-image-unique-id/';
afterEach(() => setChatPolicy(DEFAULT_CHAT_POLICY));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform.OS = 'android';
  mocks.platform.Version = 35;
  mocks.permission.mockResolvedValue({ granted: true });
  mocks.disk.deleteAsync.mockResolvedValue(undefined);
  mocks.disk.getInfoAsync.mockResolvedValue({ exists: true, size: 100 });
});

it('saves original inline bytes to Android Pictures without requesting access to existing photos', async () => {
  await saveImage('data:image/png;base64,aGVsbG8=');
  expect(mocks.permission).not.toHaveBeenCalled();
  expect(mocks.disk.writeAsStringAsync).toHaveBeenCalledWith(directory + 'image.png', 'aGVsbG8=',
    { encoding: 'base64' });
  expect(mocks.mediaStore).toHaveBeenCalledWith({
    name: 'RemoteAI-unique-id.png', parentFolder: 'Remote AI', mimeType: 'image/png',
  }, 'Image', '/cache/save-image-unique-id/image.png');
  expect(mocks.disk.deleteAsync).toHaveBeenCalledWith(directory, { idempotent: true });
});

it('uses the response MIME type for remote images with no filename extension', async () => {
  mocks.disk.downloadAsync.mockResolvedValue({
    status: 200, uri: directory + 'download', headers: { 'Content-Type': 'image/jpeg; charset=binary' },
  });
  await saveImage('https://example.test/image?id=123');
  expect(mocks.disk.moveAsync).toHaveBeenCalledWith({ from: directory + 'download', to: directory + 'image.jpg' });
  expect(mocks.mediaStore).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/jpeg' }),
    'Image', '/cache/save-image-unique-id/image.jpg');
});

it('uses updated download settings when saving remote images above the old cap', async () => {
  mocks.disk.downloadAsync.mockResolvedValue({
    status: 200, uri: directory + 'download', headers: { 'content-type': 'image/png' },
  });
  mocks.disk.getInfoAsync.mockResolvedValue({ exists: true, size: 21 * MIB });
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: 100 });
  await saveImage('https://example.test/image');
  expect(mocks.mediaStore).toHaveBeenCalledOnce();
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: 10 });
  await expect(saveImage('https://example.test/image')).rejects.toThrow('10 MB');
  expect(mocks.mediaStore).toHaveBeenCalledOnce();
});

it.each(['ios', 'android'])('requests write-only access on %s when needed', async (platform) => {
  mocks.platform.OS = platform;
  mocks.platform.Version = 28;
  await saveImage('data:image/gif;base64,aGVsbG8=');
  expect(mocks.permission).toHaveBeenCalledWith(true);
  expect(mocks.album).toHaveBeenCalledWith(directory + 'image.gif');
  expect(mocks.mediaStore).not.toHaveBeenCalled();
});

it('does not download or save when album permission is denied', async () => {
  mocks.platform.OS = 'ios';
  mocks.permission.mockResolvedValue({ granted: false });
  await expect(saveImage('https://example.test/image')).rejects.toBeInstanceOf(ImageSavePermissionError);
  expect(mocks.disk.makeDirectoryAsync).not.toHaveBeenCalled();
  expect(mocks.album).not.toHaveBeenCalled();
});

it.each([
  { status: 404, headers: { 'content-type': 'image/png' } },
  { status: 200, headers: { 'content-type': 'text/html' } },
])('rejects unsuccessful and non-image downloads: %o', async (response) => {
  mocks.disk.downloadAsync.mockResolvedValue({ ...response, uri: directory + 'download' });
  await expect(saveImage('https://example.test/image')).rejects.toThrow('Invalid image response');
  expect(mocks.mediaStore).not.toHaveBeenCalled();
  expect(mocks.disk.deleteAsync).toHaveBeenCalledWith(directory, { idempotent: true });
});

it('reports save errors and cleans up the temporary original', async () => {
  mocks.mediaStore.mockRejectedValue(new Error('disk full'));
  await expect(saveImage('data:image/png;base64,aGVsbG8=')).rejects.toThrow('disk full');
  expect(mocks.disk.deleteAsync).toHaveBeenCalledWith(directory, { idempotent: true });
});
