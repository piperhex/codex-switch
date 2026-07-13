import { useCallback, useEffect, useState } from "react";
import { loadAppSettings, updatePrivacyMode } from "../api/backend";

export function usePrivacyMode(notify: (message: string) => void) {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (active) setEnabled(settings.privacyMode);
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notify]);

  const updateEnabled = useCallback(async (nextEnabled: boolean) => {
    const previous = enabled;
    setEnabled(nextEnabled);
    setLoading(true);
    try {
      const settings = await updatePrivacyMode(nextEnabled);
      setEnabled(settings.privacyMode);
    } catch (error) {
      setEnabled(previous);
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [enabled, notify]);

  return { enabled, loading, setEnabled: updateEnabled };
}
