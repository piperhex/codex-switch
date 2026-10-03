import { useEffect, useMemo, useRef } from 'react';
import { AppState, PanResponder } from 'react-native';
import type { ScrollPadGesture } from '../../../../../shared/remote-desktop/useScrollPad';

export function useScrollButton(scroll: ScrollPadGesture) {
  const latest = useRef(scroll); latest.current = scroll;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') scroll.end(); });
    return () => { subscription.remove(); scroll.end(); };
  }, [scroll.end]);
  return useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => latest.current.start(),
    onPanResponderStart: (_event, gesture) => { if (gesture.numberActiveTouches > 1) latest.current.end(); },
    onPanResponderMove: (_event, gesture) => latest.current.move({ x: gesture.dx, y: gesture.dy }),
    onPanResponderRelease: () => latest.current.end(),
    onPanResponderTerminate: () => latest.current.end(),
  }), []);
}
