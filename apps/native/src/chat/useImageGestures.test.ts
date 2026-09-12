import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GestureResponderEvent, PanResponderCallbacks } from 'react-native';
import { useImageGestures } from './useImageGestures';

vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useMemo: (create: () => unknown) => create(),
  useEffect: (effect: () => void) => effect(),
}));
vi.mock('react-native', () => ({
  PanResponder: { create: (callbacks: PanResponderCallbacks) => ({ panHandlers: callbacks }) },
}));

const finger = (identifier: string, pageX: number) => ({ identifier, pageX, pageY: 200 });
const first = finger('1', 100);
const second = finger('2', 200);

function event(touches: ReturnType<typeof finger>[], changedTouches = touches): GestureResponderEvent {
  return { nativeEvent: { touches, changedTouches } } as GestureResponderEvent;
}

function viewer() {
  const close = vi.fn();
  const { panHandlers } = useImageGestures(close, 'portrait');
  // The mocked PanResponder exposes its callbacks so native event ordering can be replayed.
  const callbacks = panHandlers as PanResponderCallbacks;
  const dispatch = (name: keyof PanResponderCallbacks, touchEvent: GestureResponderEvent) => {
    const callback = callbacks[name] as ((event: GestureResponderEvent) => void) | undefined;
    callback?.(touchEvent);
  };
  const tap = () => {
    dispatch('onPanResponderGrant', event([first]));
    vi.advanceTimersByTime(50);
    dispatch('onPanResponderRelease', event([], [first]));
  };
  const pinch = () => {
    dispatch('onPanResponderGrant', event([first]));
    dispatch('onPanResponderStart', event([first, second]));
    dispatch('onPanResponderMove', event([finger('1', 50), finger('2', 250)]));
  };
  return { close, dispatch, tap, pinch };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
afterEach(() => { vi.useRealTimers(); });

it('closes on a normal tap without a preceding pinch', () => {
  const image = viewer();
  image.tap();
  expect(image.close).toHaveBeenCalledOnce();
});

it('blocks taps for one second after the last finger leaves a long pinch', () => {
  const image = viewer();
  image.pinch();
  image.dispatch('onPanResponderEnd', event([first], [second]));
  vi.advanceTimersByTime(2000);
  image.dispatch('onPanResponderRelease', event([], [first]));
  image.tap();
  expect(image.close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(949);
  image.tap(); // Starting inside the cooldown stays blocked even if release is after it.
  expect(image.close).not.toHaveBeenCalled();
  image.tap();
  expect(image.close).toHaveBeenCalledOnce();
});

it('protects against a fresh tap after a cancelled pinch', () => {
  const image = viewer();
  image.pinch();
  vi.advanceTimersByTime(2000);
  image.dispatch('onPanResponderTerminate', event([]));
  image.tap();
  expect(image.close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  image.tap();
  expect(image.close).toHaveBeenCalledOnce();
});

it('renews protection when another pinch starts during the cooldown', () => {
  const image = viewer();
  image.pinch();
  image.dispatch('onPanResponderRelease', event([], [first, second]));
  vi.advanceTimersByTime(900);
  image.dispatch('onPanResponderGrant', event([first, second]));
  image.dispatch('onPanResponderRelease', event([], [first, second]));
  vi.advanceTimersByTime(100);
  image.tap();
  expect(image.close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(850);
  image.tap();
  expect(image.close).toHaveBeenCalledOnce();
});
