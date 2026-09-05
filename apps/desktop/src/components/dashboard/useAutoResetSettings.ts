import { useEffect, useRef, useState } from "react";
import { loadAccounts, loadAppSettings, loadAutoResetSettings, saveAutoResetSettings } from "../../api/backend";
import type { Account, AutoResetSettings } from "../../types";

export function useAutoResetSettings(onClose: () => void) {
  const [settings, setSettings] = useState<AutoResetSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [privacyMode, setPrivacyMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"load" | "save" | null>(null);
  const [reload, setReload] = useState(0);
  const savingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([loadAutoResetSettings(), loadAccounts(), loadAppSettings()])
      .then(([policy, loadedAccounts, appSettings]) => {
        if (!active) return;
        setSettings(policy);
        setPrivacyMode(appSettings.privacyMode);
        setAccounts(loadedAccounts.filter((account) => !account.agentIdentity && account.localProxyCompatible));
      }).catch(() => { if (active) setError("load"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const save = async () => {
    if (!settings || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await saveAutoResetSettings(settings);
      if (mounted.current) onClose();
    } catch {
      if (mounted.current) setError("save");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return {
    settings, setSettings, accounts, privacyMode, loading, saving, error, save,
    retry: () => setReload((value) => value + 1),
  };
}
