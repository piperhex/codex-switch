import { t } from '../i18n';
import { EncodingType, getInfoAsync, readAsStringAsync } from 'expo-file-system';
import { base64Bytes, getChatPolicy, isDirectChat, MIB } from '../../../../shared/remote-chat/policy';
import { compressChatImage, ImagePolicyError } from '../../../../shared/remote-chat/compressImage';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export const MAX_CHAT_PHOTOS = 8;
// Keep room for the text and encryption envelope within the remote chat message limit.
export const MAX_PHOTO_DATA_CHARS = 4 * 1024 * 1024;
const photoDataLimit = () => isDirectChat() ? Number.MAX_SAFE_INTEGER : MAX_PHOTO_DATA_CHARS;
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };

export interface ChatPhoto { id: string; uri: string; dataUrl: string }
export type PhotoSource = 'library' | 'camera';

export class PhotoPermissionError extends Error {
  constructor(public readonly canAskAgain: boolean) {
    super(canAskAgain ? t("允许使用相机后，即可拍照。") : t("相机权限已关闭，请在系统设置中允许使用相机。"));
  }
}

export async function selectPhotos(source: PhotoSource, remaining: number) {
  if (source === 'library') {
    // The system picker grants access to the selected files without full-library permission.
    return ImagePicker.launchImageLibraryAsync({ ...PICKER_OPTIONS,
      allowsMultipleSelection: true, selectionLimit: remaining });
  }
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new PhotoPermissionError(permission.canAskAgain);
  return ImagePicker.launchCameraAsync(PICKER_OPTIONS);
}

export async function preparePhoto(asset: ImagePicker.ImagePickerAsset): Promise<ChatPhoto> {
  const policy = getChatPolicy();
  let bytes = asset.fileSize;
  if (bytes === undefined) {
    const info = await getInfoAsync(asset.uri);
    if (!info.exists || info.isDirectory) throw new ImagePolicyError(t("照片读取失败，请重新选择。"));
    bytes = info.size;
  }
  if (bytes > policy.imageSourceMaxMb * MIB) {
    throw new ImagePolicyError(t("单张图片不能超过 {value1} MB，请选择较小的图片。", { value1: policy.imageSourceMaxMb }));
  }
  if (isDirectChat() && /^image\/(png|jpeg|webp|gif)$/.test(asset.mimeType ?? '')) {
    const data = await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64 });
    return { id: asset.uri, uri: asset.uri, dataUrl: `data:${asset.mimeType};base64,${data}` };
  }
  return compressChatImage(async (edge, quality) => {
    const resize = asset.width >= asset.height ? { width: edge } : { height: edge };
    const actions = Math.max(asset.width, asset.height) > edge ? [{ resize }] : [];
    const photo = await manipulateAsync(asset.uri, actions,
      { format: SaveFormat.JPEG, compress: quality, base64: true });
    if (!photo.base64) throw new ImagePolicyError(t("照片读取失败，请重新选择。"));
    const value = { id: photo.uri, uri: photo.uri, dataUrl: `data:image/jpeg;base64,${photo.base64}` };
    return { value, bytes: base64Bytes(value.dataUrl) };
  }, policy, Math.floor((photoDataLimit() - 'data:image/jpeg;base64,'.length) / 4) * 3);
}

export function validatePhotos(photos: ChatPhoto[]) {
  if (photos.length > MAX_CHAT_PHOTOS) throw new Error(t("每条消息最多添加 {value1} 张照片。", { value1: MAX_CHAT_PHOTOS }));
  if (photos.reduce((total, photo) => total + photo.dataUrl.length, 0) > photoDataLimit()) {
    throw new Error(t("照片总大小过大，请减少照片后再试。"));
  }
}
