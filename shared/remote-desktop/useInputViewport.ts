import { useRef } from 'react';
import type { DesktopViewport } from './geometry';

/** Keep desktop text readable when the input dock reduces the visible area. Clip instead of shrinking the video. */
export function useInputViewport(fitted: DesktopViewport, inputOpen: boolean): DesktopViewport {
  const resting = useRef(fitted);
  if (!inputOpen) { resting.current = fitted; return fitted; }
  const previous = resting.current ?? fitted;
  const width = previous.content.width * fitted.stage.width / Math.max(1, previous.stage.width);
  const height = width * fitted.content.height / Math.max(1, fitted.content.width);
  return { stage: fitted.stage, content: {
    width, height, x: (fitted.stage.width - width) / 2, y: 0,
  } };
}
