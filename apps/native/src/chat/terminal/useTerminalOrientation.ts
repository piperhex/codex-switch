import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

/** Serialize rotation and cleanup so hiding during a pending rotation still restores portrait. */
export function useTerminalOrientation(visible: boolean) {
  const [landscape, setLandscape] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const pending = useRef(Promise.resolve());

  useEffect(() => {
    active.current = visible;
    setError('');
    setRotating(busy.current);
    if (!visible) return;
    let observing = true;
    const update = (value: ScreenOrientation.Orientation) => {
      if (observing) setLandscape(value === ScreenOrientation.Orientation.LANDSCAPE_LEFT
        || value === ScreenOrientation.Orientation.LANDSCAPE_RIGHT);
    };
    const subscription = ScreenOrientation.addOrientationChangeListener(event => update(event.orientationInfo.orientation));
    void ScreenOrientation.getOrientationAsync().then(update)
      .catch(() => console.warn('Unable to read terminal orientation'));
    return () => {
      observing = false;
      subscription.remove();
      active.current = false;
      generation.current += 1;
      const portrait = ScreenOrientation.OrientationLock.PORTRAIT_UP;
      pending.current = pending.current.then(() => ScreenOrientation.lockAsync(portrait))
        .catch(() => console.warn('Unable to restore terminal portrait orientation'));
    };
  }, [visible]);

  const rotate = () => {
    if (!active.current || busy.current) return;
    const current = generation.current;
    const target = landscape ? ScreenOrientation.OrientationLock.PORTRAIT_UP
      : ScreenOrientation.OrientationLock.LANDSCAPE;
    busy.current = true;
    setRotating(true);
    setError('');
    Keyboard.dismiss();
    pending.current = pending.current.then(async () => {
      if (!active.current || current !== generation.current) return;
      await ScreenOrientation.lockAsync(target);
    }).catch(() => {
      if (active.current && current === generation.current) setError('旋转失败，请重试');
    }).finally(() => {
      busy.current = false;
      if (active.current) setRotating(false);
    });
  };
  return { landscape, rotate, rotating, error };
}
