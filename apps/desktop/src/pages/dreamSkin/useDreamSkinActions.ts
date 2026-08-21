import { useCallback, useMemo, useState } from "react";
import {
  applyDreamSkinTheme,
  chooseDreamSkinImage,
  deleteDreamSkinThemes,
  importDreamSkinImage,
  installDreamSkinCommunityTheme,
  installDreamSkinMarketTheme,
  saveDreamSkinTheme,
  setDreamSkinAppearance,
  setDreamSkinOverlayOpacity,
} from "../../api/backend";
import { BUILT_IN_DREAM_SKIN_IDS } from "../../dreamSkinBuiltIns";
import type { Translate } from "../../i18n";
import type {
  DreamSkinAppearance,
  DreamSkinCommunityTheme,
  DreamSkinImportOptions,
  DreamSkinMarketTheme,
  DreamSkinStatus,
} from "../../types";
import { DEFAULT_IMPORT_OPTIONS } from "./constants";
import type { CatalogState, ImportSaveActions, RunStatusOperation, StatusState, ThemeActions } from "./types";

type SharedOptions = Pick<StatusState, "confirmChatGptRestart" | "runStatusOperation" | "setError"> & {
  status: DreamSkinStatus | null;
  t: Translate;
};

export function useImportSaveActions(options: SharedOptions): ImportSaveActions {
  const importActions = useImportActions(options);
  const saveActions = useSaveActions(options);
  const savedThemes = useMemo(() => options.status?.savedThemes
    .filter((theme) => !BUILT_IN_DREAM_SKIN_IDS.has(theme.id)) ?? [], [options.status?.savedThemes]);
  return { ...importActions, ...saveActions, savedThemes };
}

function useImportActions(options: SharedOptions) {
  const { confirmChatGptRestart, runStatusOperation, setError, status, t } = options;
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importOptions, setImportOptions] = useState<DreamSkinImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const chooseCustomImage = useCallback(async () => {
    setError(null);
    try {
      const result = await chooseDreamSkinImage();
      if (result.status === "cancelled") return;
      const path = result.status === "selected" ? result.path : "preview-dream-skin.jpg";
      const fileName = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "")?.trim();
      setImportPath(path);
      setImportOptions({ ...DEFAULT_IMPORT_OPTIONS, name: fileName || t("dreamSkin.import.defaultName") });
      setImportOpen(true);
    } catch (chooseError) {
      setError(String(chooseError));
    }
  }, [setError, t]);

  const submitImport = useCallback(async () => {
    if (!importPath || !importOptions.name.trim()) return;
    const operation = async () => {
      const ok = await runStatusOperation(
        "import",
        () => importDreamSkinImage(importPath, { ...importOptions, name: importOptions.name.trim() }),
        t("dreamSkin.toast.imported"),
      );
      if (ok) setImportOpen(false);
    };
    if (status?.installed) await operation();
    else confirmChatGptRestart(operation);
  }, [confirmChatGptRestart, importOptions, importPath, runStatusOperation, status?.installed, t]);

  return { chooseCustomImage, importOpen, importOptions, setImportOpen, setImportOptions, submitImport };
}

function useSaveActions(options: SharedOptions) {
  const { runStatusOperation, t } = options;
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const submitSave = useCallback(async () => {
    if (!saveName.trim()) return;
    const ok = await runStatusOperation(
      "save",
      () => saveDreamSkinTheme(saveName.trim()),
      t("dreamSkin.toast.saved"),
    );
    if (!ok) return;
    setSaveOpen(false);
    setSaveName("");
  }, [runStatusOperation, saveName, t]);
  return { saveName, saveOpen, setSaveName, setSaveOpen, submitSave };
}

type ThemeOptions = SharedOptions & Pick<CatalogState, "refreshMarket" | "setCommunityThemes">;

function runInstalledOperation(
  installed: boolean | undefined,
  operation: () => Promise<unknown>,
  confirmChatGptRestart: (operation: () => Promise<unknown>) => void,
) {
  if (installed) void operation();
  else confirmChatGptRestart(operation);
}

function marketSuccessMessage(theme: DreamSkinMarketTheme | DreamSkinCommunityTheme, t: Translate) {
  return t(theme.updateAvailable ? "dreamSkin.market.toast.updated" : "dreamSkin.market.toast.installed");
}

export function useThemeActions(options: ThemeOptions): ThemeActions {
  const { confirmChatGptRestart, refreshMarket, runStatusOperation, setCommunityThemes, status, t } = options;
  const applyTheme = useCallback((themeId: string) => {
    const operation = () => runStatusOperation(
      `apply:${themeId}`,
      () => applyDreamSkinTheme(themeId),
      t("dreamSkin.toast.applied"),
    );
    runInstalledOperation(status?.installed, operation, confirmChatGptRestart);
  }, [confirmChatGptRestart, runStatusOperation, status?.installed, t]);

  const changeAppearance = useCallback((appearance: DreamSkinAppearance) => {
    void runStatusOperation(
      "appearance",
      () => setDreamSkinAppearance(appearance),
      t("dreamSkin.toast.appearanceChanged"),
    );
  }, [runStatusOperation, t]);

  const changeOverlayOpacity = useCallback((opacity: number) => {
    void runStatusOperation(
      "overlayOpacity",
      () => setDreamSkinOverlayOpacity(opacity),
      t("dreamSkin.toast.overlayOpacityChanged"),
    );
  }, [runStatusOperation, t]);

  const deleteSavedThemes = useCallback(async (themeIds: string[]) => {
    const deleted = await runStatusOperation(
      "deleteThemes",
      () => deleteDreamSkinThemes(themeIds),
      t("dreamSkin.saved.toast.deleted", { count: themeIds.length }),
    );
    if (!deleted) return false;
    const deletedIds = new Set(themeIds);
    void refreshMarket();
    setCommunityThemes((current) => current.map((theme) => deletedIds.has(theme.themeId)
      ? { ...theme, installed: false, installedVersion: null, updateAvailable: false }
      : theme));
    return true;
  }, [refreshMarket, runStatusOperation, setCommunityThemes, t]);

  const installAndApplyMarketTheme = useCallback((theme: DreamSkinMarketTheme) => {
    if (theme.installed && !theme.updateAvailable) return applyTheme(theme.id);
    const operation = async () => runStatusOperation(
      `market:${theme.id}`,
      async () => {
        await installDreamSkinMarketTheme(theme.id);
        const next = await applyDreamSkinTheme(theme.id);
        void refreshMarket();
        return next;
      },
      marketSuccessMessage(theme, t),
    );
    runInstalledOperation(status?.installed, operation, confirmChatGptRestart);
  }, [applyTheme, confirmChatGptRestart, refreshMarket, runStatusOperation, status?.installed, t]);

  const installAndApplyCommunityTheme = useCallback((theme: DreamSkinCommunityTheme) => {
    if (theme.installed && !theme.updateAvailable) return applyTheme(theme.themeId);
    const operation = async () => runStatusOperation(
      `community:${theme.id}`,
      async () => {
        await installDreamSkinCommunityTheme(theme.id);
        const next = await applyDreamSkinTheme(theme.themeId);
        setCommunityThemes((current) => current.map((item) => item.themeId === theme.themeId
          ? { ...item, installed: true, installedVersion: item.version, updateAvailable: false }
          : item));
        return next;
      },
      marketSuccessMessage(theme, t),
    );
    runInstalledOperation(status?.installed, operation, confirmChatGptRestart);
  }, [applyTheme, confirmChatGptRestart, runStatusOperation, setCommunityThemes, status?.installed, t]);

  return {
    applyTheme,
    changeAppearance,
    changeOverlayOpacity,
    deleteSavedThemes,
    installAndApplyCommunityTheme,
    installAndApplyMarketTheme,
  };
}
