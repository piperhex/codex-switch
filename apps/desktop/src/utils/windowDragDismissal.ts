const DRAG_REGION_SELECTOR = '[data-tauri-drag-region]:not([data-tauri-drag-region="false"])';

export function installWindowDragDismissal() {
  const dismissFocusedCombobox = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.composedPath()[0];
    if (!(target instanceof Element) || !target.matches(DRAG_REGION_SELECTOR)) return;

    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !focused.matches('[role="combobox"]')) return;
    if (target.contains(focused)) return;

    // Tauri stops mousedown propagation and prevents focus changes when dragging.
    // Blur during capture so Select/AutoComplete can close before native dragging takes over.
    focused.blur();
  };

  document.addEventListener("mousedown", dismissFocusedCombobox, true);
  return () => document.removeEventListener("mousedown", dismissFocusedCombobox, true);
}
