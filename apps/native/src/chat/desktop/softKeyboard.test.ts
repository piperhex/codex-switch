import { expect, it, vi } from 'vitest';
import { desktopKeyCode } from '../../../../../shared/remote-desktop/keyboard';
import { DESKTOP_SHORTCUTS, KEYBOARD_PAGES, MODIFIERS, sendDesktopChord }
  from '../../../../../shared/remote-desktop/softKeyboard';
import { parseDesktopImeMessage } from '../../../../../shared/remote-desktop/ime';

it('sends a chord in order and releases every key in reverse order', () => {
  const input = vi.fn();
  sendDesktopChord(input, ['ControlLeft', 'ShiftLeft', 'KeyZ']);
  expect(input.mock.calls.map(([event]) => event)).toEqual([
    { kind: 'keyboard', code: 'ControlLeft', down: true },
    { kind: 'keyboard', code: 'ShiftLeft', down: true },
    { kind: 'keyboard', code: 'KeyZ', down: true },
    { kind: 'keyboard', code: 'KeyZ', down: false },
    { kind: 'keyboard', code: 'ShiftLeft', down: false },
    { kind: 'keyboard', code: 'ControlLeft', down: false },
  ]);
});

it('only offers keys that the remote keyboard protocol supports', () => {
  const codes = [...KEYBOARD_PAGES.flat(2), ...MODIFIERS].map(key => key.code);
  codes.push(...DESKTOP_SHORTCUTS.flatMap(shortcut => shortcut.codes));
  expect(codes.every(desktopKeyCode)).toBe(true);
});

it('limits the native IME bridge to committed text and supported editing keys', () => {
  expect(parseDesktopImeMessage('{"kind":"text","text":"你好"}')).toEqual({ kind: 'text', text: '你好' });
  expect(parseDesktopImeMessage('{"kind":"key","key":"backspace"}'))
    .toEqual({ kind: 'key', key: 'backspace' });
  for (const invalid of ['null', '{', '{"kind":"text","text":42}', '{"kind":"key","key":"desktop"}',
    JSON.stringify({ kind: 'text', text: 'a'.repeat(1001) })]) expect(parseDesktopImeMessage(invalid)).toBeUndefined();
});
