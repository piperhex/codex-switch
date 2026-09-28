import type { DesktopInput } from './protocol';

/** Shared composition handling for the browser input and the bundled native input WebView. */
export function bindDesktopIme(element: HTMLTextAreaElement, send: (input: DesktopInput) => void) {
  let composing = false;
  let committed = '';
  let clearCommit: ReturnType<typeof setTimeout> | undefined;
  const commit = (text: string) => {
    if (text) send({ kind: 'text', text });
    element.value = '';
  };
  const start = () => { composing = true; committed = ''; };
  const end = (event: CompositionEvent) => {
    composing = false;
    committed = event.data;
    commit(event.data);
    clearTimeout(clearCommit);
    clearCommit = setTimeout(() => { committed = ''; }, 0);
  };
  const input = (event: Event) => {
    if (composing || (event as InputEvent).isComposing) return;
    // Some IMEs deliver the committed text again in a final input event.
    if (committed && (event as InputEvent).data === committed) element.value = '';
    else commit(element.value);
    committed = '';
  };
  const beforeInput = (event: InputEvent) => {
    if (composing || event.isComposing) return;
    const key = event.inputType === 'deleteContentBackward' ? 'backspace'
      : ['insertLineBreak', 'insertParagraph'].includes(event.inputType) ? 'enter' : undefined;
    if (key) { event.preventDefault(); send({ kind: 'key', key }); }
  };
  const keydown = (event: KeyboardEvent) => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    const keys = { Backspace: 'backspace', Enter: 'enter', Tab: 'tab', Escape: 'escape' } as const;
    const key = keys[event.key as keyof typeof keys];
    if (key) { event.preventDefault(); send({ kind: 'key', key }); }
  };
  element.addEventListener('compositionstart', start); element.addEventListener('compositionend', end);
  element.addEventListener('input', input); element.addEventListener('beforeinput', beforeInput);
  element.addEventListener('keydown', keydown);
  return () => {
    clearTimeout(clearCommit);
    element.removeEventListener('compositionstart', start); element.removeEventListener('compositionend', end);
    element.removeEventListener('input', input); element.removeEventListener('beforeinput', beforeInput);
    element.removeEventListener('keydown', keydown);
  };
}

/** Accept only the small input vocabulary emitted by the local IME document. */
export function parseDesktopImeMessage(data: string): DesktopInput | undefined {
  try {
    const value = JSON.parse(data) as Record<string, unknown> | null;
    if (value?.kind === 'text' && typeof value.text === 'string' && value.text.length <= 1000) {
      return { kind: 'text', text: value.text };
    }
    if (value?.kind === 'key' && ['backspace', 'enter', 'tab', 'escape'].includes(String(value.key))) {
      return { kind: 'key', key: value.key as 'backspace' | 'enter' | 'tab' | 'escape' };
    }
  } catch { /* Ignore malformed messages from the input view. */ }
}
