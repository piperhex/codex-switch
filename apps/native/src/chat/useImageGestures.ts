import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, type GestureResponderEvent } from 'react-native';
import { INITIAL_TRANSFORM } from '../../../../shared/chat/imageTransform';
import { beginImageGesture, isImageGestureTap, updateImageGesture,
  type ImageGestureState, type ImageGestureTouch } from './imageGesture';

const points = (touches: GestureResponderEvent['nativeEvent']['touches']): ImageGestureTouch[] => touches.map((touch) =>
  ({ identifier: touch.identifier, x: touch.pageX, y: touch.pageY }));

export function useImageGestures(close: () => void, orientation: string) {
  const [transform, setTransform] = useState(INITIAL_TRANSFORM);
  const current = useRef(transform);
  const onClose = useRef(close);
  onClose.current = close;
  const gesture = useRef<ImageGestureState | null>(null);
  useEffect(() => {
    gesture.current = null;
    current.current = INITIAL_TRANSFORM;
    setTransform(INITIAL_TRANSFORM);
  }, [orientation]);
  const updateTouches = (event: GestureResponderEvent) => {
    if (!gesture.current || !event.nativeEvent.touches.length) return;
    gesture.current = updateImageGesture(gesture.current, points(event.nativeEvent.touches));
    current.current = gesture.current.transform;
    setTransform(current.current);
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      gesture.current = beginImageGesture(current.current, points(event.nativeEvent.touches), Date.now());
    },
    onPanResponderStart: updateTouches,
    onPanResponderMove: updateTouches,
    onPanResponderEnd: updateTouches,
    onPanResponderRelease: (event) => {
      const tapped = isImageGestureTap(gesture.current, points(event.nativeEvent.changedTouches), Date.now());
      gesture.current = null;
      if (tapped) onClose.current();
    },
    onPanResponderTerminate: () => { gesture.current = null; },
    onPanResponderTerminationRequest: () => false,
  }), []);
  return { transform, panHandlers: responder.panHandlers };
}
