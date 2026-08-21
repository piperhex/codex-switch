import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Tooltip } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, CloudDownload, Eye, Github, WandSparkles } from "lucide-react";
import { loadDreamSkinThemePreview } from "../../api/backend";
import type { Translate } from "../../i18n";
import type {
  DreamSkinCommunityTheme,
  DreamSkinMarketTheme,
  DreamSkinStatus,
  DreamSkinThemeSummary,
} from "../../types";
import { formatPackageBytes } from "./formatters";

type ThemeCardProps = {
  active: boolean;
  busy: boolean;
  description: string;
  disabled?: boolean;
  id: string;
  name: string;
  preview?: string | null;
  previewEnabled?: boolean;
  selection?: {
    label: string;
    selected: boolean;
    onChange: (selected: boolean) => void;
  };
  tone?: string;
  onApply: () => void;
  t: Translate;
};

export function ThemeCard(props: ThemeCardProps) {
  const { active, busy, description, disabled = false, id, name, preview } = props;
  const { previewEnabled = false, selection, tone, onApply, t } = props;
  const { cardRef, resolvedPreview } = useLazyPreview({ id, preview, previewEnabled });
  return (
    <article ref={cardRef}
      className={`dream-theme-card${active ? " is-active" : ""}${selection?.selected ? " is-selected" : ""}`}>
      <div className={`dream-theme-preview dream-theme-preview-${tone ?? "saved"}`}
        style={resolvedPreview ? { backgroundImage: `url("${resolvedPreview}")` } : undefined}>
        <div className="dream-theme-preview-shade" />
        {selection && <Checkbox className="dream-theme-selection" checked={selection.selected}
          aria-label={selection.label} onChange={(event) => selection.onChange(event.target.checked)} />}
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

function useLazyPreview(options: Pick<ThemeCardProps, "id" | "preview" | "previewEnabled">) {
  const { id, preview, previewEnabled } = options;
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
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
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

  return { cardRef, resolvedPreview: preview ?? lazyPreview };
}

export function SavedThemeCard(props: {
  theme: DreamSkinThemeSummary;
  status: DreamSkinStatus;
  busy: boolean;
  onApply: () => void;
  onSelectionChange: (selected: boolean) => void;
  selected: boolean;
  t: Translate;
}) {
  const { theme, status, busy, onApply, onSelectionChange, selected, t } = props;
  return <ThemeCard active={status.activeThemeId === theme.id} busy={busy}
    description={t("dreamSkin.saved.description")} id={theme.id} name={theme.name}
    previewEnabled onApply={onApply} selection={{
      label: t("dreamSkin.saved.select", { name: theme.name }),
      selected,
      onChange: onSelectionChange,
    }} t={t} />;
}

function InstallButton(props: {
  active: boolean;
  busy: boolean;
  installed: boolean;
  updateAvailable: boolean;
  onInstall: () => void;
  t: Translate;
}) {
  const { active, busy, installed, updateAvailable, onInstall, t } = props;
  let label = installed ? t("dreamSkin.apply") : t("dreamSkin.market.installApply");
  if (active && !updateAvailable) label = t("dreamSkin.applied");
  else if (updateAvailable) label = t("dreamSkin.market.updateApply");
  return <Button type={!installed || updateAvailable ? "primary" : "default"}
    disabled={active && !updateAvailable} loading={busy}
    icon={active && !updateAvailable ? <Check size={14} /> : <CloudDownload size={14} />}
    onClick={onInstall}>
    {label}
  </Button>;
}

export function MarketThemeCard(props: {
  theme: DreamSkinMarketTheme;
  active: boolean;
  busy: boolean;
  onInstall: () => void;
  t: Translate;
}) {
  const { theme, active, busy, onInstall, t } = props;
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
            <Button aria-label={t("dreamSkin.market.source")} size="small" type="text"
              icon={<Github size={15} />} onClick={() => void openUrl(theme.sourceUrl)} />
          </Tooltip>
        </div>
        <p>{theme.description}</p>
        <div className="dream-market-tags">{theme.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <div className="dream-market-footer">
          <small>{theme.license}</small>
          <InstallButton active={active} busy={busy} installed={theme.installed}
            updateAvailable={theme.updateAvailable} onInstall={onInstall} t={t} />
        </div>
      </div>
    </article>
  );
}

export function CommunityThemeCard(props: {
  theme: DreamSkinCommunityTheme;
  active: boolean;
  busy: boolean;
  onInstall: () => void;
  t: Translate;
}) {
  const { theme, active, busy, onInstall, t } = props;
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
        <div className="dream-market-title-row"><div><h3 title={theme.name}>{theme.name}</h3>
          <small>{t("dreamSkin.market.by", { author: theme.authorDisplayName })}</small></div></div>
        <div className="dream-community-meta">
          <span>{theme.license}</span>
          <span>{t("dreamSkin.market.downloads", { count: theme.downloadCount.toLocaleString() })}</span>
          <span>{t("dreamSkin.market.packageSize", { size: formatPackageBytes(theme.packageBytes) })}</span>
        </div>
        {!theme.applyCompatible && <p>{t("dreamSkin.market.previewOnly")}</p>}
        <div className="dream-community-actions">
          {theme.applyCompatible && <InstallButton active={active} busy={busy} installed={theme.installed}
            updateAvailable={theme.updateAvailable} onInstall={onInstall} t={t} />}
          <Button icon={<Eye size={14} />} onClick={() => void openUrl(previewUrl)}>
            {t("dreamSkin.market.onlinePreview")}
          </Button>
        </div>
      </div>
    </article>
  );
}
