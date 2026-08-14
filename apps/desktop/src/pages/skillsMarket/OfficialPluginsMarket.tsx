import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, Puzzle } from "lucide-react";
import {
  fetchOfficialPlugins,
  hasLocalBackend,
  installOfficialPlugin,
  removeOfficialPlugin,
  setOfficialPluginEnabled,
} from "../../api/backend";
import type { OfficialPluginItem } from "../../types";
import { OfficialPluginGrid } from "./OfficialPluginGrid";
import { SkillsMarketToolbar } from "./SkillsMarketToolbar";
import type {
  OfficialPluginAction,
  OfficialPluginBusyAction,
  OfficialPluginsMarketProps,
} from "./types";

const ACTION_TOAST = {
  disable: "skills.official.toast.disabled",
  enable: "skills.official.toast.enabled",
  install: "skills.official.toast.installed",
  remove: "skills.official.toast.uninstalled",
} as const;

export function OfficialPluginsMarket({
  active,
  activeTab,
  notify,
  onTabChange,
  t,
}: OfficialPluginsMarketProps) {
  const [items, setItems] = useState<OfficialPluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyAction, setBusyAction] = useState<OfficialPluginBusyAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchOfficialPlugins());
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
    return items.filter((item) => [item.title, item.name, item.description, item.category, item.developer]
      .join("\n").toLocaleLowerCase().includes(needle));
  }, [items, query]);

  const runAction = async (plugin: OfficialPluginItem, action: OfficialPluginAction) => {
    setBusyAction({ pluginId: plugin.id, action });
    setError(null);
    try {
      if (action === "install") {
        await installOfficialPlugin(plugin.id);
      } else if (action === "remove") {
        await removeOfficialPlugin(plugin.id);
      } else {
        await setOfficialPluginEnabled(plugin.id, action === "enable");
      }
      notify(t(ACTION_TOAST[action], { name: plugin.title }));
      await load();
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      setBusyAction(null);
    }
  };

  let content = (
    <OfficialPluginGrid
      items={filtered}
      busyAction={busyAction}
      onAction={runAction}
      t={t}
    />
  );
  if (!hasLocalBackend) {
    content = <div className="skills-market-state"><Puzzle size={26} />{t("skills.official.localOnly")}</div>;
  } else if (loading && items.length === 0) {
    content = (
      <div className="skills-market-state">
        <LoaderCircle className="spin" size={22} />{t("skills.official.loading")}
      </div>
    );
  } else if (filtered.length === 0) {
    content = <div className="skills-market-state"><Puzzle size={26} />{t("skills.official.empty")}</div>;
  }

  return (
    <div className="skills-market-page">
      <SkillsMarketToolbar
        active={active}
        activeTab={activeTab}
        loading={loading}
        onQueryChange={setQuery}
        onRefresh={() => void load()}
        onTabChange={onTabChange}
        query={query}
        t={t}
      />
      {error && <div className="skills-market-error" role="alert">{error}</div>}
      {content}
    </div>
  );
}
