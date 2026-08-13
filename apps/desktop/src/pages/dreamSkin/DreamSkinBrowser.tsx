import { Alert, Button } from "antd";
import { ImagePlus, RefreshCw, WandSparkles } from "lucide-react";
import { BUILT_IN_DREAM_SKIN_THEMES } from "../../dreamSkinBuiltIns";
import type { Translate } from "../../i18n";
import type { DreamSkinStatus, DreamSkinThemeSummary } from "../../types";
import type { CatalogState, ThemeActions, ThemeTab } from "./types";
import { CommunityThemeCard, MarketThemeCard, SavedThemeCard, ThemeCard } from "./ThemeCards";

type Props = {
  actions: ThemeActions;
  busy: string | null;
  catalog: CatalogState;
  chooseCustomImage: () => Promise<void>;
  isBusy: boolean;
  resourcesReady: boolean;
  savedThemes: DreamSkinThemeSummary[];
  status: DreamSkinStatus | null;
  t: Translate;
  themeTab: ThemeTab;
};

export function DreamSkinBrowser(props: Props) {
  const { status, t, themeTab } = props;
  return <>
    {!status?.installed && <Alert className="dream-skin-prerequisite" type="info" showIcon
      message={t("dreamSkin.installHint.title")} description={t("dreamSkin.installHint.description")} />}
    <section className="dream-skin-section dream-theme-browser">
      {themeTab === "builtIn" ? <BuiltInThemes {...props} />
        : themeTab === "market" ? <MarketThemes {...props} /> : <SavedThemes {...props} />}
    </section>
  </>;
}

function BuiltInThemes(props: Props) {
  const { actions, busy, chooseCustomImage, isBusy, resourcesReady, status, t } = props;
  return <div className="dream-theme-grid" role="tabpanel" aria-label={t("dreamSkin.tabs.builtIn")}>
    {BUILT_IN_DREAM_SKIN_THEMES.map((theme) => <ThemeCard key={theme.id}
      active={status?.activeThemeId === theme.id} busy={busy === `apply:${theme.id}`}
      disabled={!resourcesReady} description={t(theme.descriptionKey)} id={theme.id} name={t(theme.nameKey)}
      previewEnabled={resourcesReady} tone={theme.tone} onApply={() => actions.applyTheme(theme.id)} t={t} />)}
    <article className="dream-theme-card dream-theme-import-card">
      <button type="button" className="dream-import-trigger" disabled={isBusy}
        onClick={() => void chooseCustomImage()}>
        <span className="dream-import-icon"><ImagePlus size={28} /></span>
        <span><b>{t("dreamSkin.import.title")}</b><small>{t("dreamSkin.import.description")}</small></span>
        <em><WandSparkles size={15} />{t("dreamSkin.import.action")}</em>
      </button>
    </article>
  </div>;
}

function MarketThemes(props: Props) {
  const { actions, busy, catalog, status, t } = props;
  const hasThemes = catalog.filteredMarketThemes.length + catalog.filteredCommunityThemes.length > 0;
  const initiallyLoading = catalog.marketLoading && !catalog.market
    && catalog.communityLoading && !catalog.communityInitialized;
  let themeContent = <div className="dream-market-empty">{t("dreamSkin.market.empty")}</div>;
  if (initiallyLoading) {
    themeContent = <div className="dream-market-loading"><RefreshCw className="spin" size={20} />
      {t("dreamSkin.market.loading")}</div>;
  } else if (hasThemes) {
    themeContent = <div className="dream-theme-grid dream-market-grid">
      {catalog.filteredMarketThemes.map((theme) => <MarketThemeCard key={theme.id} theme={theme}
        active={status?.activeThemeId === theme.id} busy={busy === `market:${theme.id}`}
        onInstall={() => actions.installAndApplyMarketTheme(theme)} t={t} />)}
      {catalog.filteredCommunityThemes.map((theme) => <CommunityThemeCard key={theme.id} theme={theme}
        active={status?.activeThemeId === theme.themeId} busy={busy === `community:${theme.id}`}
        onInstall={() => actions.installAndApplyCommunityTheme(theme)} t={t} />)}
    </div>;
  }
  return <div className="dream-market-pane" role="tabpanel" aria-label={t("dreamSkin.tabs.market")}>
    {(catalog.market?.cached || catalog.market?.warning) && <Alert showIcon type="warning"
      message={t("dreamSkin.market.cached")} description={catalog.market.warning} />}
    {catalog.communityWarning && <Alert showIcon type="warning"
      message={t("dreamSkin.market.communityCached")} description={catalog.communityWarning} />}
    {catalog.marketError && <Alert showIcon type="error" message={t("dreamSkin.market.failed")}
      description={catalog.marketError} action={<Button size="small" onClick={() => void catalog.refreshMarket()}>
        {t("dreamSkin.market.retry")}</Button>} />}
    {catalog.communityError && <Alert showIcon type="error" message={t("dreamSkin.market.communityFailed")}
      description={catalog.communityError} action={<Button size="small"
        onClick={() => void catalog.loadCommunityThemes()}>{t("dreamSkin.market.retry")}</Button>} />}
    {themeContent}
    <MarketSentinel catalog={catalog} t={t} />
  </div>;
}

function MarketSentinel({ catalog, t }: Pick<Props, "catalog" | "t">) {
  let content = null;
  if (catalog.communityLoading) {
    content = <><RefreshCw className="spin" size={15} />{t("dreamSkin.market.loadingMore")}</>;
  } else if (catalog.communityError) {
    content = <Button size="small" onClick={() => void catalog.loadCommunityThemes()}>
      {t("dreamSkin.market.retryApi")}</Button>;
  } else if (catalog.communityInitialized && catalog.communityHasMore) {
    content = t("dreamSkin.market.scrollForMore");
  } else if (catalog.communityInitialized) {
    content = t("dreamSkin.market.allLoaded", { count: catalog.communityThemes.length });
  }
  return <div ref={catalog.communitySentinelRef} className="dream-market-sentinel" aria-live="polite">
    {content}
  </div>;
}

function SavedThemes(props: Props) {
  const { actions, busy, savedThemes, status, t } = props;
  if (savedThemes.length === 0) {
    return <div className="dream-market-empty" role="tabpanel"
      aria-label={t("dreamSkin.tabs.savedCommunity")}>{t("dreamSkin.saved.empty")}</div>;
  }
  return <div className="dream-theme-grid dream-saved-grid" role="tabpanel"
    aria-label={t("dreamSkin.tabs.savedCommunity")}>
    {savedThemes.map((theme) => <SavedThemeCard key={theme.id} theme={theme} status={status!}
      busy={busy === `apply:${theme.id}`} onApply={() => actions.applyTheme(theme.id)} t={t} />)}
  </div>;
}
