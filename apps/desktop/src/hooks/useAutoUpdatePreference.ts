import { useCallback, useSyncExternalStore } from "react";
import {
  isAutoUpdateEnabled,
  setAutoUpdateEnabled,
  subscribeToAutoUpdatePreference,
} from "../api/appUpdatePreferences";
import type { Translate } from "../i18n";

export function useAutoUpdatePreference(notify: (message: string) => void, t: Translate) {
  const enabled = useSyncExternalStore(subscribeToAutoUpdatePreference, isAutoUpdateEnabled);
  const setEnabled = useCallback((nextEnabled: boolean) => {
    try {
      setAutoUpdateEnabled(nextEnabled);
    } catch {
      notify(t("settings.autoUpdate.saveError"));
    }
  }, [notify, t]);

  return { enabled, setEnabled };
}
