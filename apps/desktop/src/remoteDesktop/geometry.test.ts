import { expect, it } from 'vitest';
import { cursorPosition, desktopPoint, desktopViewport, mousePanelPosition, MOUSE_PANEL_SIZE, MOUSE_ICON_SIZE, panDesktopViewport }
  from '../../../../shared/remote-desktop/geometry';

it('maps touches and the virtual hotspot through portrait letterboxing', () => {
  const viewport = desktopViewport({ width: 400, height: 800 }, { width: 1600, height: 900 });
  expect(viewport.content).toEqual({ x: 0, y: 287.5, width: 400, height: 225 });
  expect(desktopPoint({ x: 100, y: 100 }, viewport)).toBeUndefined();
  for (const point of [{ x: 0, y: 0 }, { x: 0.25, y: 0.75 }, { x: 1, y: 1 }]) {
    expect(desktopPoint(cursorPosition(point, viewport), viewport)).toEqual(point);
  }
  expect(desktopPoint({ x: 600, y: 1000 }, viewport, true)).toEqual({ x: 1, y: 1 });
});
it('keeps a following panel in black letterboxing instead of clamping to the video', () => {
  const viewport = desktopViewport({ width: 844, height: 600 }, { width: 1920, height: 1080 });
  const cursor = cursorPosition({ x: 0.5, y: 0.95 }, viewport);
  const panel = mousePanelPosition(cursor);
  expect(panel).toEqual({ x: cursor.x + 24, y: cursor.y });
  expect(panel.y + MOUSE_PANEL_SIZE.height).toBeGreaterThan(viewport.content.y + viewport.content.height);
});
it('keeps the same pointer-to-panel offset independent of viewport edges', () => {
  for (const stage of [{ width: 390, height: 750 }, { width: 774, height: 390 }, { width: 1352, height: 900 }]) {
    const viewport = desktopViewport(stage, { width: 1600, height: 900 });
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
      const cursor = cursorPosition(point, viewport);
      const panel = mousePanelPosition(cursor);
      expect(panel).toEqual({ x: cursor.x + 24, y: cursor.y });
    }
    const cursor = cursorPosition({ x: 1, y: 1 }, viewport);
    const panel = mousePanelPosition(cursor);
    expect(panel.x + MOUSE_PANEL_SIZE.width).toBeGreaterThan(stage.width);
  }
});

it('pans only when controls reach an edge, keeping both the hotspot and the panel on the black canvas', () => {
  for (const stage of [{ width: 390, height: 750 }, { width: 774, height: 390 }, { width: 1352, height: 900 }]) {
    const fitted = desktopViewport(stage, { width: 1600, height: 900 });
    let offset = { x: 0, y: 0 };
    for (const point of [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }]) {
      const result = panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE, offset);
      const cursor = cursorPosition(point, result.viewport);
      const panel = mousePanelPosition(cursor);
      expect(cursor.x).toBeGreaterThanOrEqual(8); expect(cursor.y).toBeGreaterThanOrEqual(8);
      expect(panel.x + MOUSE_PANEL_SIZE.width).toBeLessThanOrEqual(stage.width - 8);
      expect(panel.y + MOUSE_PANEL_SIZE.height).toBeLessThanOrEqual(stage.height - 8);
      expect(result.viewport.content.width).toBe(fitted.content.width);
      expect(result.viewport.content.height).toBe(fitted.content.height);
      const mapped = desktopPoint(cursor, result.viewport)!;
      expect(mapped.x).toBeCloseTo(point.x); expect(mapped.y).toBeCloseTo(point.y);
      offset = result.offset;
    }
  }
});

it('does not recenter on idle collapse or pointer motion within the available space', () => {
  const fitted = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
  const zero = { x: 0, y: 0 };
  expect(panDesktopViewport(fitted, { x: 0.5, y: 0.5 }, MOUSE_PANEL_SIZE, zero).offset).toEqual(zero);
  const edge = panDesktopViewport(fitted, { x: 1, y: 1 }, MOUSE_PANEL_SIZE, zero);
  expect(edge.offset.x).toBeLessThan(0); expect(edge.offset.y).toBeLessThan(0);
  const inside = panDesktopViewport(fitted, { x: 0.8, y: 0.8 }, MOUSE_PANEL_SIZE, edge.offset);
  expect(inside.offset).toEqual(edge.offset);
  const collapsed = panDesktopViewport(fitted, { x: 0.8, y: 0.8 }, MOUSE_ICON_SIZE, inside.offset);
  expect(collapsed.offset).toEqual(inside.offset);
});
