// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopPointer } from '../../../../shared/remote-desktop/input';
import { desktopViewport } from '../../../../shared/remote-desktop/geometry';
import { useScrollPad } from '../../../../shared/remote-desktop/useScrollPad';

let root: Root;
let scroll: ReturnType<typeof useScrollPad>;
let pointer: DesktopPointer;
const wheel = vi.fn();
const panel = { expanded: true, expand: vi.fn(), activity: vi.fn(), hold: vi.fn() };
function Harness({ enabled = true, width = 390, horizontal = true } = {}) {
  const viewport = desktopViewport({ width, height: 750 }, { width: 1600, height: 900 });
  scroll = useScrollPad({ pointer, viewport, panel, wheel, horizontal, enabled }); return null;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  pointer = new DesktopPointer(vi.fn()); root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); pointer.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('releases held mouse buttons, scrolls during a single hold and restores the panel on release', () => {
  expect(panel.hold).not.toHaveBeenCalled(); expect(scroll.active).toBe(false);
  act(() => { pointer.button('left', true); scroll.start(); });
  expect(pointer.isHeld('left')).toBe(false); expect(scroll.active).toBe(true);
  expect(panel.hold).toHaveBeenLastCalledWith('scroll', true); expect(wheel).not.toHaveBeenCalled();
  act(() => { scroll.move({ x: 0, y: 60 }); vi.advanceTimersByTime(160); });
  expect(wheel).toHaveBeenCalledTimes(3); expect(wheel).toHaveBeenLastCalledWith(-120, false);
  act(() => scroll.end());
  expect(scroll.active).toBe(false); expect(scroll.position).toEqual({ x: 0, y: 0 });
  expect(panel.hold).toHaveBeenLastCalledWith('scroll', false);
  act(() => { scroll.move({ x: 60, y: 0 }); vi.advanceTimersByTime(1000); });
  expect(wheel).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
});

it('does not latch open or send wheel input for a tap, and can immediately start another gesture', () => {
  act(() => { scroll.start(); scroll.end(); });
  expect(scroll.active).toBe(false); expect(wheel).not.toHaveBeenCalled();
  act(() => { scroll.start(); scroll.move({ x: -60, y: 0 }); });
  expect(scroll.active).toBe(true); expect(wheel).toHaveBeenLastCalledWith(-120, true);
});

it.each(['hide', 'resize', 'unmount', 'capability'] as const)('stops and releases panel activity on %s', change => {
  act(() => { scroll.start(); scroll.move({ x: 0, y: -60 }); });
  act(() => {
    if (change === 'unmount') root.render(null);
    else root.render(<Harness enabled={change !== 'hide'} width={change === 'resize' ? 844 : 390}
      horizontal={change !== 'capability'} />);
  });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(wheel).toHaveBeenCalledOnce(); expect(panel.hold).toHaveBeenLastCalledWith('scroll', false);
  expect(vi.getTimerCount()).toBe(0);
  if (change !== 'unmount') expect(scroll.active).toBe(false);
});

it('ignores starts when unavailable and scales dragging with a cross fitted to a small viewport', () => {
  act(() => root.render(<Harness enabled={false} />));
  act(() => scroll.start()); expect(scroll.active).toBe(false); expect(panel.hold).not.toHaveBeenCalled();
  act(() => root.render(<Harness width={100} />));
  act(() => { scroll.start(); scroll.move({ x: 0, y: 28 }); });
  expect(scroll.layout.size).toBe(84); expect(wheel).toHaveBeenLastCalledWith(-120, false);
});
