import { useRef } from 'react';
import type { GestureResponderEvent } from 'react-native';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import type { DesktopViewport } from '../../../../../shared/remote-desktop/geometry';
import type { DesktopZoom, TouchPair } from '../../../../../shared/remote-desktop/zoom';

interface Options { pointer: DesktopPointer; viewport: DesktopViewport; zoom?: DesktopZoom }

/** Once two fingers take over, swallow the remaining single finger until the whole gesture ends. */
export function usePinchZoom(options: Options) {
  const latest = useRef(options); latest.current = options;
  const state = useRef({ consumed: false, pair: '', target: '' });
  const end = () => {
    const consumed = state.current.consumed;
    state.current = { consumed: false, pair: '', target: '' }; latest.current.zoom?.end();
    return consumed;
  };
  const update = (event: GestureResponderEvent) => {
    const { pointer, viewport, zoom } = latest.current;
    if (!zoom) return false;
    const touches = (event.nativeEvent.touches ?? []).filter(touch => touch.target === state.current.target);
    if (touches.length < 2) { state.current.pair = ''; zoom.end(); return state.current.consumed; }
    const pair = touches.slice(0, 2).map(touch => touch.identifier).join(':');
    const [a, b] = touches;
    const points: TouchPair = [{ x: a.locationX, y: a.locationY }, { x: b.locationX, y: b.locationY }];
    if (state.current.pair !== pair) { pointer.release(); zoom.start(points, viewport); }
    else zoom.move(points);
    state.current.consumed = true; state.current.pair = pair;
    return true;
  };
  return { update, end, start: (event: GestureResponderEvent) => {
    end(); state.current.target = event.nativeEvent.target; return update(event);
  } };
}
