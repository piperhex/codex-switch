import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, InputNumber, Modal, Popconfirm, Progress, Segmented, Select, Tooltip } from "antd";
import {
  Check,
  CirclePause,
  CirclePlay,
  CloudDownload,
  FolderOpen,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  applyDreamSkinTheme,
  chooseDreamSkinImage,
  importDreamSkinImage,
  installDreamSkin,
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
  DreamSkinImportOptions,
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

      <section className="dream-skin-section">
        <div className="dream-section-heading"><div><span>{t("dreamSkin.presets.eyebrow")}</span>
          <h2>{t("dreamSkin.presets.title")}</h2></div>
          <p>{t("dreamSkin.presets.description")}</p></div>
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
