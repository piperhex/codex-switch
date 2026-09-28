import { useCallback, useEffect, useRef, useState } from "react";
import { remoteCommandAction, remoteCommandStatus, type RemoteCommandAction, type RemoteCommandStatus }
  from "../../../api/remoteCommand";

const REFRESH_INTERVAL_MS = 5000;

export function useRemoteCommand(homeId: string, active: boolean) {
  const [status, setStatus] = useState<RemoteCommandStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const changing = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const actionError = useRef(false);
  const pendingRefresh = useRef<(() => void) | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (loading.current || changing.current) return;
    loading.current = true;
    const started = revision.current;
    try {
      const result = await remoteCommandStatus(homeId);
      if (mounted.current && started === revision.current) {
        setStatus(result);
        if (!actionError.current) setError("");
      }
    } catch (caught) {
      if (mounted.current && started === revision.current && !actionError.current) setError(String(caught));
    } finally {
      loading.current = false;
      const pending = pendingRefresh.current;
      pendingRefresh.current = null;
      pending?.();
    }
  }, [homeId]);

  useEffect(() => {
    if (!active) return;
    if (loading.current) pendingRefresh.current = () => void refresh();
    else void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      pendingRefresh.current = null;
      revision.current += 1;
    };
  }, [active, refresh]);

  const run = async (action: RemoteCommandAction) => {
    if (changing.current) return;
    changing.current = true;
    revision.current += 1;
    actionError.current = false;
    setBusy(true);
    setError("");
    try {
      const result = await remoteCommandAction(homeId, action);
      if (mounted.current) setStatus(result);
    } catch (caught) {
      actionError.current = true;
      if (mounted.current) setError(String(caught));
    } finally {
      changing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { status, error, busy, refresh, run };
}
