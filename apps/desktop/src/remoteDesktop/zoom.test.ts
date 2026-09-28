import { expect, it } from 'vitest';
import { desktopPoint, desktopViewport } from '../../../../shared/remote-desktop/geometry';
import { MAX_DESKTOP_ZOOM, pinchDesktopViewport, startDesktopPinch } from '../../../../shared/remote-desktop/zoom';

it.each([{ width: 774, height: 390 }, { width: 812, height: 650 }, { width: 390, height: 750 }])(
  'fits wide and narrow remote displays inside stage %j without stretching', stage => {
    for (const source of [{ width: 1600, height: 900 }, { width: 3440, height: 1440 }, { width: 900, height: 1600 }]) {
      const { content } = desktopViewport(stage, source);
      expect(content.x).toBeGreaterThanOrEqual(0); expect(content.y).toBeGreaterThanOrEqual(0);
      expect(content.x + content.width).toBeLessThanOrEqual(stage.width);
      expect(content.y + content.height).toBeLessThanOrEqual(stage.height);
      expect(content.width / content.height).toBeCloseTo(source.width / source.height);
      expect(content.x + content.width / 2).toBeCloseTo(stage.width / 2);
      expect(content.y + content.height / 2).toBeCloseTo(stage.height / 2);
      expect(Math.max(content.width / stage.width, content.height / stage.height)).toBeCloseTo(1);
    }
  });

it('zooms around the fingers, pans, clamps at the edges and retains accurate input mapping', () => {
  const base = desktopViewport({ width: 800, height: 450 }, { width: 1600, height: 900 });
  const pinch = startDesktopPinch([{ x: 250, y: 180 }, { x: 350, y: 180 }], base);
  const enlarged = pinchDesktopViewport(base, pinch, [{ x: 200, y: 180 }, { x: 400, y: 180 }]);
  expect(enlarged.content).toEqual({ x: -300, y: -180, width: 1600, height: 900 });
  const target = desktopPoint({ x: 300, y: 180 }, enlarged)!;
  expect(target.x).toBeCloseTo(300 / 800, 3); expect(target.y).toBeCloseTo(180 / 450, 3);
  const panned = pinchDesktopViewport(base, pinch, [{ x: 240, y: 210 }, { x: 440, y: 210 }]);
  expect(panned.content).toEqual({ ...enlarged.content, x: -260, y: -150 });
  const edge = pinchDesktopViewport(base, pinch, [{ x: -1000, y: -1000 }, { x: -800, y: -1000 }]);
  expect(edge.content).toEqual({ ...enlarged.content, x: -800, y: -450 });
});

it('caps magnification and shrinks back to the fitted picture, including portrait letterboxing', () => {
  const base = desktopViewport({ width: 400, height: 800 }, { width: 1600, height: 900 });
  const pinch = startDesktopPinch([{ x: 150, y: 400 }, { x: 250, y: 400 }], base);
  const maximum = pinchDesktopViewport(base, pinch, [{ x: -800, y: 400 }, { x: 1200, y: 400 }]);
  expect(maximum.content.width).toBe(base.content.width * MAX_DESKTOP_ZOOM);
  const shrink = startDesktopPinch([{ x: -800, y: 400 }, { x: 1200, y: 400 }], maximum);
  expect(pinchDesktopViewport(base, shrink, [{ x: 190, y: 400 }, { x: 210, y: 400 }])).toEqual(base);
});
