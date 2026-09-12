import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, type GestureResponderEvent } from 'react-native';
import { INITIAL_TRANSFORM, moveImage, type Point } from '../../../../shared/chat/imageTransform';

const TAP_DISTANCE = 8;
const TAP_DURATION_MS = 250;
const points = (event: GestureResponderEvent): Point[] => event.nativeEvent.touches.map((touch) =>
  ({ x: touch.pageX, y: touch.pageY }));

export function useImageGestures(close: () => void, orientation: string) {
  const [transform, setTransform] = useState(INITIAL_TRANSFORM);
  const current = useRef(transform);
  const onClose = useRef(close);
  current.current = transform;
  onClose.current = close;
  const anchor = useRef({ before: transform, start: [] as Point[] });
  const tap = useRef({ started: 0, moved: false });
  useEffect(() => { setTransform(INITIAL_TRANSFORM); }, [orientation]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      anchor.current = { before: current.current, start: points(event) };
      tap.current = { started: Date.now(), moved: points(event).length !== 1 };
    },
    onPanResponderStart: (event) => { if (points(event).length > 1) tap.current.moved = true; },
    onPanResponderMove: (event, gesture) => {
      const touches = points(event);
      if (touches.length > 1 || Math.hypot(gesture.dx, gesture.dy) > TAP_DISTANCE) tap.current.moved = true;
      if (touches.length !== anchor.current.start.length) {
        anchor.current = { before: current.current, start: touches };
      }
      setTransform(moveImage({ ...anchor.current, current: touches }));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (!tap.current.moved && Math.hypot(gesture.dx, gesture.dy) <= TAP_DISTANCE
        && Date.now() - tap.current.started <= TAP_DURATION_MS) onClose.current();
    },
    onPanResponderTerminationRequest: () => false,
  }), []);
  return { transform, panHandlers: responder.panHandlers };
}
