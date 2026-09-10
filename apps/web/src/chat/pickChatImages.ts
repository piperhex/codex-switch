import { ChatImageError, draftImage, IMAGE_QUALITY, MAX_CHAT_IMAGES, MAX_IMAGE_EDGE,
  validateChatImages, type DraftImage } from '../../../../shared/remote-chat/attachments';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

async function prepareImage(file: File) {
  if ((file.type && !file.type.startsWith('image/')) || !file.size) {
    throw new ChatImageError('请选择有效的图片。');
  }
  if (file.size > MAX_SOURCE_BYTES) throw new ChatImageError('单张图片不能超过 20 MB，请选择较小的图片。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new ChatImageError('当前浏览器无法读取图片，请换个浏览器重试。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return draftImage(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
  } catch (error) {
    if (error instanceof ChatImageError) throw error;
    throw new ChatImageError('这张图片暂时无法读取，请换一张 JPG 或 PNG 图片。');
  } finally { URL.revokeObjectURL(url); }
}

export async function pickChatImages(files: File[], remaining: number): Promise<DraftImage[]> {
  if (files.length > remaining) throw new ChatImageError(`一次最多添加 ${MAX_CHAT_IMAGES} 张图片。`);
  const images: DraftImage[] = [];
  for (const file of files) {
    images.push(await prepareImage(file));
    validateChatImages(images.map((image) => image.url));
  }
  return images;
}
