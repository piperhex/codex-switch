import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

const SWIPE_START_DISTANCE = 12;
const SWIPE_OPEN_DISTANCE = 60;
const HORIZONTAL_DIRECTION_RATIO = 1.5;

export function useChatDrawerSwipe(enabled: boolean, onOpen: () => void) {
  const ignored = useRef(false);
  return useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => {
      ignored.current = !enabled;
      return false;
    },
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      if (!enabled || ignored.current) return false;
      const { dx, dy, numberActiveTouches } = gesture;
      // Once scrolling or swiping left starts, let that gesture finish without opening the drawer.
      if (numberActiveTouches !== 1 || dx < -SWIPE_START_DISTANCE
        || (Math.abs(dy) > SWIPE_START_DISTANCE && Math.abs(dy) >= Math.abs(dx))) {
        ignored.current = true;
        return false;
      }
      return dx > SWIPE_START_DISTANCE && dx > Math.abs(dy) * HORIZONTAL_DIRECTION_RATIO;
    },
    onPanResponderMove: (_event, gesture) => {
      if (gesture.numberActiveTouches !== 1) ignored.current = true;
    },
    onPanResponderRelease: (_event, gesture) => {
      if (enabled && !ignored.current && gesture.dx >= SWIPE_OPEN_DISTANCE
        && gesture.dx > Math.abs(gesture.dy) * HORIZONTAL_DIRECTION_RATIO) onOpen();
    },
  }).panHandlers, [enabled, onOpen]);
}
