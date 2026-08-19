import { useState } from "react";
import { Alert } from "antd";
import { Sparkles } from "lucide-react";
import { DreamSkinAlerts } from "./dreamSkin/DreamSkinAlerts";
import { DreamSkinBrowser } from "./dreamSkin/DreamSkinBrowser";
import { DreamSkinDialogs } from "./dreamSkin/DreamSkinDialogs";
import { DreamSkinToolbar } from "./dreamSkin/DreamSkinToolbar";
import { useDreamSkinCatalog } from "./dreamSkin/useDreamSkinCatalog";
import { useImportSaveActions, useThemeActions } from "./dreamSkin/useDreamSkinActions";
import { useDreamSkinStatus } from "./dreamSkin/useDreamSkinStatus";
import type { DreamSkinPageProps, ThemeTab } from "./dreamSkin/types";

export function DreamSkinPage({ t, notify }: DreamSkinPageProps) {
  const [themeTab, setThemeTab] = useState<ThemeTab>("builtIn");
  const [builtInQuery, setBuiltInQuery] = useState("");
  const statusState = useDreamSkinStatus(t, notify);
  const catalog = useDreamSkinCatalog(themeTab);
  const sharedOptions = {
    confirmChatGptRestart: statusState.confirmChatGptRestart,
    runStatusOperation: statusState.runStatusOperation,
    setError: statusState.setError,
    status: statusState.status,
    t,
  };
  const importSave = useImportSaveActions(sharedOptions);
  const themeActions = useThemeActions({
    ...sharedOptions,
    refreshMarket: catalog.refreshMarket,
    setCommunityThemes: catalog.setCommunityThemes,
  });
  const { busy, error, loading, resources, status } = statusState;
  const isBusy = busy !== null;
  const resourcesReady = resources?.installed === true;
  const resourcePercent = resources?.totalBytes
    ? Math.min(100, Math.round(resources.downloadedBytes / resources.totalBytes * 100))
    : 0;

  if (loading && !status) {
    return <div className="dream-skin-loading"><Sparkles className="spin" size={24} />
      {t("dreamSkin.loading")}</div>;
  }
  if (status && !status.supported) {
    return <div className="dream-skin-page"><Alert showIcon type="warning"
      message={t("dreamSkin.unsupported.title")} description={t("dreamSkin.unsupported.description")} /></div>;
  }

  return <div className="dream-skin-page">
    <DreamSkinAlerts error={error} resources={resources} resourcePercent={resourcePercent}
      setError={statusState.setError} setResources={statusState.setResources} t={t} />
    <DreamSkinToolbar busy={busy} catalog={{
      builtInQuery,
      communityError: catalog.communityError,
      communityInitialized: catalog.communityInitialized,
      communityLoading: catalog.communityLoading,
      communityThemesLength: catalog.communityThemes.length,
      communityTotal: catalog.communityTotal,
      marketLoading: catalog.marketLoading,
      marketQuery: catalog.marketQuery,
      updatedAt: catalog.market?.updatedAt,
      refresh: catalog.refreshThemeMarket,
      setBuiltInQuery,
      setQuery: catalog.setMarketQuery,
    }} changeAppearance={themeActions.changeAppearance}
      changeOverlayOpacity={themeActions.changeOverlayOpacity}
      confirmChatGptRestart={statusState.confirmChatGptRestart} isBusy={isBusy} loading={loading}
      notify={notify} refresh={statusState.refresh} resourcesReady={resourcesReady}
      runStatusOperation={statusState.runStatusOperation} setBusy={statusState.setBusy}
      setError={statusState.setError} setSaveName={importSave.setSaveName}
      setSaveOpen={importSave.setSaveOpen} setThemeTab={setThemeTab} status={status} t={t} themeTab={themeTab} />
    <DreamSkinBrowser actions={themeActions} busy={busy} builtInQuery={builtInQuery} catalog={catalog}
      chooseCustomImage={importSave.chooseCustomImage} isBusy={isBusy} resourcesReady={resourcesReady}
      savedThemes={importSave.savedThemes} status={status} t={t} themeTab={themeTab} />
    <DreamSkinDialogs busy={busy} isBusy={isBusy} importDialog={{
      open: importSave.importOpen,
      options: importSave.importOptions,
      setOpen: importSave.setImportOpen,
      setOptions: importSave.setImportOptions,
      submit: importSave.submitImport,
    }} saveDialog={{
      name: importSave.saveName,
      open: importSave.saveOpen,
      setName: importSave.setSaveName,
      setOpen: importSave.setSaveOpen,
      submit: importSave.submitSave,
    }} t={t} />
  </div>;
}
