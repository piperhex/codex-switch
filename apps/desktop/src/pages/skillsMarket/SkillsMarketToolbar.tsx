import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Search, Upload } from "lucide-react";
import type { SkillsMarketToolbarProps, SkillsMarketTab } from "./types";

const SEARCH_COPY = {
  community: "skills.search",
  official: "skills.official.search",
} as const satisfies Record<SkillsMarketTab, string>;

function useTopbarHost(active: boolean) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(active ? document.getElementById("skills-market-topbar-actions") : null);
  }, [active]);

  return host;
}

function SkillsMarketTabs({ activeTab, onTabChange, t }: Pick<SkillsMarketToolbarProps,
  "activeTab" | "onTabChange" | "t">) {
  return (
    <div className="skills-market-tabs" role="tablist" aria-label={t("skills.tabs.label")}>
      {(["community", "official"] as const).map((tab) => (
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          className={activeTab === tab ? "active" : ""}
          onClick={() => onTabChange(tab)}
          key={tab}
        >
          {t(`skills.tabs.${tab}`)}
        </button>
      ))}
    </div>
  );
}

function SkillsMarketActions(props: SkillsMarketToolbarProps) {
  return (
    <div className="skills-market-toolbar-actions">
      <label className="skills-market-search">
        <Search size={16} />
        <input
          value={props.query}
          placeholder={props.t(SEARCH_COPY[props.activeTab])}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
      </label>
      <button type="button" className="refresh-all" disabled={props.loading} onClick={props.onRefresh}>
        <RefreshCw className={props.loading ? "spin" : ""} size={16} />{props.t("skills.refresh")}
      </button>
      {props.onPublish && (
        <button type="button" className="primary-button" onClick={props.onPublish}>
          <Upload size={16} />{props.t("skills.publish.action")}
        </button>
      )}
    </div>
  );
}

export function SkillsMarketToolbar(props: SkillsMarketToolbarProps) {
  const topbarHost = useTopbarHost(props.active);
  if (!topbarHost) return null;

  return createPortal(
    <div className="skills-market-topbar-controls">
      <SkillsMarketTabs {...props} />
      <SkillsMarketActions {...props} />
    </div>,
    topbarHost,
  );
}
