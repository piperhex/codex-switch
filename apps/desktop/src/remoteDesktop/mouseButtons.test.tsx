// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopPointer } from '../../../../shared/remote-desktop/input';
import { desktopViewport } from '../../../../shared/remote-desktop/geometry';
import { useMouseButtons } from '../../../../shared/remote-desktop/useMouseButtons';

let root: Root;
let pointer: DesktopPointer;
let buttons: ReturnType<typeof useMouseButtons>;
const send = vi.fn();
const viewport = desktopViewport({ width: 400, height: 800 }, { width: 1600, height: 900 });
function Harness() { buttons = useMouseButtons(pointer); return null; }
const advance = () => act(() => { vi.advanceTimersByTime(600); });
const buttonEvents = () => send.mock.calls.map(([event]) => event).filter(event => event.kind === 'button');

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); send.mockClear();
  pointer = new DesktopPointer(send); root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount()); pointer.dispose(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each([false, true])('drags from the left button and releases after movement (long press first: %s)', longPress => {
  act(() => buttons.down('left'));
  if (longPress) advance();
  act(() => buttons.move(30, 20, viewport));
  expect(pointer.getSnapshot().x).toBeCloseTo(0.5 + 30 / 399);
  expect(pointer.getSnapshot().y).toBeCloseTo(0.5 + 20 / 224);
  expect(buttons.dragging).toBe(true); expect(pointer.isHeld('left')).toBe(true);
  advance(); act(() => buttons.up('left'));
  expect(buttons.dragging).toBe(false); expect(pointer.isHeld('left')).toBe(false);
  expect(buttonEvents()).toEqual([
    { kind: 'button', button: 'left', down: true }, { kind: 'button', button: 'left', down: false },
  ]);
  expect(send.mock.calls.at(-2)?.[0]).toMatchObject({ kind: 'move', ...pointer.getSnapshot() });
  expect(send.mock.calls.at(-1)?.[0]).toEqual({ kind: 'button', button: 'left', down: false });
});

it('does not latch after an out-and-back drag and flushes the last movement before releasing', () => {
  act(() => { buttons.down('left'); buttons.move(30, 20, viewport); buttons.move(-30, -20, viewport); });
  advance(); act(() => { buttons.move(10, 0, viewport); buttons.up('left'); });
  expect(pointer.isHeld('left')).toBe(false);
  expect(send.mock.calls.at(-2)?.[0]).toMatchObject({ kind: 'move', ...pointer.getSnapshot() });
  expect(buttonEvents()).toHaveLength(2);
});

it('preserves clicks and stationary long-press locking with small finger jitter', () => {
  act(() => { buttons.down('left'); buttons.up('left'); buttons.down('right'); buttons.up('right'); });
  expect(buttonEvents()).toHaveLength(4);
  act(() => { buttons.down('left'); buttons.move(1, 1, viewport); }); advance(); act(() => buttons.up('left'));
  expect(pointer.isHeld('left')).toBe(true); expect(buttons.dragging).toBe(true);
  act(() => { buttons.down('left'); buttons.up('left'); });
  expect(pointer.isHeld('left')).toBe(false); expect(buttons.dragging).toBe(false);
});

it.each(['cancel', 'release', 'unmount'] as const)('releases on %s and prevents late movement or locking', mode => {
  act(() => { buttons.down('left'); buttons.move(20, 10, viewport); });
  act(() => {
    if (mode === 'cancel') buttons.cancel();
    else if (mode === 'release') pointer.release();
    else root.render(null);
  });
  const position = pointer.getSnapshot();
  if (mode !== 'unmount') act(() => buttons.move(20, 10, viewport));
  advance();
  expect(pointer.isHeld('left')).toBe(false); expect(pointer.getSnapshot()).toEqual(position);
  expect(buttonEvents()).toHaveLength(2);
});
