import { useEffect, useState } from 'react';
import { isInlineImage, localImageSource } from '../../chat/imageSources';

export interface ImagePreviewOptions {
  threadId: string | null;
  ready: boolean;
  load: (threadId: string, source: string, original?: boolean) => Promise<string>;
}

export function useChatImage(source: string | undefined, options: ImagePreviewOptions | null) {
  const network = source && /^https?:\/\//i.test(source) ? source : undefined;
  const local = source ? (localImageSource(source) ?? (options?.load ? network : undefined)) : undefined;
  const remote = source && (isInlineImage(source) || (network && !local)) ? source : undefined;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; url?: string; failed?: boolean }>();
  const [failedKey, setFailedKey] = useState<string>();
  const { threadId, ready, load } = options ?? {};
  const key = JSON.stringify([threadId, source, attempt]);
  useEffect(() => {
    if (!local || !threadId || !ready || !load) return;
    let cancelled = false;
    setResult(undefined);
    void load(threadId, local).then((url) => {
      if (!cancelled) setResult(isInlineImage(url) ? { key, url } : { key, failed: true });
    }, () => { if (!cancelled) setResult({ key, failed: true }); });
    return () => { cancelled = true; };
  }, [local, threadId, ready, load, key]);
  const current = result?.key === key ? result : undefined;
  const supported = Boolean(remote || (local && threadId && load));
  return {
    key, url: remote || current?.url, failed: current?.failed || failedKey === key || !supported,
    loading: Boolean(local && supported && !current),
    original: async () => {
      if (remote) return remote;
      if (!threadId || !local || !load) throw new Error('图片暂时无法加载，请重试。');
      return load(threadId, local, true);
    },
    fail: () => setFailedKey(key), retry: () => setAttempt((value) => value + 1),
  };
}
