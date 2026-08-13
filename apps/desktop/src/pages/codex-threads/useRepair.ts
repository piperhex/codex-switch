import { useState } from "react";
import { repairCodexThreadVisibility } from "../../api/backend";
import type { CodexThreadVisibilityReport } from "../../types";
import type { ThreadCopy } from "./copy";

interface RepairOptions {
  selected: Set<string>;
  text: ThreadCopy;
  notify: (message: string) => void;
  reportError: (error: unknown) => void;
  refresh: () => Promise<void>;
}

export function useRepair(options: RepairOptions) {
  const { selected, text, notify, reportError, refresh } = options;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"quick" | "deep">("quick");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [preview, setPreview] = useState<CodexThreadVisibilityReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    if (scope === "selected" && !selected.size) {
      notify(text.selectedEmpty);
      return;
    }
    setBusy(true);
    try {
      const sessionIds = scope === "selected" ? [...selected] : null;
      const result = await repairCodexThreadVisibility({ mode, sessionIds, dryRun });
      if (dryRun) {
        setPreview(result);
        return;
      }
      notify(result.message);
      setOpen(false);
      setPreview(null);
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  const openModal = () => {
    setPreview(null);
    setOpen(true);
  };
  const updateMode = (value: "quick" | "deep") => {
    setMode(value);
    setPreview(null);
  };
  const updateScope = (value: "all" | "selected") => {
    setScope(value);
    setPreview(null);
  };

  return {
    open, setOpen, mode, updateMode, scope, updateScope, preview, busy, run, openModal,
  };
}
