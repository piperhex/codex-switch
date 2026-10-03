import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { desktopViewport } from '../../../../../shared/remote-desktop/geometry';
import { useMouseButtons } from '../../../../../shared/remote-desktop/useMouseButtons';
import { useLeftMouseButton } from './useLeftMouseButton';

vi.mock('react', () => ({ useEffect: vi.fn(), useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, vi.fn()],
  useCallback: (callback: unknown) => callback }));
vi.mock('react-native', () => ({ PanResponder: { create: vi.fn(() => ({ panHandlers: {} })) } }));
const event = {} as GestureResponderEvent;
const gesture = (dx = 0, dy = 0) => ({ dx, dy } as PanResponderGestureState);

function setup() {
  const send = vi.fn(); const pointer = new DesktopPointer(send);
  const buttons = useMouseButtons(pointer);
  const panel = { expanded: true, expand: vi.fn(), activity: vi.fn(), hold: vi.fn() };
  const viewport = desktopViewport({ width: 400, height: 800 }, { width: 1600, height: 900 });
  useLeftMouseButton({ buttons, viewport, panel });
  return { send, pointer, panel, handlers: vi.mocked(PanResponder.create).mock.calls.at(-1)![0] };
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it.each([false, true])('drags with one native finger and releases (long press first: %s)', longPress => {
  const { handlers, pointer, send, panel } = setup();
  handlers.onPanResponderGrant!(event, gesture());
  expect(pointer.isHeld('left')).toBe(true);
  if (longPress) vi.advanceTimersByTime(600);
  handlers.onPanResponderMove!(event, gesture(30, 20));
  handlers.onPanResponderMove!(event, gesture(40, 30));
  expect(pointer.getSnapshot().x).toBeCloseTo(0.5 + 40 / 399);
  expect(pointer.getSnapshot().y).toBeCloseTo(0.5 + 30 / 224);
  expect(handlers.onPanResponderTerminationRequest!(event, gesture())).toBe(false);
  vi.advanceTimersByTime(600);
  handlers.onPanResponderRelease!(event, gesture(45, 30));
  expect(pointer.getSnapshot().x).toBeCloseTo(0.5 + 45 / 399);
  expect(pointer.isHeld('left')).toBe(false);
  expect(send.mock.calls.at(-2)?.[0]).toMatchObject({ kind: 'move', ...pointer.getSnapshot() });
  expect(send).toHaveBeenLastCalledWith({ kind: 'button', button: 'left', down: false });
  expect(send.mock.calls.filter(([input]) => input.kind === 'button')).toHaveLength(2);
  expect(panel.hold).toHaveBeenLastCalledWith('left', false); pointer.dispose();
});

it('cancels interrupted native gestures without leaving a held button or accepting late movement', () => {
  const { handlers, pointer, send, panel } = setup();
  handlers.onPanResponderGrant!(event, gesture());
  handlers.onPanResponderMove!(event, gesture(30, 20));
  handlers.onPanResponderTerminate!(event, gesture(30, 20));
  const position = pointer.getSnapshot();
  handlers.onPanResponderMove!(event, gesture(60, 40));
  handlers.onPanResponderRelease!(event, gesture(60, 40));
  vi.advanceTimersByTime(600);
  expect(pointer.getSnapshot()).toEqual(position); expect(pointer.isHeld('left')).toBe(false);
  expect(send).toHaveBeenLastCalledWith({ kind: 'button', button: 'left', down: false });
  expect(panel.hold).toHaveBeenLastCalledWith('left', false); pointer.dispose();
});
