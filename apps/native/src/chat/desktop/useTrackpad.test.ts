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
function setup(direct = false) {
  const send = vi.fn(); const pointer = new DesktopPointer(send);
  const panel = { expanded: true, expand: vi.fn(), collapse: vi.fn(), activity: vi.fn(), hold: vi.fn() };
  const viewport = desktopViewport({ width: 400, height: 800 }, { width: 1600, height: 900 });
  useTrackpad({ pointer, viewport, panel, direct, id: 'stage' });
  return { send, pointer, panel, handlers: vi.mocked(PanResponder.create).mock.calls.at(-1)![0] };
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
