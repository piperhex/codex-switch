import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { getPendingResultAsync, type ImagePickerResult, type ImagePickerErrorResult } from 'expo-image-picker';
import { MAX_CHAT_PHOTOS, PhotoPermissionError, preparePhoto, selectPhotos, validatePhotos,
  type ChatPhoto, type PhotoSource } from './chatPhotos';

export function useChatPhotos() {
  const [photos, setPhotos] = useState<ChatPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsRequired, setSettingsRequired] = useState(false);
  const picking = useRef(true);
  const mounted = useRef(true);

  const appendResult = async (result: ImagePickerResult | ImagePickerErrorResult | null) => {
    if (!result || !mounted.current) return;
    if ('code' in result) throw new Error('photo-picker-failed');
    if (result.canceled) return;
    const additions: ChatPhoto[] = [];
    for (const asset of result.assets) {
      if (!mounted.current) return;
      additions.push(await preparePhoto(asset));
      validatePhotos([...photos, ...additions]);
    }
    if (mounted.current) setPhotos((current) => [...current, ...additions]);
  };

  const fail = (failure: unknown) => {
    if (!mounted.current) return;
    setSettingsRequired(failure instanceof PhotoPermissionError && !failure.canAskAgain);
    setError(failure instanceof PhotoPermissionError ? failure.message : '照片添加失败，请减少照片或重新选择后再试。');
  };
  const finish = () => {
    picking.current = false;
    if (mounted.current) setBusy(false);
  };

  useEffect(() => {
    mounted.current = true;
    picking.current = true;
    setBusy(true);
    // Android may recreate the activity while the system picker or camera is open.
    void getPendingResultAsync().then(appendResult).catch(fail).finally(finish);
    return () => { mounted.current = false; };
  }, []);

  const pick = async (source: PhotoSource) => {
    if (picking.current) return;
    setError('');
    setSettingsRequired(false);
    if (photos.length >= MAX_CHAT_PHOTOS) {
      setError(`每条消息最多添加 ${MAX_CHAT_PHOTOS} 张照片。`);
      return;
    }
    picking.current = true;
    setBusy(true);
    try {
      await appendResult(await selectPhotos(source, MAX_CHAT_PHOTOS - photos.length));
    } catch (failure) { fail(failure); }
    finally { finish(); }
  };

  const remove = (id: string) => setPhotos((current) => current.filter((photo) => photo.id !== id));
  const clearSubmitted = (submitted: ChatPhoto[]) => {
    setPhotos((current) => current.filter((photo) => !submitted.includes(photo)));
  };
  const openSettings = () => {
    void Linking.openSettings().catch(() => setError('无法打开设置，请在手机设置中找到 Codex Switch。'));
  };
  return { photos, busy, error, settingsRequired, pick, remove, clearSubmitted, openSettings };
}
