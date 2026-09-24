import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { migrateCodexThreadsToHome } from "../../api/backend";
import { useCodexHomes, useSelectedCodexHome } from "../../components/CodexHomeScope";

interface Options {
  selected: Set<string>;
  clearSelection: () => void;
  refresh: () => Promise<void>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  notify: (message: string) => void;
  reportError: (error: unknown) => void;
  onMigrated?: (targetHomeId: string) => void;
}

export function useHomeMigration(options: Options) {
  const homeId = useSelectedCodexHome();
  const homes = useCodexHomes().filter((home) => home.id !== homeId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [targetHomeId, setTargetHomeId] = useState<string>();
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const inFlight = useRef(false);
  const show = () => {
    setError("");
    setSessionIds([...options.selected]);
    setTargetHomeId(homes[0]?.id);
    setOpen(true);
  };
  const commit = async () => {
    if (inFlight.current || !targetHomeId || !sessionIds.length) return;
    inFlight.current = true;
    setError("");
    options.setBusy(true);
    try {
      const result = await migrateCodexThreadsToHome({ homeId, targetHomeId, sessionIds });
      options.notify(result.message);
      options.clearSelection();
      setOpen(false);
      options.onMigrated?.(targetHomeId);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      options.reportError(error);
    } finally {
      try {
        await options.refresh();
      } catch (error) {
        options.reportError(error);
      }
      inFlight.current = false;
      options.setBusy(false);
    }
  };
  return { error, open, setOpen, homes, targetHomeId, setTargetHomeId, count: sessionIds.length, show, commit };
}
