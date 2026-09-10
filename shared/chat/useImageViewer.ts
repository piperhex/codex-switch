import { useEffect, useRef, useState } from 'react';

export function useImageViewer(load: () => Promise<string>) {
  const loader = useRef(load);
  loader.current = load;
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    void loader.current().then((result) => { if (!cancelled) setUrl(result); },
      () => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [attempt]);
  return { url, error, fail: () => setError(true), retry: () => { setUrl(undefined); setAttempt((v) => v + 1); } };
}
