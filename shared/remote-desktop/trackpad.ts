import type { DesktopViewport } from './geometry';
import type { DesktopPointer } from './input';
import type { MousePanelActivity } from './useMousePanel';
import type { DesktopZoom } from './zoom';

export const TRACKPAD_TAP_DISTANCE = 5;

export interface TrackpadOptions {
  pointer: DesktopPointer; viewport: DesktopViewport; direct?: boolean; click?: boolean;
  panel: MousePanelActivity; id: string; cancel?: () => void; zoom?: DesktopZoom;
  /** Replace a remote click with a local action, while keeping the same drag gesture. */
  onTap?: () => void;
}
