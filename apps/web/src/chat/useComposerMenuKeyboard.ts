import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface ComposerMenuOption { key: string; enabled: boolean; choose: () => void }
interface Options {
  input: RefObject<HTMLTextAreaElement>; query: string; options: ComposerMenuOption[]; close: () => void;
  selectWithTab?: boolean;
}

function revealOption(list: HTMLDivElement | null) {
  const option = list?.querySelector<HTMLElement>('[aria-current="true"]');
  const popup = list?.closest<HTMLElement>('.chat-composer-popover');
  if (!option || !popup) return;
  const bounds = popup.getBoundingClientRect();
  const item = option.getBoundingClientRect();
  const top = bounds.top + popup.clientTop + (popup.querySelector('header')?.offsetHeight ?? 0);
  const bottom = bounds.top + popup.clientTop + popup.clientHeight;
  if (item.top < top) popup.scrollTop += item.top - top;
  else if (item.bottom > bottom) popup.scrollTop += item.bottom - bottom;
}

export function useComposerMenuKeyboard({ input, query, options, close, selectWithTab = false }: Options) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ query: string; key: string } | null>(null);
  const enabled = options.filter(option => option.enabled);
  const index = Math.max(0, enabled.findIndex(option => selection?.query === query && option.key === selection.key));
  const active = enabled[index];
  const optionId = (key: string) => `${id}-${encodeURIComponent(key)}`;
  const activeId = active ? optionId(active.key) : undefined;

  useLayoutEffect(() => { revealOption(list.current); }, [activeId, query]);

  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.setAttribute('aria-controls', id);
    node.setAttribute('aria-haspopup', 'menu');
    if (activeId) node.setAttribute('aria-activedescendant', activeId);
    else node.removeAttribute('aria-activedescendant');
    return () => {
      node.removeAttribute('aria-controls'); node.removeAttribute('aria-haspopup');
      node.removeAttribute('aria-activedescendant');
    };
  }, [input, id, activeId]);

  useEffect(() => {
    const node = input.current;
    if (!node) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)
        && !(selectWithTab && event.key === 'Tab')) return;
      event.preventDefault();
      if (event.key === 'Escape') { close(); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { active?.choose(); return; }
      if (!enabled.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelection({ query, key: enabled[(index + step + enabled.length) % enabled.length].key });
    };
    // Handle menu keys before React receives the event for the composer's send shortcut.
    node.addEventListener('keydown', keydown);
    return () => node.removeEventListener('keydown', keydown);
  }, [input, query, enabled, index, active, close, selectWithTab]);

  return { list, id, optionProps: (key: string) => ({ id: optionId(key), tabIndex: -1,
    'aria-current': key === active?.key ? 'true' as const : undefined }) };
}
