// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MOUSE_IDLE_DELAY, useMousePanel, type MousePanelActivity }
  from '../../../../shared/remote-desktop/useMousePanel';

let root: Root;
let panel: MousePanelActivity;
function Harness({ enabled = true }: { enabled?: boolean }) { panel = useMousePanel(enabled); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const advance = (time = MOUSE_IDLE_DELAY) => act(() => { vi.advanceTimersByTime(time); });

it('collapses after idle, reopens on demand and restarts the timer after activity', () => {
  advance(MOUSE_IDLE_DELAY - 1); expect(panel.expanded).toBe(true);
  advance(1); expect(panel.expanded).toBe(false);
  act(() => panel.expand()); expect(panel.expanded).toBe(true);
  advance(3000); act(() => panel.activity()); advance(2000); expect(panel.expanded).toBe(true);
  advance(2000); expect(panel.expanded).toBe(false);
});
it('keeps a long press and multi-finger drag visible until every hold is released', () => {
  act(() => { panel.hold('left', true); panel.hold('pad', true); panel.hold('drag', true); });
  advance(12_000); expect(panel.expanded).toBe(true);
  act(() => { panel.hold('left', false); panel.hold('pad', false); panel.collapse(); });
  advance(); expect(panel.expanded).toBe(true);
  act(() => panel.hold('drag', false)); advance(); expect(panel.expanded).toBe(false);
});
it('cleans up the timer and restores controls when returning from direct touch', () => {
  act(() => root.render(<Harness enabled={false} />)); expect(vi.getTimerCount()).toBe(0);
  act(() => root.render(<Harness />)); expect(panel.expanded).toBe(true);
  advance(); expect(panel.expanded).toBe(false);
});

it('releases a latched drag when another interaction cancels the shared pointer', async () => {
  const { useMouseButtons } = await import('../../../../shared/remote-desktop/useMouseButtons');
  const { DesktopPointer } = await import('../../../../shared/remote-desktop/input');
  const pointer = new DesktopPointer(vi.fn());
  let buttons!: ReturnType<typeof useMouseButtons>;
  function Buttons() { buttons = useMouseButtons(pointer); return null; }
  act(() => root.render(<Buttons />));
  act(() => buttons.down('left')); advance(600); act(() => buttons.up('left'));
  expect(buttons.dragging).toBe(true); expect(pointer.isHeld('left')).toBe(true);
  act(() => pointer.release()); expect(buttons.dragging).toBe(false);
  pointer.dispose();
});
