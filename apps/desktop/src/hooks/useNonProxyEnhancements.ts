import { useEffect, useState } from "react";
import { loadAppSettings, updateNonProxyEnhancements } from "../api/backend";

export function useNonProxyEnhancements() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"load" | "save" | null>(null);

  useEffect(() => {
    let active = true;
    void loadAppSettings().then((settings) => {
      if (active) setEnabled(settings.nonProxyEnhancementsEnabled ?? true);
    }).catch(() => {
      if (active) setError("load");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const update = async (next: boolean) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const settings = await updateNonProxyEnhancements(next);
      setEnabled(settings.nonProxyEnhancementsEnabled ?? next);
    } catch {
      setError("save");
    } finally {
      setLoading(false);
    }
  };

  return { enabled, loading, error, update };
}
