import { useCallback, useEffect, useState } from "react";
import { loadAppSettings, subscribeToFloatingBubbleChanges, updateFloatingBubble } from "../api/backend";

export function useFloatingBubble(notify: (message: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = subscribeToFloatingBubbleChanges((nextEnabled) => {
      changed = true;
      if (active) setEnabled(nextEnabled);
    });
    void loadAppSettings()
      .then((settings) => {
        if (active && !changed) setEnabled(settings.floatingBubbleEnabled);
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [notify]);

  const updateEnabled = useCallback(async (nextEnabled: boolean) => {
    const previous = enabled;
    setEnabled(nextEnabled);
    setLoading(true);
    try {
      const settings = await updateFloatingBubble(nextEnabled);
      setEnabled(settings.floatingBubbleEnabled);
    } catch (error) {
      // A window operation can fail after the preference was saved for automatic recovery.
      const settings = await loadAppSettings().catch(() => null);
      setEnabled(settings?.floatingBubbleEnabled ?? previous);
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [enabled, notify]);

  return { enabled, loading, setEnabled: updateEnabled };
}
