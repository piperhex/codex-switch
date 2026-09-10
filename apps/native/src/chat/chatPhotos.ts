import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export const MAX_CHAT_PHOTOS = 8;
// Keep room for the text and encryption envelope within the remote chat message limit.
export const MAX_PHOTO_DATA_CHARS = 4 * 1024 * 1024;
const MAX_PHOTO_EDGE = 2048;
const PHOTO_QUALITY = 0.8;
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };

export interface ChatPhoto { id: string; uri: string; dataUrl: string }
export type PhotoSource = 'library' | 'camera';

export class PhotoPermissionError extends Error {
  constructor(public readonly canAskAgain: boolean) {
    super(canAskAgain ? '允许使用相机后，即可拍照。' : '相机权限已关闭，请在系统设置中允许使用相机。');
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
  const resize = asset.width >= asset.height ? { width: MAX_PHOTO_EDGE } : { height: MAX_PHOTO_EDGE };
  const actions = Math.max(asset.width, asset.height) > MAX_PHOTO_EDGE ? [{ resize }] : [];
  // Read the granted local URI in native code and normalize HEIC/other formats for the PC.
  const photo = await manipulateAsync(asset.uri, actions,
    { format: SaveFormat.JPEG, compress: PHOTO_QUALITY, base64: true });
  if (!photo.base64) throw new Error('照片读取失败，请重新选择。');
  return { id: photo.uri, uri: photo.uri, dataUrl: `data:image/jpeg;base64,${photo.base64}` };
}

export function validatePhotos(photos: ChatPhoto[]) {
  if (photos.length > MAX_CHAT_PHOTOS) throw new Error(`每条消息最多添加 ${MAX_CHAT_PHOTOS} 张照片。`);
  if (photos.reduce((total, photo) => total + photo.dataUrl.length, 0) > MAX_PHOTO_DATA_CHARS) {
    throw new Error('照片总大小过大，请减少照片后再试。');
  }
}
