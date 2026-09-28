import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { DesktopScrollPad } from './DesktopScrollPad';
import { DesktopPointer } from '../../../../../shared/remote-desktop/input';

const runtime = vi.hoisted(() => ({ effects: [] as (() => void)[],
  listener: undefined as undefined | ((state: string) => void), remove: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) runtime.effects.push(cleanup); },
  useMemo: (factory: () => unknown) => factory(), useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()] }));
vi.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable', Text: 'Text',
  PanResponder: { create: vi.fn(() => ({ panHandlers: {} })) },
  AppState: { addEventListener: (_name: string, callback: (state: string) => void) => {
    runtime.listener = callback; return { remove: runtime.remove };
  } }, StyleSheet: { create: <T,>(value: T) => value, absoluteFillObject: {} } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
interface Props { children?: ReactNode; accessibilityLabel?: string; onPress?: () => void;
  style?: Array<{ left?: number; top?: number; width?: number; height?: number }> }
const nodes = (tree: ReactNode): ReactElement<Props>[] => Children.toArray(tree).flatMap(child =>
  isValidElement<Props>(child) ? [child, ...nodes(child.props.children)] : []);
const event = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y } } as GestureResponderEvent);
const gesture = (dx = 0, dy = 0) => ({ dx, dy, numberActiveTouches: 1 } as PanResponderGestureState);
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('React', React); });
afterEach(() => {
  runtime.effects.splice(0).reverse().forEach(cleanup => cleanup()); vi.useRealTimers(); vi.unstubAllGlobals();
});
function setup() {
  const wheel = vi.fn(); const close = vi.fn(); const hold = vi.fn(); const pointer = new DesktopPointer(vi.fn());
  const tree = DesktopScrollPad({ pointer, wheel, close, horizontal: true,
    panel: { expanded: true, expand: vi.fn(), activity: vi.fn(), hold },
    viewport: { stage: { width: 390, height: 750 }, content: { x: 0, y: 0, width: 390, height: 219 } } });
  return { wheel, close, hold, tree, handlers: vi.mocked(PanResponder.create).mock.calls.at(-1)![0] };
}
it('routes native drags to both wheel axes, stops on release and stops when the app loses focus', () => {
  const { handlers, wheel, hold } = setup(); expect(hold).toHaveBeenCalledWith('scroll', true);
  handlers.onPanResponderGrant!(event(90, 90), gesture());
  handlers.onPanResponderMove!(event(90, 150), gesture(0, 60));
  expect(wheel).toHaveBeenLastCalledWith(-120, false);
  vi.advanceTimersByTime(160); expect(wheel).toHaveBeenCalledTimes(3);
  handlers.onPanResponderRelease!(event(90, 150), gesture(0, 60));
  vi.advanceTimersByTime(500); expect(wheel).toHaveBeenCalledTimes(3);
  handlers.onPanResponderGrant!(event(90, 90), gesture());
  handlers.onPanResponderMove!(event(30, 90), gesture(-60, 0));
  expect(wheel).toHaveBeenLastCalledWith(-120, true);
  runtime.listener!('background'); vi.advanceTimersByTime(500); expect(wheel).toHaveBeenCalledTimes(4);
});
it('draws the native cross inside the stage, dismisses a center tap and cancels interrupted gestures', () => {
  const { handlers, close, tree } = setup();
  const pad = nodes(tree).find(node => node.props.accessibilityLabel === '十字滚动滑块')!;
  const layout = Object.assign({}, ...pad.props.style!);
  expect(layout.width).toBe(180); expect(layout.height).toBe(180);
  expect(layout.left! + layout.width!).toBeLessThanOrEqual(390);
  handlers.onPanResponderGrant!(event(90, 90), gesture());
  handlers.onPanResponderRelease!(event(90, 90), gesture()); expect(close).toHaveBeenCalledOnce();
  handlers.onPanResponderGrant!(event(90, 90), gesture());
  handlers.onPanResponderTerminate!(event(90, 90), gesture());
  expect(close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  nodes(tree).find(node => node.props.accessibilityLabel === '收起滚动滑块')!.props.onPress!();
  expect(close).toHaveBeenCalledTimes(2);
});
