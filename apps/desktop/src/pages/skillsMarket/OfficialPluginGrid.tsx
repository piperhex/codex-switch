import { Check, Download, LoaderCircle, Puzzle } from "lucide-react";
import { useState } from "react";
import type { OfficialPluginItem } from "../../types";
import type { OfficialPluginGridProps } from "./types";

function PluginIcon({ plugin }: { plugin: OfficialPluginItem }) {
  const [failed, setFailed] = useState(false);
  if (!plugin.iconUrl || failed) {
    return <Puzzle size={42} />;
  }
  return <img src={plugin.iconUrl} alt="" onError={() => setFailed(true)} />;
}

function InstallIcon({ busy, installed }: { busy: boolean; installed: boolean }) {
  if (busy) return <LoaderCircle className="spin" size={16} />;
  if (installed) return <Check size={16} />;
  return <Download size={16} />;
}

function installLabel(plugin: OfficialPluginItem, busy: boolean, t: OfficialPluginGridProps["t"]) {
  if (busy) return t("skills.official.installing");
  if (plugin.installed) return t("skills.official.installed");
  return t("skills.official.install");
}

function OfficialPluginCard({
  busyPluginId,
  onInstall,
  plugin,
  t,
}: Omit<OfficialPluginGridProps, "items"> & { plugin: OfficialPluginItem }) {
  const busy = busyPluginId === plugin.id;
  const previewStyle = plugin.brandColor
    ? { background: `linear-gradient(145deg, ${plugin.brandColor}22, ${plugin.brandColor}66)` }
    : undefined;
  return (
    <article className="skill-card official-plugin-card">
      <div className="skill-card-preview official-plugin-preview" style={previewStyle}>
        <div className="official-plugin-icon"><PluginIcon plugin={plugin} /></div>
        <span className="skill-official-badge">{t("skills.official.badge")}</span>
        <span className="skill-version">v{plugin.version}</span>
      </div>
      <div className="skill-card-body">
        <div className="skill-card-title"><h3>{plugin.title}</h3></div>
        <p>{plugin.description}</p>
        <div className="skill-card-meta">
          <span>{plugin.developer}</span>
          <span>{plugin.category}</span>
        </div>
        <button
          type="button"
          className={`skill-install-button${plugin.installed ? " installed" : ""}`}
          disabled={busy || plugin.installed}
          onClick={() => void onInstall(plugin)}
        >
          <InstallIcon busy={busy} installed={plugin.installed} />
          {installLabel(plugin, busy, t)}
        </button>
      </div>
    </article>
  );
}

export function OfficialPluginGrid(props: OfficialPluginGridProps) {
  return (
    <div className="skills-market-grid">
      {props.items.map((plugin) => (
        <OfficialPluginCard
          key={plugin.id}
          busyPluginId={props.busyPluginId}
          onInstall={props.onInstall}
          plugin={plugin}
          t={props.t}
        />
      ))}
    </div>
  );
}
