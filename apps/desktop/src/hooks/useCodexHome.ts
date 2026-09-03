import { useCallback, useEffect, useState } from "react";
import {
  chooseCodexHome,
  isDesktopApp,
  loadAppSettings,
  loadCodexHomePresets,
  updateCodexHomes,
} from "../api/backend";
import type { Translate } from "../i18n";
import type { CodexHomeEntry, CodexHomePreset } from "../types";

interface CodexHomeOptions {
  cloudBaseUrl: string;
  currentPath?: string;
  notify: (message: string) => void;
  reload: () => Promise<void>;
  t: Translate;
}

function entryId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `codex-home-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useCodexHome(options: CodexHomeOptions) {
  const { cloudBaseUrl, currentPath, notify, reload, t } = options;
  const [homes, setHomes] = useState<CodexHomeEntry[]>([]);
  const [presets, setPresets] = useState<CodexHomePreset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadAppSettings(),
      loadCodexHomePresets(cloudBaseUrl).catch(() => []),
    ]).then(([settings, availablePresets]) => {
      if (!active) return;
      setHomes(settings.codexHomes ?? []);
      setPresets(availablePresets);
    }).catch((error) => notify(String(error))).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [cloudBaseUrl, notify]);

  const save = useCallback(async (nextHomes: CodexHomeEntry[]) => {
    setLoading(true);
    try {
      const settings = await updateCodexHomes(nextHomes);
      setHomes(settings.codexHomes ?? []);
      await reload();
      notify(t("toast.codexHomesUpdated"));
      return true;
    } catch (error) {
      notify(String(error));
      return false;
    } finally {
      setLoading(false);
    }
  }, [notify, reload, t]);

  const addEmpty = useCallback(() => {
    setHomes((items) => items.some((home) => !home.path.trim())
      ? items
      : [...items, { id: entryId(), path: "", enabled: false }]);
  }, []);

  const addPath = useCallback(async (path: string) => {
    if (homes.some((home) => home.path.trim() === path.trim())) {
      notify(t("toast.codexHomeDuplicate"));
      return;
    }
    const blank = homes.find((home) => !home.path.trim());
    const next = blank
      ? homes.map((home) => home.id === blank.id ? { ...home, path } : home)
      : [...homes, { id: entryId(), path, enabled: false }];
    await save(next);
  }, [homes, notify, save, t]);

  const chooseNew = useCallback(async () => {
    if (!isDesktopApp) return notify(t("toast.previewChooseFolder"));
    const selected = await chooseCodexHome(currentPath);
    if (selected) await addPath(selected);
  }, [addPath, currentPath, notify, t]);

  const changePath = useCallback((id: string, path: string) => {
    setHomes((items) => items.map((home) => home.id === id ? { ...home, path } : home));
  }, []);

  const commitPath = useCallback(async (id: string) => {
    const entry = homes.find((home) => home.id === id);
    if (!entry?.path.trim()) return;
    await save(homes);
  }, [homes, save]);

  const chooseFor = useCallback(async (id: string) => {
    if (!isDesktopApp) return notify(t("toast.previewChooseFolder"));
    const entry = homes.find((home) => home.id === id);
    const selected = await chooseCodexHome(entry?.path || currentPath);
    if (!selected) return;
    const next = homes.map((home) => home.id === id ? { ...home, path: selected } : home);
    await save(next);
  }, [currentPath, homes, notify, save, t]);

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    const next = homes.map((home) => home.id === id ? { ...home, enabled } : home);
    await save(next);
  }, [homes, save]);

  const remove = useCallback(async (id: string) => {
    const next = homes.filter((home) => home.id !== id && home.path.trim());
    await save(next);
  }, [homes, save]);

  return {
    addEmpty,
    addPath,
    changePath,
    chooseFor,
    chooseNew,
    commitPath,
    homes,
    loading,
    presets,
    remove,
    setEnabled,
  };
}
