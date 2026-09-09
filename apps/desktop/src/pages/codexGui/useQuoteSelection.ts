import { useEffect, useState, type RefObject } from "react";
import { selectedQuote, type SelectedQuote } from "./selectedQuote";

export function useQuoteSelection({ root, selected, enabled }: {
  root: RefObject<HTMLDivElement>; selected: string | null; enabled: boolean;
}) {
  const [selection, setSelection] = useState<SelectedQuote | null>(null);
  useEffect(() => {
    setSelection(null);
    if (!enabled || !selected) return;
    const inspect = () => setSelection(root.current ? selectedQuote(root.current) : null);
    const dismiss = () => setSelection(null);
    const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    document.addEventListener("selectionchange", inspect);
    document.addEventListener("keydown", keyDown);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("selectionchange", inspect);
      document.removeEventListener("keydown", keyDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [root, selected, enabled]);
  return { selection: enabled ? selection : null, dismiss: () => setSelection(null) };
}
