import { useEffect, useRef, useState, type RefObject } from 'react';

/** Preserve video autoplay if the browser requires a gesture before playing sound. */
export function useDesktopPlayback(video: RefObject<HTMLVideoElement>, stream: MediaStream | undefined,
  muted: boolean) {
  const [blocked, setBlocked] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const element = video.current;
    const current = ++generation.current;
    setBlocked(false);
    if (!element || !stream) return;
    element.srcObject = stream;
    element.muted = muted;
    void element.play().catch(() => {
      if (current !== generation.current || muted) return;
      element.muted = true; setBlocked(true);
      void element.play().catch(() => { /* A hidden page can pause playback until it becomes visible. */ });
    });
    return () => { generation.current++; element.pause(); element.srcObject = null; };
  }, [stream, muted, video]);
  const enable = () => {
    const element = video.current;
    if (!element || !stream) return;
    const current = generation.current;
    element.muted = false;
    void element.play().then(() => {
      if (current === generation.current) setBlocked(false);
    }).catch(() => {
      if (current === generation.current) { element.muted = true; setBlocked(true); }
    });
  };
  return { blocked, enable };
}
