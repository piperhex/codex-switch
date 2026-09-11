import { useEffect, useRef, useState } from "react";
import type { Translate } from "../i18n";

const API_KEY_RANDOM_BYTES = 24;

interface ProxySettingsOptions {
  open: boolean;
  disabled: boolean;
  listenOnAllInterfaces: boolean;
  onSave: (enabled: boolean, apiKey?: string) => Promise<boolean>;
  onCopyApiKey: () => Promise<void>;
  notify: (message: string) => void;
  t: Translate;
}

export function useProxySettings(options: ProxySettingsOptions) {
  const { open, disabled, listenOnAllInterfaces, onSave, onCopyApiKey, notify, t } = options;
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const normalizedApiKey = apiKey.trim();

  useEffect(() => {
    if (open) setApiKey("");
  }, [open]);

  const save = async (enabled: boolean, key?: string) => {
    if (disabled || pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      if (await onSave(enabled, key)) setApiKey("");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const generateApiKey = () => {
    if (disabled || pending.current) return;
    const bytes = crypto.getRandomValues(new Uint8Array(API_KEY_RANDOM_BYTES));
    setApiKey(`cs_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
  };

  const copyApiKey = async () => {
    if (pending.current) return;
    if (!normalizedApiKey) {
      await onCopyApiKey();
      return;
    }
    try {
      await navigator.clipboard.writeText(normalizedApiKey);
      notify(t("providers.proxy.lanApiKeyCopied"));
    } catch {
      notify(t("providers.proxy.lanApiKeyCopyFailed"));
    }
  };

  return {
    apiKey,
    setApiKey,
    saving,
    normalizedApiKey,
    generateApiKey,
    copyApiKey,
    changeListening: (enabled: boolean) => save(enabled),
    saveApiKey: () => normalizedApiKey ? save(listenOnAllInterfaces, normalizedApiKey) : Promise.resolve(),
  };
}
