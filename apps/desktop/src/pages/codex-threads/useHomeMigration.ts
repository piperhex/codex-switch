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
  fixedTargetHomeId?: string;
  onMigrated?: (targetHomeId: string) => void;
}

export function useHomeMigration(options: Options) {
  const homeId = useSelectedCodexHome();
  const allHomes = useCodexHomes();
  const sourceHome = allHomes.find((home) => home.id === homeId);
  const homes = allHomes.filter((home) => home.id !== homeId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [selectedTargetHomeId, setTargetHomeId] = useState<string>();
  const targetHomeId = options.fixedTargetHomeId ?? selectedTargetHomeId;
  const targetHome = homes.find((home) => home.id === targetHomeId);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const inFlight = useRef(false);
  const show = () => {
    setError("");
    setSessionIds([...options.selected]);
    setTargetHomeId(homes[0]?.id);
    setOpen(true);
  };
  const commit = async () => {
    if (inFlight.current || !targetHome || !sessionIds.length) return;
    inFlight.current = true;
    setError("");
    options.setBusy(true);
    try {
      const result = await migrateCodexThreadsToHome({ homeId, targetHomeId: targetHome.id, sessionIds });
      options.notify(result.message);
      options.clearSelection();
      setOpen(false);
      options.onMigrated?.(targetHome.id);
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
  return { error, open, setOpen, homes, sourceHome, targetHome, targetHomeId, setTargetHomeId,
    fixedTarget: options.fixedTargetHomeId !== undefined, count: sessionIds.length, show, commit };
}
