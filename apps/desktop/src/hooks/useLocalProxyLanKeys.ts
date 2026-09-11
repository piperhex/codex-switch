import { useCallback, useEffect, useRef, useState } from "react";
import { copyLocalProxyLanApiKey, deleteLocalProxyLanApiKey, loadLocalProxyLanApiKeys,
  saveLocalProxyLanApiKey } from "../api/localProxyLanKeys";
import type { Translate, TranslationKey } from "../i18n";
import type { LocalProxyLanApiKey, LocalProxyLanApiKeyInput } from "../types";

const USAGE_REFRESH_INTERVAL_MS = 5_000;

interface LocalProxyLanKeysOptions {
  open: boolean;
  notify: (message: string) => void;
  t: Translate;
}

export function useLocalProxyLanKeys({ open, notify, t }: LocalProxyLanKeysOptions) {
  const [keys, setKeys] = useState<LocalProxyLanApiKey[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const active = useRef(open);
  const polling = useRef(false);
  const pending = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (polling.current || pending.current || !active.current) return;
    polling.current = true;
    const currentRevision = revision.current;
    try {
      const result = await loadLocalProxyLanApiKeys();
      if (mounted.current && active.current && currentRevision === revision.current) {
        setKeys(result);
        setFailed(false);
      }
    } catch {
      if (mounted.current && active.current && currentRevision === revision.current) setFailed(true);
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    active.current = open;
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), USAGE_REFRESH_INTERVAL_MS);
    return () => {
      active.current = false;
      revision.current += 1;
      window.clearInterval(timer);
    };
  }, [open, refresh]);

  const mutate = async (operation: () => Promise<LocalProxyLanApiKey[]>, message: TranslationKey) => {
    if (pending.current) return false;
    pending.current = true;
    revision.current += 1;
    setSaving(true);
    try {
      const result = await operation();
      if (mounted.current) {
        setKeys(result);
        setFailed(false);
        notify(t(message));
      }
      return true;
    } catch {
      if (mounted.current) notify(t("providers.proxy.lanKeysSaveFailed"));
      return false;
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const copy = async (id: string) => {
    try {
      await copyLocalProxyLanApiKey(id);
      notify(t("providers.proxy.lanApiKeyCopied"));
    } catch {
      notify(t("providers.proxy.lanApiKeyCopyFailed"));
    }
  };

  return { keys, failed, saving, refresh, copy,
    save: (key: LocalProxyLanApiKeyInput) => mutate(() => saveLocalProxyLanApiKey(key), "providers.proxy.lanKeySaved"),
    remove: (id: string) => mutate(() => deleteLocalProxyLanApiKey(id), "providers.proxy.lanKeyDeleted"),
  };
}
