import { expect, it } from 'vitest';
import { cursorPosition, desktopPoint, desktopViewport, mousePanelPosition, MOUSE_PANEL_SIZE }
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
  const panel = mousePanelPosition(cursor, viewport.stage, MOUSE_PANEL_SIZE);
  expect(panel.x).toBe(cursor.x + 28);
  expect(panel.y + MOUSE_PANEL_SIZE.height).toBeGreaterThan(viewport.content.y + viewport.content.height);
  expect(panel.y + MOUSE_PANEL_SIZE.height).toBeLessThanOrEqual(viewport.stage.height - 8);
});
it('keeps the controls visible at every corner after resizing or rotating', () => {
  for (const stage of [{ width: 390, height: 750 }, { width: 774, height: 390 }, { width: 1352, height: 900 }]) {
    const viewport = desktopViewport(stage, { width: 1600, height: 900 });
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
      const cursor = cursorPosition(point, viewport);
      const panel = mousePanelPosition(cursor, stage, MOUSE_PANEL_SIZE);
      expect(panel.x).toBeGreaterThanOrEqual(8); expect(panel.y).toBeGreaterThanOrEqual(8);
      expect(panel.x + MOUSE_PANEL_SIZE.width).toBeLessThanOrEqual(stage.width - 8);
      expect(panel.y + MOUSE_PANEL_SIZE.height).toBeLessThanOrEqual(stage.height - 8);
    }
  }
});
