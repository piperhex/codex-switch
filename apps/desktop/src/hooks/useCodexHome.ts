import { useCallback, useEffect, useState } from "react";
import {
  chooseCodexHome,
  isDesktopApp,
  loadAppSettings,
  updateCodexHome,
} from "../api/backend";
import type { Translate } from "../i18n";

interface CodexHomeOptions {
  currentPath?: string;
  localProxyRunning: boolean;
  notify: (message: string) => void;
  reload: () => Promise<void>;
  t: Translate;
}

export function useCodexHome(options: CodexHomeOptions) {
  const { currentPath, localProxyRunning, notify, reload, t } = options;
  const [customPath, setCustomPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (active) setCustomPath(settings.codexHome?.trim() || null);
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notify]);

  const save = useCallback(async (path: string | null) => {
    if (localProxyRunning) {
      notify(t("toast.codexHomeProxyRunning"));
      return;
    }
    setLoading(true);
    try {
      const settings = await updateCodexHome(path);
      setCustomPath(settings.codexHome?.trim() || null);
      await reload();
      notify(t(path ? "toast.codexHomeUpdated" : "toast.codexHomeReset"));
    } catch (error) {
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [localProxyRunning, notify, reload, t]);

  const change = useCallback(async () => {
    if (!isDesktopApp) {
      notify(t("toast.previewChooseFolder"));
      return;
    }
    if (localProxyRunning) {
      notify(t("toast.codexHomeProxyRunning"));
      return;
    }
    try {
      const selected = await chooseCodexHome(currentPath);
      if (selected) await save(selected);
    } catch (error) {
      notify(String(error));
    }
  }, [currentPath, localProxyRunning, notify, save, t]);

  const reset = useCallback(() => {
    if (!isDesktopApp) {
      notify(t("toast.previewChooseFolder"));
      return;
    }
    void save(null);
  }, [notify, save, t]);

  return {
    change,
    customized: Boolean(customPath),
    loading,
    reset,
  };
}
