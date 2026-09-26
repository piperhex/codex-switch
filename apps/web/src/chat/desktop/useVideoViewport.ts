import { useEffect, useState, type RefObject } from 'react';
import { desktopViewport } from '../../../../../shared/remote-desktop/geometry';

export function useVideoViewport(stage: RefObject<HTMLElement>, video: RefObject<HTMLVideoElement>, active: boolean) {
  const [viewport, setViewport] = useState(() => desktopViewport({ width: 1, height: 1 }, { width: 16, height: 9 }));
  useEffect(() => {
    const area = stage.current; const media = video.current;
    if (!active || !area || !media) return;
    const measure = () => setViewport(desktopViewport({ width: area.clientWidth, height: area.clientHeight },
      { width: media.videoWidth || 16, height: media.videoHeight || 9 }));
    const observer = new ResizeObserver(measure); observer.observe(area);
    media.addEventListener('resize', measure); media.addEventListener('loadedmetadata', measure); measure();
    return () => { observer.disconnect(); media.removeEventListener('resize', measure);
      media.removeEventListener('loadedmetadata', measure); };
  }, [stage, video, active]);
  return viewport;
}
