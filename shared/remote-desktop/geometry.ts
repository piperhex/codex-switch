export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface DesktopViewport { stage: Size; content: Size & Point }
export const MOUSE_SIZE = { width: 144, height: 160 };
export const MOUSE_PANEL_SIZE = { width: 176, height: 160 };
export const MOUSE_ICON_SIZE = { width: 40, height: 40 };
export const CURSOR_SIZE = { width: 24, height: 32 };
const PANEL_GAP = 28;
const EDGE_GAP = 8;
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

/** Constrain controls only to the viewer, never to the remote image's rectangle. */
export function mousePanelPosition(cursor: Point, stage: Size, panel: Size): Point {
  let x = cursor.x + PANEL_GAP;
  if (x + panel.width + EDGE_GAP > stage.width && cursor.x - PANEL_GAP - panel.width >= EDGE_GAP) {
    x = cursor.x - PANEL_GAP - panel.width;
  }
  x = clamp(x, EDGE_GAP, stage.width - panel.width - EDGE_GAP);
  let y = clamp(cursor.y, EDGE_GAP, stage.height - panel.height - EDGE_GAP);
  if (cursor.x + CURSOR_SIZE.width > x && cursor.x < x + panel.width) {
    const below = cursor.y + CURSOR_SIZE.height + EDGE_GAP;
    y = below + panel.height + EDGE_GAP <= stage.height ? below : cursor.y - panel.height - EDGE_GAP;
  }
  return { x, y: clamp(y, EDGE_GAP, stage.height - panel.height - EDGE_GAP) };
}
