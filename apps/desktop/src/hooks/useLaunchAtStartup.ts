import { useCallback, useEffect, useState } from "react";
import { loadAppSettings, updateLaunchAtStartup } from "../api/backend";

export function useLaunchAtStartup(notify: (message: string) => void) {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (active) setEnabled(settings.launchAtStartup ?? true);
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
      const settings = await updateLaunchAtStartup(nextEnabled);
      setEnabled(settings.launchAtStartup ?? nextEnabled);
    } catch (error) {
      setEnabled(previous);
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [enabled, notify]);

  return { enabled, loading, setEnabled: updateEnabled };
}
