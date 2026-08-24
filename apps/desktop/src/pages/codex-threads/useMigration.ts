import { useCallback } from "react";
import { migrateCodexThreads } from "../../api/backend";
import type { ThreadCopy } from "./copy";

interface MigrationOptions {
  text: ThreadCopy;
  notify: (message: string) => void;
  reportError: (error: unknown) => void;
  refresh: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  clearSelection: () => void;
}

export function useMigration(options: MigrationOptions) {
  const { text, notify, reportError, refresh, setBusy, clearSelection } = options;
  return useCallback(async (sessionIds: string[]) => {
    if (!sessionIds.length) {
      notify(text.pickOne);
      return;
    }
    setBusy(true);
    try {
      const result = await migrateCodexThreads(sessionIds);
      notify(result.message);
      clearSelection();
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }, [clearSelection, notify, refresh, reportError, setBusy, text]);
}
