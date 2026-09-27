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

it('reveals the bottom margin twice as fast while keeping the right edge at swipe speed', () => {
  const fitted = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
  const zero = { x: 0, y: 0 };
  const bottom = 450 - 8 - MOUSE_PANEL_SIZE.height;
  const edge = { x: 0.5, y: bottom / 449 };
  expect(panDesktopViewport(fitted, edge, MOUSE_PANEL_SIZE, zero).offset).toEqual(zero);
  const point = { ...edge, y: (bottom + 20) / 449 };
  const down = panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE, zero);
  expect(down.offset).toEqual({ x: 0, y: -40 });
  const cursor = cursorPosition(point, down.viewport);
  expect(desktopPoint(cursor, down.viewport)!.y).toBeCloseTo(point.y);
  expect(mousePanelPosition(cursor)).toEqual({ x: cursor.x + 24, y: cursor.y });
  const right = panDesktopViewport(fitted, { x: (800 - 8 - 24 - MOUSE_PANEL_SIZE.width + 20) / 799, y: 0.5 },
    MOUSE_PANEL_SIZE, zero);
  expect(right.offset).toEqual({ x: -20, y: 0 });
  const full = panDesktopViewport(fitted, { ...edge, y: 1 }, MOUSE_PANEL_SIZE, down.offset);
  expect(full.offset.y).toBe(bottom - 449);
  expect(cursorPosition({ ...edge, y: 1 }, full.viewport).y + MOUSE_PANEL_SIZE.height).toBe(450 - 8);
});

it('uses existing bottom letterboxing before opening more canvas, and preserves the assisted offset', () => {
  const fitted = desktopViewport({ width: 800, height: 500 }, { width: 1600, height: 900 });
  const zero = { x: 0, y: 0 };
  const edge = { x: 0.5, y: (500 - 8 - MOUSE_PANEL_SIZE.height - fitted.content.y) / 449 };
  expect(panDesktopViewport(fitted, edge, MOUSE_PANEL_SIZE, zero).offset).toEqual(zero);
  const point = { ...edge, y: edge.y + 15 / 449 };
  const assisted = panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE, zero);
  expect(assisted.offset.y).toBeCloseTo(-30);
  expect(panDesktopViewport(fitted, point, MOUSE_PANEL_SIZE, assisted.offset).offset).toEqual(assisted.offset);
  expect(panDesktopViewport(fitted, edge, MOUSE_PANEL_SIZE, assisted.offset).offset).toEqual(assisted.offset);
  expect(panDesktopViewport(fitted, point, MOUSE_ICON_SIZE, assisted.offset).offset).toEqual(assisted.offset);
  const portrait = desktopViewport({ width: 390, height: 750 }, { width: 1600, height: 900 });
  expect(panDesktopViewport(portrait, { x: 0.5, y: 1 }, MOUSE_PANEL_SIZE, zero).offset.y).toBe(0);
});
