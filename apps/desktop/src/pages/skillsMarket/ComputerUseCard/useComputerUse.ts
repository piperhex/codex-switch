import { useCallback, useEffect, useRef, useState } from "react";
import { computerUseAction, computerUseStatus, type ComputerUseAction, type ComputerUseStatus }
  from "../../../api/computerUse";

const REFRESH_INTERVAL_MS = 5000;

export function useComputerUse(homeId: string, active: boolean) {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const changing = useRef(false);
  const revision = useRef(0);
  const actionError = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (loading.current || changing.current) return;
    loading.current = true;
    const started = revision.current;
    try {
      const result = await computerUseStatus(homeId);
      if (mounted.current && started === revision.current) {
        setStatus(result);
        if (!actionError.current) setError("");
      }
    } catch (caught) {
      if (mounted.current && started === revision.current && !actionError.current) setError(String(caught));
    } finally { loading.current = false; }
  }, [homeId]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => { clearInterval(timer); revision.current += 1; };
  }, [active, refresh]);

  const run = async (action: ComputerUseAction) => {
    if (changing.current) return false;
    changing.current = true;
    revision.current += 1;
    actionError.current = false;
    setBusy(true);
    setError("");
    try {
      const result = await computerUseAction(homeId, action);
      if (mounted.current) setStatus(result);
      return true;
    } catch (caught) {
      actionError.current = true;
      if (mounted.current) setError(String(caught));
      return false;
    } finally {
      changing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { status, error, busy, refresh, run };
}
