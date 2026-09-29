import { utf8ToBytes } from '@noble/hashes/utils';
import { checkDownloadSize } from '../../../../shared/remote-chat/policy';
import { Platform } from 'react-native';
import { setStringAsync } from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import ReactNativeBlobUtil from 'react-native-blob-util';

// Android parcels clipboard strings as UTF-16. Leave ample room below its shared 1 MiB Binder limit.
export const MAX_ANDROID_CLIPBOARD_CHARACTERS = 200_000;
const SCOPED_STORAGE_API = 29;
const TEXT_MIME_TYPE = 'text/plain';
export type TextCopyResult = 'copied' | 'too-large' | 'failed';
export interface TextSaveResult { filename: string; location: 'downloads' | 'selected' }

export async function copyText(text: string): Promise<TextCopyResult> {
  if (Platform.OS === 'android' && text.length > MAX_ANDROID_CLIPBOARD_CHARACTERS) return 'too-large';
  try { await setStringAsync(text); return 'copied'; }
  catch { return 'failed'; }
}

async function saveToSelectedFolder(text: string, filename: string): Promise<TextSaveResult | null> {
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri, filename, TEXT_MIME_TYPE);
  await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });
  return { filename, location: 'selected' };
}

/** Save the complete original UTF-8 text; caller-provided names and filesystem paths are never accepted. */
export async function saveTextFile(text: string): Promise<TextSaveResult | null> {
  checkDownloadSize(utf8ToBytes(text).length);
  if (Platform.OS !== 'android') throw new Error('Text file export is unavailable');
  const filename = `RemoteAI-output-${randomUUID()}.txt`;
  if (Number(Platform.Version) < SCOPED_STORAGE_API) return saveToSelectedFolder(text, filename);
  if (!FileSystem.cacheDirectory) throw new Error('Text cache unavailable');
  const directory = `${FileSystem.cacheDirectory}save-text-${randomUUID()}/`;
  const uri = `${directory}output.txt`;
  try {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });
    await ReactNativeBlobUtil.MediaCollection.copyToMediaStore({
      name: filename, parentFolder: 'Remote AI', mimeType: TEXT_MIME_TYPE,
    }, 'Download', uri.replace(/^file:\/\//, ''));
    return { filename, location: 'downloads' };
  } finally {
    await FileSystem.deleteAsync(directory, { idempotent: true })
      .catch(() => console.warn('Unable to remove temporary text export'));
  }
}
