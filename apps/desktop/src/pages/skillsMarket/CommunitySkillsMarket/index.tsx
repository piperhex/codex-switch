import { useMemo, useState } from "react";
import { LoaderCircle, PackageOpen } from "lucide-react";
import { hasLocalBackend, isDesktopApp, skillPreviewUrl } from "../../../api/backend";
import { CodexHomeScope, CodexHomeSelect, useSelectedCodexHome } from "../../../components/CodexHomeScope";
import { useCommunitySkills } from "./useCommunitySkills";
import { ChromePluginCard, chromePluginMatches } from "../ChromePluginCard";
import type { SkillMarketItem } from "../../../types";
import { SkillDetailModal } from "../SkillDetailModal";
import { SkillMarketGrid } from "../SkillMarketGrid";
import { SkillPublishModal } from "../SkillPublishModal";
import { SkillsMarketToolbar } from "../SkillsMarketToolbar";
import type { CommunitySkillsMarketProps } from "../types";

export function CommunitySkillsMarket(props: CommunitySkillsMarketProps) {
  if (!hasLocalBackend) return <CommunitySkillsContent {...props} />;
  return <CodexHomeScope active={props.active}><ScopedCommunitySkills {...props} /></CodexHomeScope>;
}

function ScopedCommunitySkills(props: CommunitySkillsMarketProps) {
  const homeId = useSelectedCodexHome();
  return <CommunitySkillsContent {...props} homeId={homeId} />;
}

function CommunitySkillsContent({
  active,
  activeTab,
  authenticated,
  baseUrl,
  currentUserId,
  notify,
  onLogin,
  onTabChange,
  t,
  homeId,
}: CommunitySkillsMarketProps & { homeId?: string }) {
  const { items, loading, error, busyAction, load, install, setEnabled, remove } = useCommunitySkills({
    homeId, notify, t,
  });
  const [query, setQuery] = useState("");
  const [chromeBusy, setChromeBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<SkillMarketItem | null>(null);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.title}\n${item.description}`
      .toLocaleLowerCase().includes(needle));
  }, [items, query]);
  const detailSkill = detailSkillId
    ? items.find((item) => item.id === detailSkillId) ?? null
    : null;

  const openPublish = () => {
    if (!authenticated) {
      onLogin();
      return;
    }
    setPublishing(true);
  };

  const markPreviewBroken = (skillId: string) => {
    setBrokenPreviews((current) => new Set(current).add(skillId));
  };
  const browserCard = isDesktopApp && homeId && (chromeBusy || chromePluginMatches(query))
    ? <ChromePluginCard key={homeId} homeId={homeId} active={active} onBusyChange={setChromeBusy} /> : null;

  return (
    <div className="skills-market-page">
      <SkillsMarketToolbar
        active={active}
        activeTab={activeTab}
        loading={loading || busyAction !== null}
        onPublish={openPublish}
        onQueryChange={setQuery}
        onRefresh={() => void load()}
        onTabChange={onTabChange}
        query={query}
        t={t}
        homeSelector={homeId && <CodexHomeSelect disabled={busyAction !== null || chromeBusy} />}
      />

      {!authenticated && (
        <button type="button" className="skills-login-notice" onClick={onLogin}>
          <PackageOpen size={18} />
          <span><b>{t("skills.login.title")}</b><small>{t("skills.login.description")}</small></span>
        </button>
      )}

      {error && <div className="skills-market-error" role="alert">{error}</div>}
      {(browserCard || filtered.length > 0) && (
        <SkillMarketGrid
          leadingCard={browserCard}
          authenticated={authenticated}
          baseUrl={baseUrl}
          brokenPreviews={brokenPreviews}
          busyAction={busyAction}
          currentUserId={currentUserId}
          items={filtered}
          onEdit={setEditing}
          onInstall={install}
          onRemove={remove}
          onSetEnabled={setEnabled}
          onOpen={setDetailSkillId}
          onPreviewError={markPreviewBroken}
          t={t}
        />
      )}
      {loading && items.length === 0 && (
        <div className="skills-market-state"><LoaderCircle className="spin" size={22} />{t("skills.loading")}</div>
      )}
      {!loading && !browserCard && filtered.length === 0 && (
        <div className="skills-market-state"><PackageOpen size={26} />{t("skills.empty")}</div>
      )}

      {detailSkill && (
        <SkillDetailModal
          busyAction={busyAction}
          isPublisher={Boolean(
            authenticated
            && currentUserId
            && detailSkill.uploaderId === currentUserId,
          )}
          onClose={() => setDetailSkillId(null)}
          onEdit={(skill) => {
            setDetailSkillId(null);
            setEditing(skill);
          }}
          onInstall={install}
          onRemove={remove}
          onSetEnabled={setEnabled}
          onPreviewError={markPreviewBroken}
          preview={skillPreviewUrl(baseUrl, detailSkill)}
          previewBroken={brokenPreviews.has(detailSkill.id)}
          skill={detailSkill}
          t={t}
        />
      )}

      {(publishing || editing) && (
        <SkillPublishModal
          editing={editing}
          onClose={() => {
            setPublishing(false);
            setEditing(null);
          }}
          onPublished={async () => {
            notify(editing ? t("skills.toast.publishedUpdate") : t("skills.toast.published"));
            await load();
          }}
          t={t}
        />
      )}
    </div>
  );
}
