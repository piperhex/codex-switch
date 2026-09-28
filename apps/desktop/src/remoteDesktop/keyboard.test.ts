import { expect, it, vi } from 'vitest';
import { DesktopKeyboard, desktopKeyCode } from '../../../../shared/remote-desktop/keyboard';

it('forwards shortcuts and repeated keys, then releases exactly the keys still held', () => {
  const send = vi.fn(); const keyboard = new DesktopKeyboard(send);
  keyboard.press('ControlLeft'); keyboard.press('KeyA'); keyboard.press('KeyA'); keyboard.releaseKey('KeyA');
  keyboard.release(); keyboard.release(); keyboard.releaseKey('KeyA');
  expect(send.mock.calls.map(([input]) => input)).toEqual([
    { kind: 'keyboard', code: 'ControlLeft', down: true },
    { kind: 'keyboard', code: 'KeyA', down: true }, { kind: 'keyboard', code: 'KeyA', down: true },
    { kind: 'keyboard', code: 'KeyA', down: false }, { kind: 'keyboard', code: 'ControlLeft', down: false },
  ]);
});
it('allows editing and physical modifier keys while rejecting unknown and malformed codes', () => {
  for (const code of ['ArrowLeft', 'Home', 'ShiftRight', 'NumpadEnter', 'F24', 'Digit9', 'KeyZ']) {
    expect(desktopKeyCode(code)).toBe(true);
  }
  for (const code of ['', 'KeyAA', 'F25', 'F0', 'LaunchApplication1']) expect(desktopKeyCode(code)).toBe(false);
});
