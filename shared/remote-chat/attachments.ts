export const MAX_CHAT_IMAGES = 8;
export const MAX_IMAGE_EDGE = 1600;
export const IMAGE_QUALITY = 0.8;
// Leave room in the 8 MiB transport envelope for text, settings and RPC metadata.
export const MAX_CHAT_IMAGE_CHARS = 6 * 1024 * 1024;
export interface DraftImage { id: string; url: string }
export class ChatImageError extends Error {}
let nextImageId = 0;

export function validateChatImages(images: readonly string[]) {
  if (images.length > MAX_CHAT_IMAGES) throw new ChatImageError(`一次最多添加 ${MAX_CHAT_IMAGES} 张图片。`);
  if (images.reduce((total, image) => total + image.length, 0) > MAX_CHAT_IMAGE_CHARS) {
    throw new ChatImageError('图片较大，请减少图片后再发送。');
  }
  if (images.some((image) => !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) {
    throw new ChatImageError('图片无法读取，请重新选择。');
  }
}

export function draftImage(url: string): DraftImage {
  validateChatImages([url]);
  return { id: `photo-${++nextImageId}`, url };
}
