import { RefreshCw, Search, Upload } from "lucide-react";
import type { SkillsMarketToolbarProps } from "./types";

const TAB_COPY = {
  community: {
    description: "skills.description",
    heading: "skills.heading",
    kicker: "skills.kicker",
    search: "skills.search",
  },
  official: {
    description: "skills.official.description",
    heading: "skills.official.heading",
    kicker: "skills.official.kicker",
    search: "skills.official.search",
  },
} as const;

export function SkillsMarketToolbar({
  activeTab,
  loading,
  onPublish,
  onQueryChange,
  onRefresh,
  onTabChange,
  query,
  t,
}: SkillsMarketToolbarProps) {
  const copy = TAB_COPY[activeTab];
  return (
    <div className="skills-market-toolbar">
      <div className="skills-market-intro">
        <span>{t(copy.kicker)}</span>
        <div className="skills-market-heading-row">
          <h2>{t(copy.heading)}</h2>
          <div className="skills-market-tabs" role="tablist" aria-label={t("skills.tabs.label")}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "community"}
              className={activeTab === "community" ? "active" : ""}
              onClick={() => onTabChange("community")}
            >
              {t("skills.tabs.community")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "official"}
              className={activeTab === "official" ? "active" : ""}
              onClick={() => onTabChange("official")}
            >
              {t("skills.tabs.official")}
            </button>
          </div>
        </div>
        <p>{t(copy.description)}</p>
      </div>
      <div className="skills-market-toolbar-actions">
        <label className="skills-market-search">
          <Search size={16} />
          <input
            value={query}
            placeholder={t(copy.search)}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <button type="button" className="refresh-all" disabled={loading} onClick={onRefresh}>
          <RefreshCw className={loading ? "spin" : ""} size={16} />{t("skills.refresh")}
        </button>
        {onPublish && (
          <button type="button" className="primary-button" onClick={onPublish}>
            <Upload size={16} />{t("skills.publish.action")}
          </button>
        )}
      </div>
    </div>
  );
}
