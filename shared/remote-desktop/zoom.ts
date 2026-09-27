import type { DesktopViewport, Point } from './geometry';

export const MAX_DESKTOP_ZOOM = 4;
export type TouchPair = readonly [Point, Point];
export interface DesktopZoom {
  start: (points: TouchPair, viewport: DesktopViewport) => void;
  move: (points: TouchPair) => void;
  end: () => void;
}
export interface DesktopPinch { viewport: DesktopViewport; center: Point; distance: number }
const center = ([a, b]: TouchPair): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = ([a, b]: TouchPair) => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
const clampOffset = (offset: number, content: number, stage: number) => content <= stage
  ? (stage - content) / 2 : Math.max(stage - content, Math.min(0, offset));

export function startDesktopPinch(points: TouchPair, viewport: DesktopViewport): DesktopPinch {
  return { viewport, center: center(points), distance: distance(points) };
}

/** Keep the desktop point under the pinch center fixed, while allowing two-finger panning. */
export function pinchDesktopViewport(base: DesktopViewport, pinch: DesktopPinch, points: TouchPair): DesktopViewport {
  const { content } = pinch.viewport;
  const scale = Math.max(1, Math.min(MAX_DESKTOP_ZOOM,
    content.width / base.content.width * distance(points) / pinch.distance));
  const width = base.content.width * scale; const height = base.content.height * scale;
  const ratio = width / content.width;
  const midpoint = center(points);
  return { stage: base.stage, content: { width, height,
    x: clampOffset(midpoint.x - (pinch.center.x - content.x) * ratio, width, base.stage.width),
    y: clampOffset(midpoint.y - (pinch.center.y - content.y) * ratio, height, base.stage.height) } };
}
