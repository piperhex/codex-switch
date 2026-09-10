import { launchImageLibraryAsync, type ImagePickerAsset } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ChatImageError, draftImage, IMAGE_QUALITY, MAX_CHAT_IMAGES, MAX_IMAGE_EDGE,
  validateChatImages, type DraftImage } from '../../../../shared/remote-chat/attachments';

async function prepareImage(asset: ImagePickerAsset) {
  const context = ImageManipulator.manipulate(asset.uri);
  try {
    if (Math.max(asset.width, asset.height) > MAX_IMAGE_EDGE) {
      context.resize(asset.width >= asset.height ? { width: MAX_IMAGE_EDGE } : { height: MAX_IMAGE_EDGE });
    }
    const image = await context.renderAsync();
    try {
      const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: IMAGE_QUALITY, base64: true });
      if (!result.base64) throw new ChatImageError('图片无法读取，请重新选择。');
      return draftImage(`data:image/jpeg;base64,${result.base64}`);
    } finally { image.release(); }
  } finally { context.release(); }
}

export async function pickChatImages(remaining: number): Promise<DraftImage[]> {
  // The system photo picker grants access only to the photos the user selects.
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 1,
  });
  if (result.canceled) return [];
  if (result.assets.length > remaining) throw new ChatImageError(`一次最多添加 ${MAX_CHAT_IMAGES} 张图片。`);
  const images: DraftImage[] = [];
  // Decode one image at a time to keep memory bounded on mobile devices.
  for (const asset of result.assets) {
    images.push(await prepareImage(asset));
    validateChatImages(images.map((image) => image.url));
  }
  return images;
}
