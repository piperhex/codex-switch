import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import * as ScreenOrientation from 'expo-screen-orientation';
import { imageOrientation, type ImageOrientation } from './imageOrientation';

const SAMPLE_INTERVAL_MS = 200;
const STABLE_SAMPLES = 3;
const LOCKS = {
  portrait: ScreenOrientation.OrientationLock.PORTRAIT_UP,
  'portrait-down': ScreenOrientation.OrientationLock.PORTRAIT_DOWN,
  'landscape-left': ScreenOrientation.OrientationLock.LANDSCAPE_LEFT,
  'landscape-right': ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT,
} satisfies Record<ImageOrientation, ScreenOrientation.OrientationLock>;

export function useImageOrientation() {
  const [displayed, setDisplayed] = useState<ImageOrientation>('portrait');
  const [device, setDevice] = useState<ImageOrientation | null>(null);
  const [error, setError] = useState('');
  const [rotating, setRotating] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const pending = useRef(Promise.resolve());

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let subscription: ReturnType<typeof Accelerometer.addListener> | undefined;
    let candidate: ImageOrientation | null = null;
    let samples = 0;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (!active || !available) return;
      Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
      subscription = Accelerometer.addListener((gravity) => {
        const next = imageOrientation(gravity, Platform.OS);
        samples = next === candidate ? samples + 1 : 1;
        candidate = next;
        if (samples >= STABLE_SAMPLES) setDevice(next);
      });
    }).catch(() => { if (active) setError('暂时无法识别手机方向'); });
    return () => {
      active = false;
      mounted.current = false;
      subscription?.remove();
      // Wait for an in-flight rotation before restoring the chat's portrait lock.
      void pending.current.then(() => ScreenOrientation.lockAsync(LOCKS.portrait))
        .catch(() => console.warn('Unable to restore portrait orientation'));
    };
  }, []);

  const rotate = () => {
    if (!device || device === displayed || busy.current) return;
    const target = device;
    busy.current = true;
    setRotating(true);
    setError('');
    pending.current = (async () => {
      try {
        if (!await ScreenOrientation.supportsOrientationLockAsync(LOCKS[target])) {
          if (mounted.current) setError('此方向暂不支持，请换个方向试试');
          return;
        }
        if (!mounted.current) return;
        await ScreenOrientation.lockAsync(LOCKS[target]);
        if (mounted.current) setDisplayed(target);
      } catch {
        if (mounted.current) setError('旋转失败，请重试');
      } finally {
        busy.current = false;
        if (mounted.current) setRotating(false);
      }
    })();
  };
  return { suggested: device !== null && device !== displayed, rotate, rotating, error, displayed };
}
