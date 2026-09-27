import { useCallback, useEffect, useRef } from 'react';
import { findNodeHandle, Keyboard, NativeModules, Platform, type View } from 'react-native';

interface DesktopWindowModule { setImmersive: (tag: number, enabled: boolean) => Promise<void> }
const desktopWindow = NativeModules.DesktopWindow as DesktopWindowModule | undefined;

export function useDesktopWindow(landscape: boolean) {
  const stage = useRef<View>(null);
  const update = useCallback(() => {
    if (Platform.OS !== 'android' || !desktopWindow || !stage.current) return;
    const tag = findNodeHandle(stage.current);
    if (tag !== null) void desktopWindow.setImmersive(tag, landscape)
      .catch(() => console.warn('Unable to update the desktop window bars'));
  }, [landscape]);
  useEffect(update, [update]);
  useEffect(() => {
    // Android's IME can reveal the navigation bar again after the modal's last layout callback.
    let frame: number | undefined;
    const subscription = Keyboard.addListener('keyboardDidHide', () => { frame = requestAnimationFrame(update); });
    return () => { subscription.remove(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [update]);
  return { stage, update };
}
