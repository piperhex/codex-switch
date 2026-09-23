import { t } from '../i18n';
import { ChatImageError, draftImage, MAX_CHAT_IMAGES, chatImageCharLimit,
  validateChatImages, type DraftImage } from '../../../../shared/remote-chat/attachments';

import { base64Bytes, getChatPolicy, isDirectChat, MIB } from '../../../../shared/remote-chat/policy';
import { compressChatImage, ImagePolicyError } from '../../../../shared/remote-chat/compressImage';

function readOriginal(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ChatImageError(t("图片读取失败，请重新选择。")));
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file: File) {
  if ((file.type && !file.type.startsWith('image/')) || !file.size) {
    throw new ChatImageError(t("请选择有效的图片。"));
  }
  const policy = getChatPolicy();
  if (file.size > policy.imageSourceMaxMb * MIB) {
    throw new ChatImageError(t("单张图片不能超过 {value1} MB，请选择较小的图片。", { value1: policy.imageSourceMaxMb }));
  }
  if (isDirectChat() && /^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    return draftImage(await readOriginal(file));
  }
  try {
    const image = new Image();
    // Desktop WebViews allow inline images but deliberately disallow blob: image sources.
    image.src = await readOriginal(file);
    await image.decode();
    const compressed = await compressChatImage(async (edge, quality) => {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new ChatImageError(t("当前浏览器无法读取图片，请换个浏览器重试。"));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', quality);
      return { value: url, bytes: base64Bytes(url) };
    }, policy, Math.floor((chatImageCharLimit() - 'data:image/jpeg;base64,'.length) / 4) * 3);
    return draftImage(compressed);
  } catch (error) {
    if (error instanceof ChatImageError || error instanceof ImagePolicyError) throw new ChatImageError(error.message);
    throw new ChatImageError(t("这张图片暂时无法读取，请换一张 JPG 或 PNG 图片。"));
  }
}

export async function pickChatImages(files: File[], remaining: number): Promise<DraftImage[]> {
  if (files.length > remaining) throw new ChatImageError(t("一次最多添加 {value1} 张图片。", { value1: MAX_CHAT_IMAGES }));
  const images: DraftImage[] = [];
  for (const file of files) {
    images.push(await prepareImage(file));
    validateChatImages(images.map((image) => image.url));
  }
  return images;
}
