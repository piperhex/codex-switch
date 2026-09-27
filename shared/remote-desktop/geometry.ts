export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface DesktopViewport { stage: Size; content: Size & Point }
export const MOUSE_SIZE = { width: 120, height: 136 };
export const MOUSE_PANEL_SIZE = MOUSE_SIZE;
export const MOUSE_ICON_SIZE = { width: 40, height: 40 };
export const CURSOR_SIZE = { width: 18, height: 24 };
const PANEL_GAP = CURSOR_SIZE.width + 6;
const EDGE_GAP = 8;
const BOTTOM_EDGE_PAN_GAIN = 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Match contain-fit video; the surrounding letterbox belongs to the control overlay. */
export function desktopViewport(stage: Size, source: Size): DesktopViewport {
  const scale = Math.min(stage.width / Math.max(source.width, 1), stage.height / Math.max(source.height, 1));
  const width = source.width * scale; const height = source.height * scale;
  return { stage, content: { width, height, x: (stage.width - width) / 2, y: (stage.height - height) / 2 } };
}
export function cursorPosition(point: Point, { content }: DesktopViewport): Point {
  return { x: content.x + point.x * Math.max(0, content.width - 1),
    y: content.y + point.y * Math.max(0, content.height - 1) };
}
export function desktopPoint(point: Point, { content }: DesktopViewport, clampOutside = false): Point | undefined {
  const x = point.x - content.x; const y = point.y - content.y;
  if (!clampOutside && (x < 0 || y < 0 || x >= content.width || y >= content.height)) return;
  return { x: clamp(x / Math.max(1, content.width - 1), 0, 1),
    y: clamp(y / Math.max(1, content.height - 1), 0, 1) };
}

/** The panel stays to the right of the pointer; the viewport pans instead of reflowing controls. */
export function mousePanelPosition(cursor: Point): Point {
  return { x: cursor.x + PANEL_GAP, y: cursor.y };
}

/** Reveal the black canvas once the pointer/controls reach a viewer edge.
 * Retaining the previous offset avoids recentering jumps on movement or idle collapse. */
export function panDesktopViewport(viewport: DesktopViewport, point: Point, panel: Size, previous: Point) {
  const cursor = cursorPosition(point, viewport);
  const x = clamp(previous.x, EDGE_GAP - cursor.x,
    viewport.stage.width - EDGE_GAP - cursor.x - PANEL_GAP - panel.width);
  const bottom = viewport.stage.height - EDGE_GAP - Math.max(CURSOR_SIZE.height, panel.height);
  const bottomLimit = bottom - cursor.y;
  const endLimit = bottom - cursorPosition({ x: point.x, y: 1 }, viewport).y;
  // The pad leaves little room to swipe downward at the bottom. Reveal its black margin faster,
  // capped at the space needed when the pointer reaches the desktop's last row.
  const assistedLimit = bottomLimit < 0 ? Math.max(bottomLimit * BOTTOM_EDGE_PAN_GAIN, endLimit) : bottomLimit;
  const y = clamp(previous.y, EDGE_GAP - cursor.y, assistedLimit);
  return { offset: { x, y }, viewport: { ...viewport,
    content: { ...viewport.content, x: viewport.content.x + x, y: viewport.content.y + y } } };
}
