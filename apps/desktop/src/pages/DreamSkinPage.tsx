import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, InputNumber, Modal, Popconfirm, Progress, Segmented, Select, Tabs, Tooltip } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  CirclePause,
  CirclePlay,
  CloudDownload,
  Eye,
  FolderOpen,
  Github,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  WandSparkles,
} from "lucide-react";
import {
  applyDreamSkinTheme,
  chooseDreamSkinImage,
  importDreamSkinImage,
  installDreamSkinCommunityTheme,
  installDreamSkinMarketTheme,
  installDreamSkin,
  loadDreamSkinMarket,
  loadDreamSkinCommunityPage,
  loadDreamSkinResourcesStatus,
  loadDreamSkinStatus,
  loadDreamSkinThemePreview,
  openDreamSkinFolder,
  reapplyDreamSkin,
  restoreDreamSkin,
  retryDreamSkinResources,
  saveDreamSkinTheme,
  setDreamSkinAppearance,
  setDreamSkinPaused,
  verifyDreamSkin,
} from "../api/backend";
import { BUILT_IN_DREAM_SKIN_IDS, BUILT_IN_DREAM_SKIN_THEMES } from "../dreamSkinBuiltIns";
import type { Translate } from "../i18n";
import type {
  DreamSkinAppearance,
  DreamSkinCommunityTheme,
  DreamSkinImportOptions,
  DreamSkinMarketResult,
  DreamSkinMarketTheme,
  DreamSkinResourcesStatus,
  DreamSkinStatus,
  DreamSkinThemeSummary,
} from "../types";

const APPEARANCE_OPTIONS = [
  { value: "auto", labelKey: "dreamSkin.option.auto" },
  { value: "light", labelKey: "dreamSkin.option.light" },
  { value: "dark", labelKey: "dreamSkin.option.dark" },
] as const;
const SAFE_AREA_OPTIONS = [
  { value: "auto", labelKey: "dreamSkin.option.auto" },
  { value: "left", labelKey: "dreamSkin.option.left" },
  { value: "right", labelKey: "dreamSkin.option.right" },
  { value: "center", labelKey: "dreamSkin.option.center" },
  { value: "none", labelKey: "dreamSkin.option.none" },
] as const;
const TASK_MODE_OPTIONS = [
  { value: "auto", labelKey: "dreamSkin.option.auto" },
  { value: "ambient", labelKey: "dreamSkin.option.ambient" },
  { value: "banner", labelKey: "dreamSkin.option.banner" },
  { value: "off", labelKey: "dreamSkin.option.off" },
] as const;

const COMMUNITY_PAGE_SIZE = 48;
const COMMUNITY_CATALOG_LIMIT = 500;

type DreamSkinPageProps = {
  t: Translate;
  notify: (message: string) => void;
};

type ThemeCardProps = {
  active: boolean;
  busy: boolean;
  description: string;
  disabled?: boolean;
  id: string;
  name: string;
  preview?: string | null;
  previewEnabled?: boolean;
  tone?: string;
  onApply: () => void;
  t: Translate;
};

function ThemeCard({
  active,
  busy,
  description,
  disabled = false,
  id,
  name,
  preview,
  previewEnabled = false,
  tone,
  onApply,
  t,
}: ThemeCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const previewRequested = useRef(false);
  const [visible, setVisible] = useState(false);
  const [lazyPreview, setLazyPreview] = useState<string | null>(null);

  useEffect(() => {
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!previewEnabled || !visible || previewRequested.current || preview) return;
    previewRequested.current = true;
    let cancelled = false;
    void loadDreamSkinThemePreview(id)
      .then((value) => { if (!cancelled) setLazyPreview(value); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [id, preview, previewEnabled, visible]);

  const resolvedPreview = preview ?? lazyPreview;
  return (
    <article ref={cardRef} className={`dream-theme-card${active ? " is-active" : ""}`}>
      <div
        className={`dream-theme-preview dream-theme-preview-${tone ?? "saved"}`}
        style={resolvedPreview ? { backgroundImage: `url("${resolvedPreview}")` } : undefined}
      >
        <div className="dream-theme-preview-shade" />
        <span className="dream-theme-id">{id}</span>
        {active && <span className="dream-theme-current"><Check size={13} />{t("dreamSkin.current")}</span>}
      </div>
      <div className="dream-theme-copy">
        <div><h3>{name}</h3><p>{description}</p></div>
        <Button type={active ? "default" : "primary"} disabled={active || busy || disabled}
          loading={busy && !active} icon={active ? <Check size={14} /> : <WandSparkles size={14} />}
          onClick={onApply}>
          {active ? t("dreamSkin.applied") : t("dreamSkin.apply")}
        </Button>
      </div>
    </article>
  );
}

function SavedThemeCard({ theme, status, busy, onApply, t }: {
  theme: DreamSkinThemeSummary;
  status: DreamSkinStatus;
  busy: boolean;
  onApply: () => void;
  t: Translate;
}) {
  return <ThemeCard active={status.activeThemeId === theme.id} busy={busy}
    description={t("dreamSkin.saved.description")} id={theme.id} name={theme.name}
    previewEnabled onApply={onApply} t={t} />;
}

function MarketThemeCard({ theme, active, busy, onInstall, t }: {
  theme: DreamSkinMarketTheme;
  active: boolean;
  busy: boolean;
  onInstall: () => void;
  t: Translate;
}) {
  const needsInstall = !theme.installed || theme.updateAvailable;
  return (
    <article className={`dream-theme-card dream-market-card${active ? " is-active" : ""}`}>
      <div className="dream-theme-preview" style={{ backgroundImage: `url("${theme.previewUrl}")` }}>
        <div className="dream-theme-preview-shade" />
        <span className="dream-market-version">v{theme.version}</span>
        {active && <span className="dream-theme-current"><Check size={13} />{t("dreamSkin.current")}</span>}
      </div>
      <div className="dream-market-copy">
        <div className="dream-market-title-row">
          <div><h3>{theme.name}</h3><small>{t("dreamSkin.market.by", { author: theme.author })}</small></div>
          <Tooltip title={t("dreamSkin.market.source")}>
            <Button aria-label={t("dreamSkin.market.source")} size="small" type="text" icon={<Github size={15} />}
              onClick={() => void openUrl(theme.sourceUrl)} />
          </Tooltip>
        </div>
        <p>{theme.description}</p>
        <div className="dream-market-tags">
          {theme.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        <div className="dream-market-footer">
          <small>{theme.license}</small>
          <Button type={needsInstall ? "primary" : "default"} disabled={active && !theme.updateAvailable}
            loading={busy} icon={active && !theme.updateAvailable ? <Check size={14} /> : <CloudDownload size={14} />}
            onClick={onInstall}>
            {active && !theme.updateAvailable
              ? t("dreamSkin.applied")
              : theme.updateAvailable
                ? t("dreamSkin.market.updateApply")
                : theme.installed
                  ? t("dreamSkin.apply")
                  : t("dreamSkin.market.installApply")}
          </Button>
        </div>
      </div>
    </article>
  );
}

function CommunityThemeCard({ theme, active, busy, onInstall, t }: {
  theme: DreamSkinCommunityTheme;
  active: boolean;
  busy: boolean;
  onInstall: () => void;
  t: Translate;
}) {
  const needsInstall = !theme.installed || theme.updateAvailable;
  const previewUrl = `https://dreamskin.cc/preview?themeVersion=${encodeURIComponent(theme.id)}`;
  return (
    <article className={`dream-theme-card dream-market-card dream-community-card${active ? " is-active" : ""}`}>
      <div className="dream-theme-preview" style={{ backgroundImage: `url("${theme.previewUrl}")` }}>
        <div className="dream-theme-preview-shade" />
        <span className="dream-community-source">DreamSkin.cc</span>
        <span className="dream-market-version">v{theme.version}</span>
        {active && <span className="dream-theme-current"><Check size={13} />{t("dreamSkin.current")}</span>}
      </div>
      <div className="dream-market-copy">
        <div className="dream-market-title-row">
          <div><h3 title={theme.name}>{theme.name}</h3>
            <small>{t("dreamSkin.market.by", { author: theme.authorDisplayName })}</small></div>
        </div>
        <div className="dream-community-meta">
          <span>{theme.license}</span>
          <span>{t("dreamSkin.market.downloads", { count: theme.downloadCount.toLocaleString() })}</span>
          <span>{t("dreamSkin.market.packageSize", { size: formatPackageBytes(theme.packageBytes) })}</span>
        </div>
        {!theme.applyCompatible && <p>{t("dreamSkin.market.previewOnly")}</p>}
        <div className="dream-community-actions">
          {theme.applyCompatible && <Button type={needsInstall ? "primary" : "default"}
            disabled={active && !theme.updateAvailable} loading={busy}
            icon={active && !theme.updateAvailable ? <Check size={14} /> : <CloudDownload size={14} />}
            onClick={onInstall}>
            {active && !theme.updateAvailable
              ? t("dreamSkin.applied")
              : theme.updateAvailable
                ? t("dreamSkin.market.updateApply")
                : theme.installed
                  ? t("dreamSkin.apply")
                  : t("dreamSkin.market.installApply")}
          </Button>}
          <Button icon={<Eye size={14} />} onClick={() => void openUrl(previewUrl)}>
            {t("dreamSkin.market.onlinePreview")}
          </Button>
        </div>
      </div>
    </article>
  );
}

function formatPackageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function formatResourceBytes(bytes?: number | null): string {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

const DEFAULT_IMPORT_OPTIONS: DreamSkinImportOptions = {
  name: "My Dream Skin",
  appearance: "auto",
  safeArea: "auto",
  taskMode: "auto",
  focusX: null,
  focusY: null,
};

export function DreamSkinPage({ t, notify }: DreamSkinPageProps) {
  const [status, setStatus] = useState<DreamSkinStatus | null>(null);
  const [resources, setResources] = useState<DreamSkinResourcesStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importOptions, setImportOptions] = useState<DreamSkinImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [themeTab, setThemeTab] = useState<"builtIn" | "market">("builtIn");
  const [market, setMarket] = useState<DreamSkinMarketResult | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketQuery, setMarketQuery] = useState("");
  const [communityThemes, setCommunityThemes] = useState<DreamSkinCommunityTheme[]>([]);
  const [communityTotal, setCommunityTotal] = useState<number | null>(null);
  const [communityInitialized, setCommunityInitialized] = useState(false);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityWarning, setCommunityWarning] = useState<string | null>(null);
  const communityLoadingRef = useRef(false);
  const communityOffsetRef = useRef(0);
  const communityTotalRef = useRef<number | null>(null);
  const communitySentinelRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await loadDreamSkinStatus());
      setError(null);
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const refreshMarket = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      setMarket(await loadDreamSkinMarket());
    } catch (loadError) {
      setMarketError(String(loadError));
    } finally {
      setMarketLoading(false);
    }
  }, []);

  const loadCommunityThemes = useCallback(async (reset = false) => {
    if (communityLoadingRef.current) return;
    const offset = reset ? 0 : communityOffsetRef.current;
    const knownTotal = communityTotalRef.current;
    if (!reset && knownTotal !== null && offset >= Math.min(knownTotal, COMMUNITY_CATALOG_LIMIT)) return;

    communityLoadingRef.current = true;
    setCommunityLoading(true);
    setCommunityError(null);
    if (reset) setCommunityWarning(null);
    try {
      const page = await loadDreamSkinCommunityPage(offset, COMMUNITY_PAGE_SIZE);
      const total = Math.min(page.total, COMMUNITY_CATALOG_LIMIT);
      const nextOffset = Math.min(COMMUNITY_CATALOG_LIMIT, page.offset + page.items.length);
      const effectiveTotal = page.items.length === 0 ? Math.min(total, offset) : total;
      communityOffsetRef.current = nextOffset;
      communityTotalRef.current = effectiveTotal;
      setCommunityTotal(effectiveTotal);
      setCommunityWarning(page.warning ?? null);
      setCommunityThemes((current) => {
        const merged = reset ? [] : [...current];
        const positions = new Map(merged.map((theme, index) => [theme.id, index]));
        for (const theme of page.items) {
          const position = positions.get(theme.id);
          if (position === undefined) {
            positions.set(theme.id, merged.length);
            merged.push(theme);
          } else {
            merged[position] = theme;
          }
        }
        return merged;
      });
    } catch (loadError) {
      setCommunityError(String(loadError));
    } finally {
      setCommunityInitialized(true);
      setCommunityLoading(false);
      communityLoadingRef.current = false;
    }
  }, []);

  const refreshThemeMarket = useCallback(() => {
    void refreshMarket();
    void loadCommunityThemes(true);
  }, [loadCommunityThemes, refreshMarket]);

  useEffect(() => {
    if (themeTab !== "market") return;
    if (!market && !marketLoading) void refreshMarket();
    if (!communityInitialized && !communityLoadingRef.current) void loadCommunityThemes();
  }, [communityInitialized, loadCommunityThemes, market, marketLoading, refreshMarket, themeTab]);

  const communityHasMore = communityTotal === null
    || communityOffsetRef.current < Math.min(communityTotal, COMMUNITY_CATALOG_LIMIT);

  useEffect(() => {
    const sentinel = communitySentinelRef.current;
    if (themeTab !== "market" || !sentinel || !communityInitialized || communityLoading
      || communityError || !communityHasMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadCommunityThemes();
    }, { rootMargin: "400px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [communityError, communityHasMore, communityInitialized, communityLoading, loadCommunityThemes, themeTab]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void loadDreamSkinResourcesStatus()
        .then((next) => { if (!cancelled) setResources(next); })
        .catch((resourceError) => {
          if (!cancelled) {
            setResources((current) => ({
              phase: "error",
              installed: current?.installed ?? false,
              installedVersion: current?.installedVersion,
              availableVersion: current?.availableVersion,
              downloadedBytes: current?.downloadedBytes ?? 0,
              totalBytes: current?.totalBytes,
              error: String(resourceError),
            }));
          }
        });
    };
    poll();
    const timer = window.setInterval(poll, 750);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const runStatusOperation = useCallback(async (
    key: string,
    operation: () => Promise<DreamSkinStatus>,
    successMessage: string,
  ) => {
    setBusy(key);
    setError(null);
    try {
      const next = await operation();
      setStatus(next);
      notify(successMessage);
      return true;
    } catch (operationError) {
      setError(String(operationError));
      return false;
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const confirmChatGptRestart = useCallback((operation: () => Promise<unknown>) => {
    Modal.confirm({
      title: t("dreamSkin.restart.confirmTitle"),
      content: t("dreamSkin.restart.confirmDescription"),
      okText: t("dreamSkin.restart.confirmAction"),
      cancelText: t("table.cancel"),
      onOk: operation,
    });
  }, [t]);

  const applyTheme = useCallback((themeId: string) => {
    const operation = () => runStatusOperation(
      `apply:${themeId}`,
      () => applyDreamSkinTheme(themeId),
      t("dreamSkin.toast.applied"),
    );
    if (status?.installed) {
      void operation();
    } else {
      confirmChatGptRestart(operation);
    }
  }, [confirmChatGptRestart, runStatusOperation, status?.installed, t]);

  const changeAppearance = useCallback((appearance: DreamSkinAppearance) => {
    void runStatusOperation(
      "appearance",
      () => setDreamSkinAppearance(appearance),
      t("dreamSkin.toast.appearanceChanged"),
    );
  }, [runStatusOperation, t]);

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
  }, [t]);

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
    if (status?.installed) {
      await operation();
    } else {
      confirmChatGptRestart(operation);
    }
  }, [confirmChatGptRestart, importOptions, importPath, runStatusOperation, status?.installed, t]);

  const submitSave = useCallback(async () => {
    if (!saveName.trim()) return;
    const ok = await runStatusOperation(
      "save",
      () => saveDreamSkinTheme(saveName.trim()),
      t("dreamSkin.toast.saved"),
    );
    if (ok) {
      setSaveOpen(false);
      setSaveName("");
    }
  }, [runStatusOperation, saveName, t]);

  const savedThemes = useMemo(() => (
    status?.savedThemes.filter((theme) => !BUILT_IN_DREAM_SKIN_IDS.has(theme.id)) ?? []
  ), [status?.savedThemes]);

  const filteredMarketThemes = useMemo(() => {
    const query = marketQuery.trim().toLocaleLowerCase();
    if (!query) return market?.themes ?? [];
    return (market?.themes ?? []).filter((theme) => (
      [theme.name, theme.author, theme.description, theme.id, ...theme.tags]
        .some((value) => value.toLocaleLowerCase().includes(query))
    ));
  }, [market?.themes, marketQuery]);

  const filteredCommunityThemes = useMemo(() => {
    const staticThemeIds = new Set((market?.themes ?? []).map((theme) => theme.id));
    const query = marketQuery.trim().toLocaleLowerCase();
    return communityThemes.filter((theme) => (
      !staticThemeIds.has(theme.themeId)
      && (!query || [theme.name, theme.authorDisplayName, theme.themeId, theme.license, theme.version]
        .some((value) => value.toLocaleLowerCase().includes(query)))
    ));
  }, [communityThemes, market?.themes, marketQuery]);

  const installAndApplyMarketTheme = useCallback((theme: DreamSkinMarketTheme) => {
    if (theme.installed && !theme.updateAvailable) {
      applyTheme(theme.id);
      return;
    }
    const operation = async () => {
      const ok = await runStatusOperation(
        `market:${theme.id}`,
        async () => {
          await installDreamSkinMarketTheme(theme.id);
          const next = await applyDreamSkinTheme(theme.id);
          void refreshMarket();
          return next;
        },
        t(theme.updateAvailable ? "dreamSkin.market.toast.updated" : "dreamSkin.market.toast.installed"),
      );
      return ok;
    };
    if (status?.installed) void operation();
    else confirmChatGptRestart(operation);
  }, [applyTheme, confirmChatGptRestart, refreshMarket, runStatusOperation, status?.installed, t]);

  const installAndApplyCommunityTheme = useCallback((theme: DreamSkinCommunityTheme) => {
    if (theme.installed && !theme.updateAvailable) {
      applyTheme(theme.themeId);
      return;
    }
    const operation = async () => {
      const ok = await runStatusOperation(
        `community:${theme.id}`,
        async () => {
          await installDreamSkinCommunityTheme(theme.id);
          const next = await applyDreamSkinTheme(theme.themeId);
          setCommunityThemes((current) => current.map((item) => item.themeId === theme.themeId
            ? { ...item, installed: true, installedVersion: item.version, updateAvailable: false }
            : item));
          return next;
        },
        t(theme.updateAvailable ? "dreamSkin.market.toast.updated" : "dreamSkin.market.toast.installed"),
      );
      return ok;
    };
    if (status?.installed) void operation();
    else confirmChatGptRestart(operation);
  }, [applyTheme, confirmChatGptRestart, runStatusOperation, status?.installed, t]);

  const sessionLabel = status ? t(`dreamSkin.session.${status.session}`) : t("dreamSkin.session.loading");
  const activeThemeName = status?.activeThemeName || t("dreamSkin.noActiveTheme");
  const isBusy = busy !== null;
  const resourcesReady = resources?.installed === true;
  const resourcePercent = resources?.totalBytes
    ? Math.min(100, Math.round(resources.downloadedBytes / resources.totalBytes * 100))
    : 0;

  if (loading && !status) {
    return <div className="dream-skin-loading"><Sparkles className="spin" size={24} />{t("dreamSkin.loading")}</div>;
  }

  if (status && !status.supported) {
    return <div className="dream-skin-page"><Alert showIcon type="warning"
      message={t("dreamSkin.unsupported.title")} description={t("dreamSkin.unsupported.description")} /></div>;
  }

  return (
    <div className="dream-skin-page">
      {error && <Alert className="dream-skin-error" type="error" showIcon closable
        message={t("dreamSkin.error")} description={error} onClose={() => setError(null)} />}

      {resources?.phase !== "ready" && resources?.phase !== "unsupported" && (
        <Alert
          className="dream-skin-error"
          type={resources?.phase === "error" ? "error" : "info"}
          showIcon
          icon={<CloudDownload size={18} />}
          message={t(
            resources?.phase === "downloading"
              ? "dreamSkin.resources.downloading"
              : resources?.phase === "error"
                ? "dreamSkin.resources.failed"
                : "dreamSkin.resources.checking",
          )}
          description={resources?.phase === "downloading" ? (
            <div>
              <p>{t("dreamSkin.resources.progress", {
                downloaded: formatResourceBytes(resources.downloadedBytes),
                total: formatResourceBytes(resources.totalBytes),
              })}</p>
              <Progress percent={resourcePercent} size="small" status="active" />
            </div>
          ) : resources?.phase === "error" ? (
            <div>
              <p>{resources.error || t("dreamSkin.resources.failedDescription")}</p>
              <Button size="small" onClick={() => void retryDreamSkinResources().then(setResources)}>
                {t("dreamSkin.resources.retry")}
              </Button>
            </div>
          ) : t("dreamSkin.resources.checkingDescription")}
        />
      )}

      <section className="dream-skin-hero">
        <div className="dream-skin-console">
          <div className="dream-skin-status-card">
            <div className="dream-status-item">
              <span>{t("dreamSkin.status")}</span>
              <strong className={`dream-session dream-session-${status?.session ?? "ready"}`}><i />{sessionLabel}</strong>
            </div>
            <div className="dream-status-item dream-active-theme">
              <span>{t("dreamSkin.activeTheme")}</span>
              <b title={activeThemeName}>{activeThemeName}</b>
            </div>
            <div className="dream-appearance-control">
              <span>{t("dreamSkin.import.appearance")}</span>
              <Segmented
                block
                size="small"
                value={status?.activeThemeAppearance ?? "auto"}
                disabled={!status?.installed || !status.activeThemeId || isBusy}
                options={APPEARANCE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                onChange={(appearance) => changeAppearance(appearance as DreamSkinAppearance)}
              />
            </div>
          </div>
          <div className="dream-tools-actions">
            <div className="dream-tool-group dream-tool-group-runtime">
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
              <Button icon={status?.session === "paused" ? <CirclePlay size={15} /> : <CirclePause size={15} />}
                disabled={!status?.installed || isBusy} loading={busy === "pause"}
                onClick={() => {
                  const operation = () => runStatusOperation("pause", () => setDreamSkinPaused(status?.session !== "paused"),
                    status?.session === "paused" ? t("dreamSkin.toast.resumed") : t("dreamSkin.toast.paused"));
                  if (status?.session === "paused") confirmChatGptRestart(operation);
                  else void operation();
                }}>
                {status?.session === "paused" ? t("dreamSkin.resume") : t("dreamSkin.pause")}
              </Button>
              <Button icon={<RefreshCw size={15} />} disabled={!status?.installed || isBusy}
                loading={busy === "reapply"} onClick={() => confirmChatGptRestart(() => runStatusOperation(
                  "reapply", reapplyDreamSkin, t("dreamSkin.toast.reapplied")))}>{t("dreamSkin.reapply")}</Button>
            </div>
            <div className="dream-tool-group dream-tool-group-theme">
              <Button icon={<Save size={15} />} disabled={!status?.installed || !status.activeThemeId || isBusy}
                onClick={() => { setSaveName(status?.activeThemeName ?? ""); setSaveOpen(true); }}>
                {t("dreamSkin.saveCurrent")}</Button>
              <Button icon={<ShieldCheck size={15} />} disabled={!status?.installed || isBusy}
                loading={busy === "verify"} onClick={() => {
                  setBusy("verify"); setError(null);
                  void verifyDreamSkin().then(() => notify(t("dreamSkin.toast.verified")))
                    .catch((verifyError) => setError(String(verifyError))).finally(() => setBusy(null));
                }}>{t("dreamSkin.verify")}</Button>
              <Button icon={<FolderOpen size={15} />} disabled={isBusy}
                onClick={() => void openDreamSkinFolder().catch((folderError) => setError(String(folderError)))}>
                {t("dreamSkin.openFolder")}</Button>
              <Popconfirm title={t("dreamSkin.restore.confirmTitle")}
                description={t("dreamSkin.restore.confirmDescription")} okText={t("dreamSkin.restore")}
                cancelText={t("table.cancel")} okButtonProps={{ danger: true }}
                onConfirm={() => void runStatusOperation("restore", restoreDreamSkin, t("dreamSkin.toast.restored"))}>
                <Button danger icon={<RotateCcw size={15} />} disabled={!status?.runtimeInstalled || isBusy}
                  loading={busy === "restore"}>{t("dreamSkin.restore")}</Button>
              </Popconfirm>
            </div>
          </div>
        </div>
      </section>

      {!status?.installed && <Alert className="dream-skin-prerequisite" type="info" showIcon
        message={t("dreamSkin.installHint.title")} description={t("dreamSkin.installHint.description")} />}

      <section className="dream-skin-section dream-theme-browser">
        <Tabs activeKey={themeTab} onChange={(key) => setThemeTab(key as "builtIn" | "market")} items={[
          {
            key: "builtIn",
            label: <span className="dream-theme-tab-label"><Sparkles size={15} />{t("dreamSkin.tabs.builtIn")}</span>,
            children: <>
              <div className="dream-tab-summary">{t("dreamSkin.presets.description")}</div>
              <div className="dream-theme-grid">
                {BUILT_IN_DREAM_SKIN_THEMES.map((theme) => <ThemeCard key={theme.id}
                  active={status?.activeThemeId === theme.id} busy={busy === `apply:${theme.id}`}
                  disabled={!resourcesReady}
                  description={t(theme.descriptionKey)} id={theme.id} name={t(theme.nameKey)}
                  previewEnabled={resourcesReady} tone={theme.tone} onApply={() => applyTheme(theme.id)} t={t} />)}
                <article className="dream-theme-card dream-theme-import-card">
                  <button type="button" className="dream-import-trigger" disabled={isBusy} onClick={() => void chooseCustomImage()}>
                    <span className="dream-import-icon"><ImagePlus size={28} /></span>
                    <span><b>{t("dreamSkin.import.title")}</b><small>{t("dreamSkin.import.description")}</small></span>
                    <em><WandSparkles size={15} />{t("dreamSkin.import.action")}</em>
                  </button>
                </article>
              </div>
            </>,
          },
          {
            key: "market",
            label: <span className="dream-theme-tab-label"><Store size={15} />{t("dreamSkin.tabs.market")}</span>,
            children: <div className="dream-market-pane">
              <div className="dream-market-toolbar">
                <Input allowClear value={marketQuery} prefix={<Search size={14} />} placeholder={t("dreamSkin.market.search")}
                  onChange={(event) => setMarketQuery(event.target.value)} />
                <Button icon={<RefreshCw className={marketLoading || communityLoading ? "spin" : ""} size={14} />}
                  loading={marketLoading || communityLoading} onClick={refreshThemeMarket}>{t("dreamSkin.market.refresh")}</Button>
                <Button icon={<Eye size={14} />} onClick={() => void openUrl("https://dreamskin.cc/gallery")}>
                  {t("dreamSkin.market.gallery")}</Button>
              </div>
              {(market?.updatedAt || communityInitialized) && <div className="dream-tab-summary dream-market-summary">
                {market?.updatedAt && <span>{t("dreamSkin.market.updatedAt", { date: market.updatedAt })}</span>}
                {communityInitialized && (!communityError || communityThemes.length > 0) && <span>{t("dreamSkin.market.loadedCount", {
                  loaded: communityThemes.length,
                  total: communityTotal ?? communityThemes.length,
                })}</span>}
              </div>}
              {(market?.cached || market?.warning) && <Alert showIcon type="warning"
                message={t("dreamSkin.market.cached")} description={market.warning} />}
              {communityWarning && <Alert showIcon type="warning" message={t("dreamSkin.market.communityCached")}
                description={communityWarning} />}
              {marketError && <Alert showIcon type="error" message={t("dreamSkin.market.failed")} description={marketError}
                action={<Button size="small" onClick={() => void refreshMarket()}>{t("dreamSkin.market.retry")}</Button>} />}
              {communityError && <Alert showIcon type="error" message={t("dreamSkin.market.communityFailed")}
                description={communityError} action={<Button size="small" onClick={() => void loadCommunityThemes()}>
                  {t("dreamSkin.market.retry")}</Button>} />}
              {(marketLoading && !market) && (communityLoading && !communityInitialized)
                ? <div className="dream-market-loading"><RefreshCw className="spin" size={20} />
                  {t("dreamSkin.market.loading")}</div>
                : filteredMarketThemes.length + filteredCommunityThemes.length > 0 ? (
                <div className="dream-theme-grid dream-market-grid">
                  {filteredMarketThemes.map((theme) => <MarketThemeCard key={theme.id} theme={theme}
                    active={status?.activeThemeId === theme.id} busy={busy === `market:${theme.id}`}
                    onInstall={() => installAndApplyMarketTheme(theme)} t={t} />)}
                  {filteredCommunityThemes.map((theme) => <CommunityThemeCard key={theme.id} theme={theme}
                    active={status?.activeThemeId === theme.themeId} busy={busy === `community:${theme.id}`}
                    onInstall={() => installAndApplyCommunityTheme(theme)} t={t} />)}
                </div>
                ) : <div className="dream-market-empty">{t("dreamSkin.market.empty")}</div>}
              <div ref={communitySentinelRef} className="dream-market-sentinel" aria-live="polite">
                {communityLoading
                  ? <><RefreshCw className="spin" size={15} />{t("dreamSkin.market.loadingMore")}</>
                  : communityError
                    ? <Button size="small" onClick={() => void loadCommunityThemes()}>{t("dreamSkin.market.retryApi")}</Button>
                    : communityInitialized && communityHasMore
                      ? t("dreamSkin.market.scrollForMore")
                      : communityInitialized
                        ? t("dreamSkin.market.allLoaded", { count: communityThemes.length })
                        : null}
              </div>
            </div>,
          },
        ]} />
      </section>

      {savedThemes.length > 0 && <section className="dream-skin-section">
        <div className="dream-section-heading"><div><span>{t("dreamSkin.saved.eyebrow")}</span>
          <h2>{t("dreamSkin.saved.title")}</h2></div><p>{t("dreamSkin.saved.subtitle")}</p></div>
        <div className="dream-theme-grid dream-saved-grid">
          {savedThemes.map((theme) => <SavedThemeCard key={theme.id} theme={theme} status={status!}
            busy={busy === `apply:${theme.id}`} onApply={() => applyTheme(theme.id)} t={t} />)}
        </div>
      </section>}

      <Modal title={t("dreamSkin.import.modalTitle")} open={importOpen} confirmLoading={busy === "import"}
        okText={t("dreamSkin.import.apply")} cancelText={t("table.cancel")} onOk={() => void submitImport()}
        okButtonProps={{ disabled: !importOptions.name.trim() }} onCancel={() => !isBusy && setImportOpen(false)}>
        <div className="dream-import-form">
          <p>{t("dreamSkin.import.modalDescription")}</p>
          <label htmlFor="dream-skin-name">{t("dreamSkin.import.name")}</label>
          <Input id="dream-skin-name" maxLength={80} value={importOptions.name}
            onChange={(event) => setImportOptions((current) => ({ ...current, name: event.target.value }))} />
          <div className="dream-import-fields">
            <label><span>{t("dreamSkin.import.appearance")}</span><Select value={importOptions.appearance}
              onChange={(appearance: DreamSkinImportOptions["appearance"]) => setImportOptions((current) => ({ ...current, appearance }))}
              options={APPEARANCE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))} /></label>
            <label><span>{t("dreamSkin.import.safeArea")}</span><Select value={importOptions.safeArea}
              onChange={(safeArea: DreamSkinImportOptions["safeArea"]) => setImportOptions((current) => ({ ...current, safeArea }))}
              options={SAFE_AREA_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))} /></label>
            <label><span>{t("dreamSkin.import.taskMode")}</span><Select value={importOptions.taskMode}
              onChange={(taskMode: DreamSkinImportOptions["taskMode"]) => setImportOptions((current) => ({ ...current, taskMode }))}
              options={TASK_MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))} /></label>
            <label><span>{t("dreamSkin.import.focusX")}</span><InputNumber min={0} max={1} step={0.01}
              placeholder={t("dreamSkin.option.auto")} value={importOptions.focusX}
              onChange={(focusX) => setImportOptions((current) => ({ ...current, focusX }))} /></label>
            <label><span>{t("dreamSkin.import.focusY")}</span><InputNumber min={0} max={1} step={0.01}
              placeholder={t("dreamSkin.option.auto")} value={importOptions.focusY}
              onChange={(focusY) => setImportOptions((current) => ({ ...current, focusY }))} /></label>
          </div>
          <small>{t("dreamSkin.import.requirements")}</small>
        </div>
      </Modal>

      <Modal title={t("dreamSkin.save.modalTitle")} open={saveOpen} confirmLoading={busy === "save"}
        okText={t("dreamSkin.save.action")} cancelText={t("table.cancel")} onOk={() => void submitSave()}
        okButtonProps={{ disabled: !saveName.trim() }} onCancel={() => !isBusy && setSaveOpen(false)}>
        <div className="dream-save-form"><p>{t("dreamSkin.save.description")}</p>
          <label htmlFor="dream-skin-save-name">{t("dreamSkin.import.name")}</label>
          <Input id="dream-skin-save-name" value={saveName} maxLength={80}
            onChange={(event) => setSaveName(event.target.value)} onPressEnter={() => void submitSave()} /></div>
      </Modal>
    </div>
  );
}
