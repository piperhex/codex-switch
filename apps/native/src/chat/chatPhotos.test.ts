import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CHAT_PHOTOS, MAX_PHOTO_DATA_CHARS, PhotoPermissionError,
  preparePhoto, selectPhotos, validatePhotos } from './chatPhotos';
import type { ImagePickerAsset } from 'expo-image-picker';

const mocks = vi.hoisted(() => ({ library: vi.fn(), camera: vi.fn(), permission: vi.fn(), manipulate: vi.fn() }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mocks.library,
  launchCameraAsync: mocks.camera, requestCameraPermissionsAsync: mocks.permission }));
vi.mock('expo-image-manipulator', () => ({ manipulateAsync: mocks.manipulate, SaveFormat: { JPEG: 'jpeg' } }));
beforeEach(() => vi.resetAllMocks());

describe('chat photos', () => {
  it('uses the system photo picker without requesting broad access and preserves cancellation', async () => {
    mocks.library.mockResolvedValue({ canceled: true, assets: null });
    expect(await selectPhotos('library', 3)).toEqual({ canceled: true, assets: null });
    expect(mocks.library).toHaveBeenCalledWith(expect.objectContaining({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3,
    }));
    expect(mocks.permission).not.toHaveBeenCalled();
  });

  it.each([true, false])('does not open the camera when denied (canAskAgain: %s)', async (canAskAgain) => {
    mocks.permission.mockResolvedValue({ granted: false, canAskAgain });
    await expect(selectPhotos('camera', 1)).rejects.toMatchObject(new PhotoPermissionError(canAskAgain));
    expect(mocks.camera).not.toHaveBeenCalled();
  });

  it('opens the camera after permission is granted', async () => {
    mocks.permission.mockResolvedValue({ granted: true });
    mocks.camera.mockResolvedValue({ canceled: false, assets: [] });
    await selectPhotos('camera', 1);
    expect(mocks.camera).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'] }));
  });

  it('reads the selected URI and sends normalized image bytes instead of a phone file path', async () => {
    const asset: ImagePickerAsset = { uri: 'content://photos/selected', width: 4000, height: 3000 };
    mocks.manipulate.mockResolvedValue({ uri: 'file:///cache/photo.jpg', base64: '/9j/photo' });
    expect(await preparePhoto(asset)).toEqual({ id: 'file:///cache/photo.jpg',
      uri: 'file:///cache/photo.jpg', dataUrl: 'data:image/jpeg;base64,/9j/photo' });
    expect(mocks.manipulate).toHaveBeenCalledWith(asset.uri, [{ resize: { width: 2048 } }],
      { format: 'jpeg', compress: 0.8, base64: true });
  });

  it('rejects a photo that could not be read', async () => {
    mocks.manipulate.mockResolvedValue({ uri: 'file:///cache/empty.jpg', base64: null });
    await expect(preparePhoto({ uri: 'content://photos/empty', width: 100, height: 200 }))
      .rejects.toThrow('照片读取失败');
  });

  it('bounds the photo count and combined message size', () => {
    const photo = { id: 'photo', uri: 'file:///photo', dataUrl: 'data:image/jpeg;base64,photo' };
    expect(() => validatePhotos(Array.from({ length: MAX_CHAT_PHOTOS }, () => photo))).not.toThrow();
    expect(() => validatePhotos(Array.from({ length: MAX_CHAT_PHOTOS + 1 }, () => photo))).toThrow('最多');
    expect(() => validatePhotos([{ ...photo, dataUrl: 'a'.repeat(MAX_PHOTO_DATA_CHARS + 1) }])).toThrow('总大小');
  });
});
