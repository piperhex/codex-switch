import { useState } from "react";
import styles from "./index.module.less";
import { Button, Input, Popconfirm, Popover, Segmented, Tabs, Tooltip } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CirclePause,
  CirclePlay,
  Eye,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
} from "lucide-react";
import {
  installDreamSkin,
  openDreamSkinFolder,
  reapplyDreamSkin,
  restoreDreamSkin,
  setDreamSkinPaused,
  verifyDreamSkin,
} from "../../../api/backend";
import type { Translate } from "../../../i18n";
import type { DreamSkinAppearance, DreamSkinStatus } from "../../../types";
import { APPEARANCE_OPTIONS } from "../constants";
import { DreamSkinOverlaySlider } from "../DreamSkinOverlaySlider";
import type { RunStatusOperation, SavedThemeLibrary, ThemeTab } from "../types";

type Props = {
  busy: string | null;
  catalog: {
    builtInQuery: string;
    communityError: string | null;
    communityInitialized: boolean;
    communityLoading: boolean;
    communityThemesLength: number;
    communityTotal: number | null;
    marketLoading: boolean;
    marketQuery: string;
    updatedAt?: string;
    refresh: () => void;
    setBuiltInQuery: (query: string) => void;
    setQuery: (query: string) => void;
  };
  changeAppearance: (appearance: DreamSkinAppearance) => void;
  changeOverlayOpacity: (opacity: number) => void;
  confirmChatGptRestart: (operation: () => Promise<unknown>) => void;
  isBusy: boolean;
  loading: boolean;
  notify: (message: string) => void;
  refresh: () => Promise<void>;
  resourcesReady: boolean;
  runStatusOperation: RunStatusOperation;
  savedLibrary: SavedThemeLibrary;
  setBusy: (busy: string | null) => void;
  setError: (error: string | null) => void;
  setSaveName: (name: string) => void;
  setSaveOpen: (open: boolean) => void;
  setThemeTab: (tab: ThemeTab) => void;
  status: DreamSkinStatus | null;
  t: Translate;
  themeTab: ThemeTab;
};

export function DreamSkinToolbar(props: Props) {
  const { busy, catalog, changeAppearance, changeOverlayOpacity, confirmChatGptRestart, isBusy } = props;
  const { loading, notify } = props;
  const { refresh, resourcesReady, runStatusOperation, setBusy, setError, setSaveName, setSaveOpen } = props;
  const { setThemeTab, status, t, themeTab } = props;
  const [toolsOpen, setToolsOpen] = useState(false);
  const sessionLabel = status ? t(`dreamSkin.session.${status.session}`) : t("dreamSkin.session.loading");
  const activeThemeName = status?.activeThemeName || t("dreamSkin.noActiveTheme");
  const tools = { ...props, setToolsOpen, toolsOpen };
  return <div className={styles.stickyStack}>
    <section className={styles.hero}>
      <div className={styles.console}>
        <strong className={`${styles.session} ${styles.sessionPill} ${styles["session-" + (status?.session ?? "ready")]}`}>
          <i />{sessionLabel}
        </strong>
        <div className={styles.toolbarTheme}>
          <span>{t("dreamSkin.activeTheme")}</span><b title={activeThemeName}>{activeThemeName}</b>
        </div>
        <div className={styles.toolbarAppearance}>
          <span>{t("dreamSkin.import.appearance")}</span>
          <Segmented block size="small" value={status?.activeThemeAppearance ?? "auto"}
            disabled={!status?.installed || !status.activeThemeId || isBusy}
            options={APPEARANCE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            onChange={(appearance) => changeAppearance(appearance as DreamSkinAppearance)} />
        </div>
        <DreamSkinOverlaySlider disabled={!status?.installed || !status?.activeThemeId || isBusy}
          opacity={status?.activeThemeOverlayOpacity} onChange={changeOverlayOpacity} t={t} />
        <div className={styles.toolbarSpacer} />
        <div className={styles.toolbarActions}>
          <Button type={status?.installed ? "default" : "primary"} icon={<Sparkles size={14} />}
            loading={busy === "install"}
            disabled={(isBusy && busy !== "install") || (!resourcesReady && !status?.activeThemeId)}
            onClick={() => confirmChatGptRestart(() => runStatusOperation(
              "install", installDreamSkin, t("dreamSkin.toast.installed"),
            ))}>
            {status?.installed ? t("dreamSkin.updateRuntime") : t("dreamSkin.install")}
          </Button>
          <Tooltip title={t("dreamSkin.refresh")}><Button aria-label={t("dreamSkin.refresh")}
            icon={<RefreshCw className={loading ? "spin" : ""} size={15} />} disabled={isBusy}
            onClick={() => void refresh()} /></Tooltip>
          <ToolsPopover {...tools} />
        </div>
      </div>
    </section>
    <BrowserHeader catalog={catalog} savedLibrary={props.savedLibrary} setThemeTab={setThemeTab}
      t={t} themeTab={themeTab} busy={busy} />
  </div>;
}

type ToolsProps = Props & { toolsOpen: boolean; setToolsOpen: (open: boolean) => void };

function ToolsPopover(props: ToolsProps) {
  const { busy, confirmChatGptRestart, isBusy, notify, runStatusOperation, setBusy } = props;
  const { setError, setSaveName, setSaveOpen, setToolsOpen, status, t, toolsOpen } = props;
  const closeAndRun = (operation: () => void) => { setToolsOpen(false); operation(); };
  return <Popover trigger="click" placement="bottomRight" open={toolsOpen} onOpenChange={setToolsOpen}
    content={<div className={styles.toolsMorePanel}>
      <Button type="text" icon={status?.session === "paused"
        ? <CirclePlay size={15} /> : <CirclePause size={15} />}
        disabled={!status?.installed || isBusy} loading={busy === "pause"} onClick={() => closeAndRun(() => {
          const operation = () => runStatusOperation(
            "pause",
            () => setDreamSkinPaused(status?.session !== "paused"),
            status?.session === "paused" ? t("dreamSkin.toast.resumed") : t("dreamSkin.toast.paused"),
          );
          if (status?.session === "paused") confirmChatGptRestart(operation);
          else void operation();
        })}>{status?.session === "paused" ? t("dreamSkin.resume") : t("dreamSkin.pause")}</Button>
      <Button type="text" icon={<RefreshCw size={15} />} disabled={!status?.installed || isBusy}
        loading={busy === "reapply"} onClick={() => closeAndRun(() => confirmChatGptRestart(
          () => runStatusOperation("reapply", reapplyDreamSkin, t("dreamSkin.toast.reapplied")),
        ))}>{t("dreamSkin.reapply")}</Button>
      <Button type="text" icon={<Save size={15} />} disabled={!status?.installed || !status.activeThemeId || isBusy}
        onClick={() => closeAndRun(() => {
          setSaveName(status?.activeThemeName ?? "");
          setSaveOpen(true);
        })}>{t("dreamSkin.saveCurrent")}</Button>
      <Button type="text" icon={<ShieldCheck size={15} />} disabled={!status?.installed || isBusy}
        loading={busy === "verify"} onClick={() => closeAndRun(() => {
          setBusy("verify");
          setError(null);
          void verifyDreamSkin().then(() => notify(t("dreamSkin.toast.verified")))
            .catch((error) => setError(String(error))).finally(() => setBusy(null));
        })}>{t("dreamSkin.verify")}</Button>
      <Button type="text" icon={<FolderOpen size={15} />} disabled={isBusy}
        onClick={() => closeAndRun(() => {
          void openDreamSkinFolder().catch((error) => setError(String(error)));
        })}>{t("dreamSkin.openFolder")}</Button>
      <Popconfirm title={t("dreamSkin.restore.confirmTitle")} description={t("dreamSkin.restore.confirmDescription")}
        okText={t("dreamSkin.restore")} cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
        onConfirm={() => closeAndRun(() => {
          void runStatusOperation("restore", restoreDreamSkin, t("dreamSkin.toast.restored"));
        })}>
        <Button block type="text" danger icon={<RotateCcw size={15} />}
          disabled={!status?.runtimeInstalled || isBusy} loading={busy === "restore"}>
          {t("dreamSkin.restore")}
        </Button>
      </Popconfirm>
    </div>}>
    <Button icon={<MoreHorizontal size={15} />}>{t("table.moreActions")}</Button>
  </Popover>;
}

function BrowserHeader(props: Pick<Props, "busy" | "catalog" | "savedLibrary" | "setThemeTab" | "t" | "themeTab">) {
  const { busy, catalog, savedLibrary, setThemeTab, t, themeTab } = props;
  const builtInActions = <div className={styles.marketTabActions}>
    <Input className={styles.marketSearch} allowClear value={catalog.builtInQuery} prefix={<Search size={14} />}
      placeholder={t("dreamSkin.presets.search")} onChange={(event) => catalog.setBuiltInQuery(event.target.value)} />
  </div>;
  const marketActions = <div className={styles.marketTabActions}>
    <Input className={styles.marketSearch} allowClear value={catalog.marketQuery} prefix={<Search size={14} />}
      placeholder={t("dreamSkin.market.search")} onChange={(event) => catalog.setQuery(event.target.value)} />
    <Button icon={<RefreshCw className={catalog.marketLoading || catalog.communityLoading ? "spin" : ""}
      size={14} />} loading={catalog.marketLoading || catalog.communityLoading} onClick={catalog.refresh}>
      {t("dreamSkin.market.refresh")}
    </Button>
    <Button icon={<Eye size={14} />} onClick={() => void openUrl("https://dreamskin.cc/gallery")}>
      {t("dreamSkin.market.gallery")}
    </Button>
  </div>;
  const selectedCount = savedLibrary.selectedThemeIds.length;
  const savedActions = <div className={styles.marketTabActions}>
    <Popconfirm title={t("dreamSkin.saved.delete.confirmTitle", { count: selectedCount })}
      description={t("dreamSkin.saved.delete.confirmDescription")} okText={t("dreamSkin.saved.delete.action")}
      cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
      onConfirm={savedLibrary.deleteSelectedThemes}>
      <Button danger icon={<Trash2 size={14} />} disabled={selectedCount === 0}
        loading={busy === "deleteThemes"}>
        {t("dreamSkin.saved.delete.selected", { count: selectedCount })}
      </Button>
    </Popconfirm>
    <Input className={styles.marketSearch} allowClear value={savedLibrary.query} prefix={<Search size={14} />}
      placeholder={t("dreamSkin.saved.search")} onChange={(event) => savedLibrary.setQuery(event.target.value)} />
  </div>;
  return <div className={styles.themeBrowserHeader}>
    <Tabs activeKey={themeTab} onChange={(key) => setThemeTab(key as ThemeTab)}
      tabBarExtraContent={themeTab === "builtIn" ? builtInActions
        : themeTab === "market" ? marketActions : savedActions}
      items={tabItems(t)} />
    <TabSummary catalog={catalog} t={t} themeTab={themeTab} />
  </div>;
}

function tabItems(t: Translate) {
  return [
    { key: "builtIn", label: <span className={styles.themeTabLabel}><Sparkles size={15} />
      {t("dreamSkin.tabs.builtIn")}</span> },
    { key: "market", label: <span className={styles.themeTabLabel}><Store size={15} />
      {t("dreamSkin.tabs.market")}</span> },
    { key: "saved", label: <span className={styles.themeTabLabel}><Save size={15} />
      {t("dreamSkin.tabs.savedCommunity")}</span> },
  ];
}

function TabSummary({ catalog, t, themeTab }: Pick<Props, "catalog" | "t" | "themeTab">) {
  if (themeTab === "builtIn") return <div className={styles.tabSummary}>{t("dreamSkin.presets.description")}</div>;
  if (themeTab === "saved") return <div className={styles.tabSummary}>{t("dreamSkin.saved.subtitle")}</div>;
  if (!catalog.updatedAt && !catalog.communityInitialized) return null;
  return <div className={`${styles.tabSummary} ${styles.marketSummary}`}>
    {catalog.updatedAt && <span>{t("dreamSkin.market.updatedAt", { date: catalog.updatedAt })}</span>}
    {catalog.communityInitialized && (!catalog.communityError || catalog.communityThemesLength > 0)
      && <span>{t("dreamSkin.market.loadedCount", {
        loaded: catalog.communityThemesLength,
        total: catalog.communityTotal ?? catalog.communityThemesLength,
      })}</span>}
  </div>;
}
