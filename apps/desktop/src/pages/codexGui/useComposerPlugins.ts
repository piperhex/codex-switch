import { useEffect, useState } from "react";
import { guiApi } from "./api";
import type { ComposerPlugin, PluginsResponse } from "./attachmentTypes";

export function useComposerPlugins({ cwd, active }: { cwd: string; active: boolean }) {
  const [result, setResult] = useState({ cwd, plugins: [] as ComposerPlugin[], loading: false, error: "" });
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setResult({ cwd, plugins: [], loading: true, error: "" });
    void guiApi.request<PluginsResponse>({ operation: "plugins", cwd: cwd || undefined }).then((response) => {
      if (cancelled) return;
      const plugins = [...new Map(response.marketplaces.flatMap((marketplace) => marketplace.plugins)
        .filter((plugin) => plugin.installed && plugin.enabled).map((plugin) => [plugin.id, plugin])).values()];
      setResult({ cwd, plugins, loading: false,
        error: response.marketplaceLoadErrors.length ? "部分插件未能加载，请重新打开菜单重试。" : "" });
    }).catch(() => {
      if (!cancelled) setResult({ cwd, plugins: [], loading: false, error: "插件暂时无法加载，请重新打开菜单重试。" });
    });
    return () => { cancelled = true; };
  }, [cwd, active]);
  return result.cwd === cwd ? result : { plugins: [], loading: active, error: "" };
}
