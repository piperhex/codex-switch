import { findNodeHandle, NativeModules, Platform, type View } from 'react-native';

interface DesktopInputWindow { showKeyboard?: (tag: number) => Promise<void> }
const inputWindow = NativeModules.DesktopWindow as DesktopInputWindow | undefined;

export function focusDesktopIme(container: View | null) {
  if (Platform.OS !== 'android' || !container || !inputWindow?.showKeyboard) return;
  const tag = findNodeHandle(container);
  if (tag !== null) void inputWindow.showKeyboard(tag)
    .catch(() => console.warn('Unable to open the desktop input keyboard'));
}
