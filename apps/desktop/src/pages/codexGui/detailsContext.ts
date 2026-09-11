import { createContext, useContext, useEffect } from "react";
import type { DiffFile } from "./diff";

export interface DiffPanelEntry { id: string; title: string; files: DiffFile[]; status?: string; filePath?: string }
interface DetailsContextValue {
  open: (entry: DiffPanelEntry) => void;
  update: (entry: DiffPanelEntry) => void;
  visible: boolean;
  close: () => void;
}
export const DetailsContext = createContext<DetailsContextValue | null>(null);

export function useDetailsEntry(entry: DiffPanelEntry) {
  const panel = useContext(DetailsContext);
  const update = panel?.update;
  useEffect(() => { update?.(entry); }, [update, entry]);
  return panel;
}
