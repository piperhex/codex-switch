import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { validateVideoInfo, type VideoClient } from '../../../../../shared/remote-chat/video';
import { checkVideoSize } from './videoRangeStream';
import { createVideoServer, type VideoServer } from './videoServer';

interface Options { threadId: string | null; path: string; ready: boolean; client: VideoClient }
function errorMessage(error: unknown) {
  return error instanceof Error && /视频/.test(error.message)
    ? error.message : t("视频暂时无法播放，请检查电脑连接后重试。");
}
export function useVideoStream({ threadId, path, ready, client }: Options) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    setUrl('');
    setError('');
    if (!threadId || !ready || !active) return;
    let disposed = false;
    let server: VideoServer | undefined;
    let id: string | undefined;
    const release = () => {
      server?.close();
      if (!id) return;
      const current = id;
      id = undefined;
      // An expired/disconnected host closes idle sessions itself.
      void client.close(threadId, current).catch(() => console.warn('Unable to release video session'));
    };
    const fail = (reason: unknown) => {
      if (disposed) return;
      setError(errorMessage(reason));
      setUrl('');
      release();
    };
    void (async () => {
      const info = validateVideoInfo(await client.open(threadId, path));
      id = info.id;
      if (disposed) { release(); return; }
      checkVideoSize(info.size);
      server = await createVideoServer({ info,
        read: (offset, length) => client.read({ threadId, id: info.id, offset, length }) }, fail);
      if (disposed) { release(); return; }
      setUrl(server.url);
    })().catch(fail);
    return () => { disposed = true; release(); };
  }, [threadId, path, ready, active, client, attempt]);
  return { url, error, retry: () => setAttempt((value) => value + 1) };
}
