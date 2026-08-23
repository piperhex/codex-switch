import { useCallback, useEffect, useState } from "react";
import {
  launchClaudeCode,
  loadAppSettings,
  restartClaudeCode,
  updateThirdPartyAppWriteSettings,
} from "../api/backend";
import type { Translate } from "../i18n";
import type {
  ClaudeSubagentModel,
  ThirdPartyAppId,
  ThirdPartyAppWriteSettings,
} from "../types";
import {
  defaultThirdPartyAppWriteSettings,
  normalizeThirdPartyAppWriteSettings,
} from "../utils/thirdPartyApps";

export function useThirdPartyAppIntegration(
  notify: (message: string) => void,
  t: Translate,
) {
  const [settings, setSettings] = useState(defaultThirdPartyAppWriteSettings);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<"launch" | "restart" | null>(null);

  useEffect(() => {
    void loadAppSettings()
      .then((loaded) => setSettings(normalizeThirdPartyAppWriteSettings(
        loaded.thirdPartyAppWrite,
        loaded.claudeCodeWriteTarget,
      )))
      .catch((error) => notify(String(error)));
  }, [notify]);

  const save = useCallback(async (nextSettings: ThirdPartyAppWriteSettings) => {
    setSaving(true);
    try {
      const updated = await updateThirdPartyAppWriteSettings(nextSettings);
      setSettings(normalizeThirdPartyAppWriteSettings(
        updated.thirdPartyAppWrite ?? nextSettings,
        updated.claudeCodeWriteTarget,
      ));
      notify(t("toast.thirdPartyAppWriteSaved"));
    } catch (error) {
      notify(String(error));
    } finally {
      setSaving(false);
    }
  }, [notify, t]);

  const changeEnabled = useCallback((enabled: boolean) => (
    save({ ...settings, enabled })
  ), [save, settings]);

  const changeWriteCodex = useCallback((writeCodex: boolean) => (
    save({ ...settings, writeCodex })
  ), [save, settings]);

  const changeApp = useCallback((appId: ThirdPartyAppId, enabled: boolean) => (
    save({ ...settings, apps: { ...settings.apps, [appId]: enabled } })
  ), [save, settings]);

  const changeSubagentModel = useCallback((claudeSubagentModel: ClaudeSubagentModel) => (
    save({ ...settings, claudeSubagentModel })
  ), [save, settings]);

  const launch = useCallback(async () => {
    setBusy("launch");
    try {
      const launched = await launchClaudeCode();
      notify(launched ? t("toast.claudeCodeLaunched") : t("toast.claudeCodeAlreadyRunning"));
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(null);
    }
  }, [notify, t]);

  const restart = useCallback(async () => {
    setBusy("restart");
    try {
      await restartClaudeCode();
      notify(t("toast.claudeCodeRestarted"));
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(null);
    }
  }, [notify, t]);

  return {
    busy,
    changeApp,
    changeEnabled,
    changeSubagentModel,
    changeWriteCodex,
    launch,
    restart,
    saving,
    settings,
  };
}
