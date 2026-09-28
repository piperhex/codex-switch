import { useState } from 'react';
import type { DesktopInput } from './protocol';
import { sendDesktopChord, type InputTab } from './softKeyboard';

export function useSoftKeyboard(input: (event: DesktopInput) => void) {
  const [tab, setTab] = useState<InputTab>('ime');
  const [page, setPage] = useState(0);
  const [combination, setCombination] = useState(false);
  const [modifiers, setModifiers] = useState<string[]>([]);
  return {
    tab, page, setPage, combination, modifiers,
    selectTab: (next: InputTab) => { setModifiers([]); setTab(next); },
    toggleCombination: () => { setModifiers([]); setCombination(value => !value); },
    modifier: (code: string) => {
      if (!combination) { sendDesktopChord(input, [code]); return; }
      setModifiers(current => current.includes(code) ? current.filter(value => value !== code) : [...current, code]);
    },
    press: (code: string) => { sendDesktopChord(input, [...modifiers, code]); setModifiers([]); },
    shortcut: (codes: string[]) => { setModifiers([]); sendDesktopChord(input, codes); },
  };
}
