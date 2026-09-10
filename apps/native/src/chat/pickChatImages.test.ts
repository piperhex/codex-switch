import { beforeEach, expect, it, vi } from 'vitest';
import { pickChatImages } from './pickChatImages';

const mocks = vi.hoisted(() => ({
  pick: vi.fn(), resize: vi.fn(), render: vi.fn(), save: vi.fn(), releaseContext: vi.fn(), releaseImage: vi.fn(),
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mocks.pick }));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: () => ({
    resize: mocks.resize, renderAsync: mocks.render, release: mocks.releaseContext,
  }) },
  SaveFormat: { JPEG: 'jpeg' },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.render.mockResolvedValue({ saveAsync: mocks.save, release: mocks.releaseImage });
  mocks.save.mockResolvedValue({ base64: 'aW1hZ2U=' });
});

it('opens an images-only multi-picker and leaves cancellation empty', async () => {
  mocks.pick.mockResolvedValue({ canceled: true, assets: null });
  expect(await pickChatImages(3)).toEqual([]);
  expect(mocks.pick).toHaveBeenCalledWith(expect.objectContaining({
    mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3,
  }));
  expect(mocks.render).not.toHaveBeenCalled();
});

it('resizes large photos and sends portable JPEG data instead of phone file paths', async () => {
  mocks.pick.mockResolvedValue({ canceled: false, assets: [
    { uri: 'file:///photo.heic', width: 4032, height: 3024 },
    { uri: 'content://portrait', width: 3024, height: 4032 },
  ] });
  const images = await pickChatImages(8);
  expect(images.map((image) => image.url)).toEqual([
    'data:image/jpeg;base64,aW1hZ2U=', 'data:image/jpeg;base64,aW1hZ2U=',
  ]);
  expect(mocks.resize.mock.calls).toEqual([[{ width: 1600 }], [{ height: 1600 }]]);
  expect(mocks.releaseContext).toHaveBeenCalledTimes(2);
  expect(mocks.releaseImage).toHaveBeenCalledTimes(2);
});

it('rejects excessive selection before decoding images', async () => {
  mocks.pick.mockResolvedValue({ canceled: false, assets: [{}, {}] });
  await expect(pickChatImages(1)).rejects.toThrow('最多添加');
  expect(mocks.render).not.toHaveBeenCalled();
});

it('releases native image memory if encoding fails', async () => {
  mocks.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo', width: 400, height: 300 }] });
  mocks.save.mockRejectedValueOnce(new Error('decode failed'));
  await expect(pickChatImages(8)).rejects.toThrow('decode failed');
  expect(mocks.resize).not.toHaveBeenCalled();
  expect(mocks.releaseContext).toHaveBeenCalledOnce();
  expect(mocks.releaseImage).toHaveBeenCalledOnce();
});
