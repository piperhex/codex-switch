import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, PackageOpen } from "lucide-react";
import { fetchSkillMarket, installMarketSkill, skillPreviewUrl } from "../../api/backend";
import type { SkillMarketItem } from "../../types";
import { SkillDetailModal } from "./SkillDetailModal";
import { SkillMarketGrid } from "./SkillMarketGrid";
import { SkillPublishModal } from "./SkillPublishModal";
import { SkillsMarketToolbar } from "./SkillsMarketToolbar";
import type { CommunitySkillsMarketProps } from "./types";

export function CommunitySkillsMarket({
  activeTab,
  authenticated,
  baseUrl,
  currentUserId,
  notify,
  onLogin,
  onTabChange,
  t,
}: CommunitySkillsMarketProps) {
  const [items, setItems] = useState<SkillMarketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<SkillMarketItem | null>(null);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [busySkillId, setBusySkillId] = useState<string | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchSkillMarket());
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const install = async (skill: SkillMarketItem) => {
    setBusySkillId(skill.id);
    try {
      await installMarketSkill(skill);
      notify(skill.installedVersion ? t("skills.toast.updated") : t("skills.toast.installed"));
      await load();
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      setBusySkillId(null);
    }
  };

  const markPreviewBroken = (skillId: string) => {
    setBrokenPreviews((current) => new Set(current).add(skillId));
  };

  return (
    <div className="skills-market-page">
      <SkillsMarketToolbar
        activeTab={activeTab}
        loading={loading}
        onPublish={openPublish}
        onQueryChange={setQuery}
        onRefresh={() => void load()}
        onTabChange={onTabChange}
        query={query}
        t={t}
      />

      {!authenticated && (
        <button type="button" className="skills-login-notice" onClick={onLogin}>
          <PackageOpen size={18} />
          <span><b>{t("skills.login.title")}</b><small>{t("skills.login.description")}</small></span>
        </button>
      )}

      {error && <div className="skills-market-error" role="alert">{error}</div>}
      {loading && items.length === 0 ? (
        <div className="skills-market-state">
          <LoaderCircle className="spin" size={22} />{t("skills.loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="skills-market-state"><PackageOpen size={26} />{t("skills.empty")}</div>
      ) : (
        <SkillMarketGrid
          authenticated={authenticated}
          baseUrl={baseUrl}
          brokenPreviews={brokenPreviews}
          busySkillId={busySkillId}
          currentUserId={currentUserId}
          items={filtered}
          onEdit={setEditing}
          onInstall={install}
          onOpen={setDetailSkillId}
          onPreviewError={markPreviewBroken}
          t={t}
        />
      )}

      {detailSkill && (
        <SkillDetailModal
          busy={busySkillId === detailSkill.id}
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
