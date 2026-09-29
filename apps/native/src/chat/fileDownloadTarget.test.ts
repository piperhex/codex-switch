import { beforeEach, expect, it, vi } from 'vitest';
import { nativeDownloadTarget } from './fileDownloadTarget';
import type { FileInfo } from '../../../../shared/remote-chat/fileDownload';
const mocks = vi.hoisted(() => ({
  platform: { OS: 'android', Version: 35 }, permission: vi.fn(),
  stream: { write: vi.fn(), close: vi.fn() }, copy: vi.fn(), preview: vi.fn(),
  fs: { writeStream: vi.fn(), exists: vi.fn(), unlink: vi.fn(), mkdir: vi.fn(), mv: vi.fn() },
}));
vi.mock('react-native', () => ({ Platform: mocks.platform, PermissionsAndroid: {
  request: mocks.permission, PERMISSIONS: { WRITE_EXTERNAL_STORAGE: 'write' }, RESULTS: { GRANTED: 'granted' },
} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'unique' }));
vi.mock('react-native-blob-util', () => ({ default: {
  fs: { ...mocks.fs, dirs: { CacheDir: '/cache', DownloadDir: '/downloads', DocumentDir: '/documents' } },
  MediaCollection: { copyToMediaStore: mocks.copy }, ios: { previewDocument: mocks.preview },
} }));
const info: FileInfo = { id: 'id', size: 2, name: '安装包.apk', mimeType: 'application/octet-stream' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.platform.OS = 'android'; mocks.platform.Version = 35;
  mocks.fs.writeStream.mockResolvedValue(mocks.stream);
  mocks.fs.exists.mockResolvedValue(true); mocks.copy.mockResolvedValue('content://downloads/1');
});

it('streams original binary chunks and closes the file before publishing its original name', async () => {
  const target = await nativeDownloadTarget(info);
  await target.write('AP8=');
  expect(mocks.copy).not.toHaveBeenCalled();
  await target.finish(); await target.dispose();
  expect(mocks.fs.writeStream).toHaveBeenCalledWith('/cache/download-unique', 'base64', false);
  expect(mocks.stream.write).toHaveBeenCalledWith('AP8=');
  expect(mocks.stream.close).toHaveBeenCalledOnce();
  expect(mocks.copy).toHaveBeenCalledWith({ name: info.name, parentFolder: 'Remote AI', mimeType: info.mimeType },
    'Download', '/cache/download-unique');
  expect(mocks.stream.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.copy.mock.invocationCallOrder[0]);
  expect(mocks.fs.unlink).toHaveBeenCalledWith('/cache/download-unique');
  expect(mocks.permission).not.toHaveBeenCalled();
});

it('removes a cancelled partial file without publishing it', async () => {
  const target = await nativeDownloadTarget(info);
  await target.write('AA=='); await target.dispose();
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(mocks.stream.close).toHaveBeenCalledOnce();
  expect(mocks.fs.unlink).toHaveBeenCalledOnce();
});

it('removes the temporary download even when publishing fails', async () => {
  mocks.copy.mockRejectedValueOnce(new Error('disk full'));
  const target = await nativeDownloadTarget(info);
  await expect(target.finish()).rejects.toThrow('disk full');
  await target.dispose();
  expect(mocks.fs.unlink).toHaveBeenCalledOnce();
});

it('does not create temporary files when storage permission is denied on older Android', async () => {
  mocks.platform.Version = 28; mocks.permission.mockResolvedValue('denied');
  await expect(nativeDownloadTarget(info)).rejects.toThrow();
  expect(mocks.fs.writeStream).not.toHaveBeenCalled();
});
