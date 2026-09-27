import { beforeEach, expect, it, vi } from 'vitest';
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { desktopViewport } from '../../../../../shared/remote-desktop/geometry';
import { useTrackpad } from './useTrackpad';

vi.mock('react', () => ({ useEffect: vi.fn(), useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, vi.fn()] }));
vi.mock('react-native', () => ({ PanResponder: { create: vi.fn(() => ({ panHandlers: {} })) } }));
const event = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y } } as GestureResponderEvent);
const gesture = (dx = 0, dy = 0) => ({ dx, dy } as PanResponderGestureState);
function setup(direct = false, withZoom = false) {
  const send = vi.fn(); const pointer = new DesktopPointer(send);
  const panel = { expanded: true, expand: vi.fn(), activity: vi.fn(), hold: vi.fn() };
  const viewport = desktopViewport({ width: 400, height: 800 }, { width: 1600, height: 900 });
  const zoom = { start: vi.fn(), move: vi.fn(), end: vi.fn() };
  useTrackpad({ pointer, viewport, panel, direct, id: 'stage', zoom: withZoom ? zoom : undefined });
  return { send, pointer, panel, zoom, handlers: vi.mocked(PanResponder.create).mock.calls.at(-1)![0] };
}
beforeEach(() => vi.clearAllMocks());

it('maps native direct touches through letterboxing and releases a cancelled drag', () => {
  const { handlers, pointer, send } = setup(true);
  handlers.onPanResponderGrant!(event(100, 350), gesture());
  expect(pointer.getSnapshot().x).toBeCloseTo(100 / 399);
  expect(pointer.getSnapshot().y).toBeCloseTo(62.5 / 224);
  expect(send).toHaveBeenLastCalledWith({ kind: 'button', button: 'left', down: true });
  handlers.onPanResponderMove!(event(130, 400), gesture(30, 50));
  expect(pointer.getSnapshot().x).toBeCloseTo(130 / 399);
  handlers.onPanResponderTerminate!(event(130, 400), gesture(30, 50));
  expect(send).toHaveBeenLastCalledWith({ kind: 'button', button: 'left', down: false });
  pointer.dispose();
});
it('ignores native direct touches that begin in the black margin', () => {
  const { handlers, send, pointer } = setup(true);
  handlers.onPanResponderGrant!(event(100, 100), gesture());
  handlers.onPanResponderMove!(event(100, 400), gesture(0, 300));
  handlers.onPanResponderRelease!(event(100, 400), gesture(0, 300));
  expect(send).not.toHaveBeenCalled(); pointer.dispose();
});
it('moves immediately at display scale and does not click after an out-and-back swipe', () => {
  const { handlers, pointer, send, panel } = setup();
  handlers.onPanResponderGrant!(event(100, 650), gesture());
  handlers.onPanResponderMove!(event(130, 670), gesture(30, 20));
  expect(pointer.getSnapshot().x).toBeCloseTo(0.5 + 30 / 399);
  expect(pointer.getSnapshot().y).toBeCloseTo(0.5 + 20 / 224);
  handlers.onPanResponderMove!(event(100, 650), gesture());
  handlers.onPanResponderRelease!(event(100, 650), gesture());
  expect(send.mock.calls.every(call => call[0].kind === 'move')).toBe(true);
  expect(panel.hold).toHaveBeenLastCalledWith('stage', false); pointer.dispose();
});

const touches = (xs: number[], target = 'stage', y = 150) => ({ nativeEvent: {
  target: 'stage', locationX: xs[0], locationY: y,
  touches: xs.map((x, identifier) => ({ identifier, target, locationX: x, locationY: y })),
} } as unknown as GestureResponderEvent);

it('zooms with two native touches and suppresses clicks and cursor movement until both fingers leave', () => {
  const { handlers, pointer, send, panel, zoom } = setup(false, true);
  handlers.onPanResponderGrant!(touches([100]), gesture());
  handlers.onPanResponderStart!(touches([100, 200]), gesture());
  handlers.onPanResponderMove!(touches([50, 250]), gesture(50, 30));
  expect(zoom.start).toHaveBeenCalledOnce();
  expect(zoom.move).toHaveBeenCalledWith([{ x: 50, y: 150 }, { x: 250, y: 150 }]);
  handlers.onPanResponderEnd!(touches([50]), gesture());
  handlers.onPanResponderMove!(touches([80]), gesture(80, 30));
  handlers.onPanResponderRelease!(touches([]), gesture());
  expect(send).not.toHaveBeenCalled(); expect(pointer.getSnapshot()).toEqual({ x: 0.5, y: 0.5 });
  expect(panel.hold).toHaveBeenLastCalledWith('stage', false);
  handlers.onPanResponderGrant!(touches([100]), gesture());
  handlers.onPanResponderRelease!(touches([]), gesture());
  expect(send).toHaveBeenLastCalledWith({ kind: 'button', button: 'left', down: false }); pointer.dispose();
});

it('releases a direct drag when pinching starts and does not move or click after cancellation', () => {
  const { handlers, pointer, send, zoom } = setup(true, true);
  handlers.onPanResponderGrant!(touches([100], 'stage', 350), gesture());
  expect(pointer.isHeld('left')).toBe(true);
  handlers.onPanResponderStart!(touches([100, 200], 'stage', 350), gesture());
  expect(pointer.isHeld('left')).toBe(false);
  send.mockClear();
  handlers.onPanResponderMove!(touches([50, 250]), gesture(40));
  handlers.onPanResponderTerminate!(touches([]), gesture());
  expect(zoom.end).toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); pointer.dispose();
});

it('keeps panel touches out of stage zoom and leaves the mouse pad without zoom controls', () => {
  const stage = setup(false, true);
  stage.handlers.onPanResponderGrant!(touches([100]), gesture());
  stage.handlers.onPanResponderStart!(touches([100, 200], 'panel'), gesture());
  expect(stage.zoom.start).not.toHaveBeenCalled(); stage.pointer.dispose();
  const pad = setup();
  pad.handlers.onPanResponderGrant!(touches([100, 200]), gesture());
  pad.handlers.onPanResponderMove!(touches([120, 220]), gesture(20));
  expect(pad.zoom.start).not.toHaveBeenCalled();
  expect(pad.pointer.getSnapshot().x).toBeGreaterThan(0.5); pad.pointer.dispose();
});
