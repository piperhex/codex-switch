import { useRef, useState } from "react";

interface ProxySettingsOptions {
  disabled: boolean;
  onSave: (enabled: boolean, apiKey?: string) => Promise<boolean>;
}

export function useProxySettings({ disabled, onSave }: ProxySettingsOptions) {
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const changeListening = async (enabled: boolean) => {
    if (disabled || pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await onSave(enabled);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return { saving, changeListening };
}
