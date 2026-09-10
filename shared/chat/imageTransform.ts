export interface Point { x: number; y: number }
export interface ImageTransform { scale: number; rotation: number; x: number; y: number }
export const INITIAL_TRANSFORM: ImageTransform = { scale: 1, rotation: 0, x: 0, y: 0 };
export const clampZoom = (scale: number) => Math.max(1, Math.min(8, scale));
export const pointDistance = (points: Point[]) => points.length < 2 ? 0
  : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
const midpoint = (points: Point[]) => points.length < 2 ? points[0]
  : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };

export function moveImage(input: { before: ImageTransform; start: Point[]; current: Point[] }): ImageTransform {
  const { before, start, current } = input;
  if (!start.length || !current.length) return before;
  const distance = pointDistance(start);
  const scale = distance && current.length > 1 ? clampZoom(before.scale * pointDistance(current) / distance) : before.scale;
  const first = midpoint(start);
  const last = midpoint(current);
  return { ...before, scale, x: before.x + last.x - first.x, y: before.y + last.y - first.y };
}
