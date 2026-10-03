import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { DesktopScrollPad } from './DesktopScrollPad';
import { useScrollButton } from './useScrollButton';
import { useScrollPad } from '../../../../../shared/remote-desktop/useScrollPad';
import { DesktopPointer } from '../../../../../shared/remote-desktop/input';

const runtime = vi.hoisted(() => ({ effects: [] as (() => void)[],
  listener: undefined as undefined | ((state: string) => void), remove: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) runtime.effects.push(cleanup); },
  useMemo: (factory: () => unknown) => factory(), useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()], useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text',
  PanResponder: { create: vi.fn(() => ({ panHandlers: {} })) },
  AppState: { addEventListener: (_name: string, callback: (state: string) => void) => {
    runtime.listener = callback; return { remove: runtime.remove };
  } }, StyleSheet: { create: <T,>(value: T) => value, absoluteFillObject: {} } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
interface Props { children?: ReactNode; accessibilityLabel?: string; onTouchStart?: () => void;
  style?: Array<{ left?: number; top?: number; width?: number; height?: number }> }
const nodes = (tree: ReactNode): ReactElement<Props>[] => Children.toArray(tree).flatMap(child =>
  isValidElement<Props>(child) ? [child, ...nodes(child.props.children)] : []);
const event = {} as GestureResponderEvent;
const gesture = (dx = 0, dy = 0) => ({ dx, dy, numberActiveTouches: 1 } as PanResponderGestureState);
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('React', React); });
afterEach(() => {
  runtime.effects.splice(0).reverse().forEach(cleanup => cleanup()); vi.useRealTimers(); vi.unstubAllGlobals();
});
function setup() {
  const wheel = vi.fn(); const hold = vi.fn(); const pointer = new DesktopPointer(vi.fn());
  const scroll = useScrollPad({ pointer, wheel, horizontal: true, enabled: true,
    panel: { expanded: true, expand: vi.fn(), activity: vi.fn(), hold },
    viewport: { stage: { width: 390, height: 750 }, content: { x: 0, y: 0, width: 390, height: 219 } } });
  useScrollButton(scroll);
  const tree = DesktopScrollPad({ layout: scroll.layout, position: scroll.position,
    horizontal: true, cancel: scroll.end });
  return { wheel, hold, tree, handlers: vi.mocked(PanResponder.create).mock.calls.at(-1)![0] };
}
it('starts at rest on the native wheel, scrolls in the same drag and closes on release', () => {
  const { handlers, wheel, hold } = setup(); expect(hold).not.toHaveBeenCalled();
  handlers.onPanResponderGrant!(event, gesture()); expect(wheel).not.toHaveBeenCalled();
  expect(hold).toHaveBeenLastCalledWith('scroll', true);
  handlers.onPanResponderMove!(event, gesture(0, 60));
  expect(wheel).toHaveBeenLastCalledWith(-120, false);
  vi.advanceTimersByTime(160); expect(wheel).toHaveBeenCalledTimes(3);
  handlers.onPanResponderRelease!(event, gesture(0, 60));
  expect(hold).toHaveBeenLastCalledWith('scroll', false);
  handlers.onPanResponderMove!(event, gesture(60, 0));
  vi.advanceTimersByTime(500); expect(wheel).toHaveBeenCalledTimes(3);
  handlers.onPanResponderGrant!(event, gesture());
  handlers.onPanResponderMove!(event, gesture(-60, 0));
  expect(wheel).toHaveBeenLastCalledWith(-120, true);
});
it.each(['background', 'terminate', 'multitouch', 'overlay'] as const)('stops and restores the panel on %s', reason => {
  const { handlers, wheel, hold, tree } = setup();
  handlers.onPanResponderGrant!(event, gesture()); handlers.onPanResponderMove!(event, gesture(0, 60));
  if (reason === 'background') runtime.listener!('background');
  else if (reason === 'terminate') handlers.onPanResponderTerminate!(event, gesture());
  else if (reason === 'multitouch') handlers.onPanResponderStart!(event, { ...gesture(), numberActiveTouches: 2 });
  else nodes(tree)[0].props.onTouchStart!();
  handlers.onPanResponderMove!(event, gesture(60, 0)); vi.advanceTimersByTime(500);
  expect(wheel).toHaveBeenCalledOnce(); expect(hold).toHaveBeenLastCalledWith('scroll', false);
  expect(vi.getTimerCount()).toBe(0);
});
it('draws the native cross inside the stage and restores the panel after a stationary press', () => {
  const { handlers, wheel, hold, tree } = setup();
  const pad = nodes(tree).find(node => node.props.accessibilityLabel === '十字滚动滑块')!;
  const layout = Object.assign({}, ...pad.props.style!);
  expect(layout.width).toBe(180); expect(layout.height).toBe(180);
  expect(layout.left! + layout.width!).toBeLessThanOrEqual(390);
  handlers.onPanResponderGrant!(event, gesture()); handlers.onPanResponderRelease!(event, gesture());
  expect(hold).toHaveBeenLastCalledWith('scroll', false); expect(wheel).not.toHaveBeenCalled();
  expect(handlers.onPanResponderTerminationRequest!(event, gesture())).toBe(false);
});
