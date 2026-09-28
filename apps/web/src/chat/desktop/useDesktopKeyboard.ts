import { useEffect, useMemo, useRef, type ClipboardEvent, type CompositionEvent, type FormEvent,
  type KeyboardEvent } from 'react';
import { DesktopKeyboard } from '../../../../../shared/remote-desktop/keyboard';
import type { DesktopInput } from '../../../../../shared/remote-desktop/protocol';

interface Options {
  active: boolean; input: (input: DesktopInput) => void;
  copy: (shortcut: 'copy' | 'cut') => void; paste: (data: DataTransfer) => void;
  pasteShortcut?: () => void;
}
export function useDesktopKeyboard(options: Options) {
  const current = useRef(options); current.current = options;
  const composing = useRef(false);
  const keyboard = useMemo(() => new DesktopKeyboard(input => current.current.input(input)), []);
  useEffect(() => {
    const release = () => keyboard.release();
    const hidden = () => { if (document.hidden) release(); };
    window.addEventListener('blur', release); document.addEventListener('visibilitychange', hidden);
    return () => { release(); window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', hidden); };
  }, [keyboard]);
  useEffect(() => { if (!options.active) keyboard.release(); }, [keyboard, options.active]);
  const commit = (element: HTMLTextAreaElement, text: string) => {
    if (options.active && text) options.input({ kind: 'text', text });
    element.value = '';
  };
  return {
    release: () => keyboard.release(),
    handlers: {
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!options.active || event.nativeEvent.isComposing || composing.current || event.key === 'Process') return;
        const command = event.ctrlKey || event.metaKey;
        if ((command && event.code === 'KeyV') || (event.shiftKey && event.code === 'Insert')) {
          keyboard.release();
          if (options.pasteShortcut) {
            event.preventDefault();
            if (!event.repeat) options.pasteShortcut();
          }
          return; // Browsers use the trusted paste event; desktop viewers read the OS clipboard.
        }
        if (command && !event.shiftKey && !event.altKey && ['KeyC', 'KeyX', 'Insert'].includes(event.code)) {
          event.preventDefault(); keyboard.release();
          if (!event.repeat) options.copy(event.code === 'KeyX' ? 'cut' : 'copy');
          return;
        }
        if (keyboard.press(event.code)) event.preventDefault();
      },
      onKeyUp: (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (keyboard.releaseKey(event.code)) event.preventDefault();
      },
      onBlur: () => keyboard.release(),
      onCompositionStart: () => { composing.current = true; keyboard.release(); },
      onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => {
        composing.current = false; commit(event.currentTarget, event.data);
      },
      onInput: (event: FormEvent<HTMLTextAreaElement>) => {
        if (!composing.current) commit(event.currentTarget, event.currentTarget.value);
      },
      onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
        event.preventDefault(); keyboard.release();
        if (options.active) options.paste(event.clipboardData);
      },
    },
  };
}
