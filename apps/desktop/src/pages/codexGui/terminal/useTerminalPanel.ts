import { useState } from "react";

export const MAX_TERMINAL_TABS = 8;
export interface TerminalTab { id: string; cwd: string }

export function useTerminalPanel(cwd: string) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const add = () => {
    if (tabs.length >= MAX_TERMINAL_TABS) return;
    const tab = { id: crypto.randomUUID(), cwd };
    setTabs((current) => [...current, tab]); setSelected(tab.id); setOpen(true);
  };
  const remove = (id: string) => {
    const remaining = tabs.filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (selected === id) setSelected(remaining.at(-1)?.id ?? "");
    if (!remaining.length) setOpen(false);
  };
  return { tabs, selected, open, add, remove, select: setSelected, hide: () => setOpen(false),
    toggle: () => { if (!tabs.length) add(); else setOpen(!open); } };
}

export type TerminalPanelState = ReturnType<typeof useTerminalPanel>;
