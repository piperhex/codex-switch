import { createContext, useContext, useEffect, useState } from "react";
import { guiApi } from "./api";
import { isInlineImage, localImageSource } from "./imageSources";

export const ImageThreadContext = createContext<string | null>(null);
const pending = new Map<string, Promise<string>>();

function loadImage(threadId: string, source: string): Promise<string> {
  const key = JSON.stringify([threadId, source]);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = guiApi.request<{ url: string }>({ operation: "imagePreview", threadId, source })
    .then(({ url }) => {
      if (!isInlineImage(url)) throw new Error("图片暂时无法显示。");
      return url;
    }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function useImageSource(source?: string) {
  const threadId = useContext(ImageThreadContext);
  const local = source ? localImageSource(source) : undefined;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ source: string; threadId: string; url?: string; failed?: boolean }>();
  useEffect(() => {
    if (!local || !threadId) return;
    let cancelled = false;
    setResult(undefined);
    void loadImage(threadId, local).then(
      (url) => { if (!cancelled) setResult({ source: local, threadId, url }); },
      () => { if (!cancelled) setResult({ source: local, threadId, failed: true }); },
    );
    return () => { cancelled = true; };
  }, [local, threadId, attempt]);
  const current = result?.source === local && result?.threadId === threadId ? result : undefined;
  const remote = source && (/^https?:\/\//i.test(source) || isInlineImage(source)) ? source : undefined;
  return { url: remote || current?.url, failed: current?.failed,
    loading: Boolean(local && threadId && !current), retry: () => setAttempt((value) => value + 1) };
}
