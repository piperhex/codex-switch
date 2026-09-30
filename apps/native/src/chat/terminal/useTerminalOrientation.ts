import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

/** Serialize rotation and cleanup so hiding during a pending rotation still restores portrait. */
export function useTerminalOrientation(visible: boolean, {
  initialLandscape = false, waitForShow = false,
} = {}) {
  const [landscape, setLandscape] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const busy = useRef(0);
  const generation = useRef(0);
  const pending = useRef(Promise.resolve());
  const initialRotationRequested = useRef(false);

  useEffect(() => {
    active.current = visible;
    initialRotationRequested.current = false;
    setError('');
    setRotating(busy.current > 0);
    if (!visible) return;
    let observing = true;
    const update = (value: ScreenOrientation.Orientation) => {
      if (observing) setLandscape(value === ScreenOrientation.Orientation.LANDSCAPE_LEFT
        || value === ScreenOrientation.Orientation.LANDSCAPE_RIGHT);
    };
    const subscription = ScreenOrientation.addOrientationChangeListener(event => update(event.orientationInfo.orientation));
    void ScreenOrientation.getOrientationAsync().then(update)
      .catch(() => console.warn('Unable to read terminal orientation'));
    if (!waitForShow) onShow();
    return () => {
      observing = false;
      subscription.remove();
      active.current = false;
      generation.current += 1;
      const portrait = ScreenOrientation.OrientationLock.PORTRAIT_UP;
      pending.current = pending.current.then(() => ScreenOrientation.lockAsync(portrait))
        .catch(() => console.warn('Unable to restore terminal portrait orientation'));
    };
  }, [visible, initialLandscape, waitForShow]);

  const requestRotation = (target: ScreenOrientation.OrientationLock, queue = false) => {
    if (!active.current || (busy.current > 0 && !queue)) return;
    const current = generation.current;
    busy.current += 1;
    setRotating(true);
    setError('');
    Keyboard.dismiss();
    pending.current = pending.current.then(async () => {
      if (!active.current || current !== generation.current) return;
      await ScreenOrientation.lockAsync(target);
    }).catch(() => {
      if (active.current && current === generation.current) setError('旋转失败，请重试');
    }).finally(() => {
      busy.current -= 1;
      if (active.current) setRotating(busy.current > 0);
    });
  };
  const onShow = () => {
    if (!active.current || !initialLandscape || initialRotationRequested.current) return;
    initialRotationRequested.current = true;
    // UIKit must finish presenting the modal before the app's orientation mask changes.
    requestRotation(ScreenOrientation.OrientationLock.LANDSCAPE, true);
  };
  const rotate = () => requestRotation(landscape ? ScreenOrientation.OrientationLock.PORTRAIT_UP
    : ScreenOrientation.OrientationLock.LANDSCAPE);
  return { landscape, rotate, rotating, error, onShow };
}
