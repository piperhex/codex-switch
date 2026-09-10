import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

export function useChatKeyboard() {
  const [visible, setVisible] = useState(Keyboard.isVisible);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}
