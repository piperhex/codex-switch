import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelCcSwitchProviderImport,
  confirmCcSwitchProviderImport,
  subscribeToCcSwitchImportRequests,
  takeCcSwitchImportRequest,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { CcSwitchImportRequest, Provider } from "../types";

interface CcSwitchImportOptions {
  notify: (message: string) => void;
  onImported: (provider: Provider) => void;
  t: Translate;
}

export function useCcSwitchImport({ notify, onImported, t }: CcSwitchImportOptions) {
  const [request, setRequest] = useState<CcSwitchImportRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const requestRef = useRef<CcSwitchImportRequest | null>(null);
  const loadingRef = useRef(false);
  const activeRef = useRef(true);

  const loadPending = useCallback(async () => {
    if (loadingRef.current || requestRef.current) return;
    loadingRef.current = true;
    try {
      const pending = await takeCcSwitchImportRequest();
      if (!activeRef.current || !pending) return;
      requestRef.current = pending;
      setRequest(pending);
    } catch {
      notify(t("providers.import.loadFailed"));
    } finally {
      loadingRef.current = false;
    }
  }, [notify, t]);

  useEffect(() => {
    activeRef.current = true;
    let effectActive = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToCcSwitchImportRequests(() => void loadPending()).then((stopListening) => {
      if (!effectActive) return stopListening();
      unsubscribe = stopListening;
      void loadPending();
    });
    return () => {
      effectActive = false;
      activeRef.current = false;
      unsubscribe?.();
    };
  }, [loadPending]);

  const clearAndLoadNext = useCallback(() => {
    requestRef.current = null;
    setRequest(null);
    window.setTimeout(() => void loadPending(), 0);
  }, [loadPending]);

  const cancel = useCallback(async () => {
    if (!request || saving) return;
    setSaving(true);
    try {
      await cancelCcSwitchProviderImport(request.requestId);
      clearAndLoadNext();
    } catch {
      notify(t("providers.import.cancelFailed"));
    } finally {
      setSaving(false);
    }
  }, [clearAndLoadNext, notify, request, saving, t]);

  const confirm = useCallback(async (name: string) => {
    if (!request || saving || !name.trim()) return;
    setSaving(true);
    try {
      const provider = await confirmCcSwitchProviderImport(request.requestId, name.trim());
      clearAndLoadNext();
      onImported(provider);
    } catch {
      notify(t("providers.import.failed"));
    } finally {
      setSaving(false);
    }
  }, [clearAndLoadNext, notify, onImported, request, saving, t]);

  return { cancel, confirm, request, saving };
}
