import { PermissionsAndroid, Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { DownloadCancelled, type DownloadTarget, type FileInfo } from '../../../../shared/remote-chat/fileDownload';

const SCOPED_STORAGE_API = 29;
const { fs } = ReactNativeBlobUtil;

async function prepareStorage() {
  if (Platform.OS !== 'android' || Number(Platform.Version) >= SCOPED_STORAGE_API) return;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new DownloadCancelled();
}

async function publishFile(path: string, info: FileInfo) {
  if (Platform.OS === 'android' && Number(Platform.Version) >= SCOPED_STORAGE_API) {
    const uri = await ReactNativeBlobUtil.MediaCollection.copyToMediaStore({
      name: info.name, parentFolder: 'Remote AI', mimeType: info.mimeType,
    }, 'Download', path);
    if (!uri) throw new Error('Unable to save download');
    return;
  }
  const base = Platform.OS === 'android' ? fs.dirs.DownloadDir : fs.dirs.DocumentDir;
  const folder = `${base}/Remote AI/${randomUUID()}`;
  await fs.mkdir(folder);
  await fs.mv(path, `${folder}/${info.name}`);
  if (Platform.OS === 'ios') ReactNativeBlobUtil.ios.previewDocument(`${folder}/${info.name}`);
}

/** Keep binary chunks out of JS memory after writing, and publish only a complete file. */
export async function nativeDownloadTarget(info: FileInfo): Promise<DownloadTarget> {
  await prepareStorage();
  const path = `${fs.dirs.CacheDir}/download-${randomUUID()}`;
  let closed = false;
  const stream = await fs.writeStream(path, 'base64', false).catch(async (error: unknown) => {
    if (await fs.exists(path)) await fs.unlink(path);
    throw error;
  });
  const close = async () => { if (!closed) { closed = true; await stream.close(); } };
  return {
    write: async (data) => { await stream.write(data); },
    finish: async () => { await close(); await publishFile(path, info); },
    dispose: async () => {
      try { await close(); }
      finally { if (await fs.exists(path)) await fs.unlink(path); }
    },
  };
}
