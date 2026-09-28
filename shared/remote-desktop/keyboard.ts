import type { DesktopInput } from './protocol';

const SPECIAL_CODES = new Set(['Backspace', 'Tab', 'Enter', 'Escape', 'Space', 'PageUp', 'PageDown',
  'End', 'Home', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Insert', 'Delete', 'Pause',
  'CapsLock', 'NumLock', 'ScrollLock', 'PrintScreen', 'ContextMenu', 'ShiftLeft', 'ShiftRight',
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Semicolon', 'Equal',
  'Comma', 'Minus', 'Period', 'Slash', 'Backquote', 'BracketLeft', 'Backslash', 'BracketRight', 'Quote',
  'IntlBackslash', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter']);
export function desktopKeyCode(code: string) {
  return SPECIAL_CODES.has(code) || /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(code);
}

/** Track only keys sent by this viewer, so losing focus cannot leave a remote modifier held. */
export class DesktopKeyboard {
  private held = new Set<string>();
  constructor(private readonly send: (input: DesktopInput) => void) {}
  press(code: string) {
    if (!desktopKeyCode(code)) return false;
    this.held.add(code); this.send({ kind: 'keyboard', code, down: true }); return true;
  }
  releaseKey(code: string) {
    if (!this.held.delete(code)) return false;
    this.send({ kind: 'keyboard', code, down: false }); return true;
  }
  release() { for (const code of [...this.held].reverse()) this.releaseKey(code); }
}
