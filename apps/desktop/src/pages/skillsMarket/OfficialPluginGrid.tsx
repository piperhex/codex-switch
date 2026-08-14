import { Download, LoaderCircle, Power, Puzzle, Trash2 } from "lucide-react";
import { useState } from "react";
import type { OfficialPluginItem } from "../../types";
import type { OfficialPluginAction, OfficialPluginGridProps } from "./types";

function PluginIcon({ plugin }: { plugin: OfficialPluginItem }) {
  const [failed, setFailed] = useState(false);
  if (!plugin.iconUrl || failed) {
    return <Puzzle size={42} />;
  }
  return <img src={plugin.iconUrl} alt="" onError={() => setFailed(true)} />;
}

function InstallIcon({ busy }: { busy: boolean }) {
  if (busy) return <LoaderCircle className="spin" size={16} />;
  return <Download size={16} />;
}

function toggleLabel(plugin: OfficialPluginItem, busy: boolean, t: OfficialPluginGridProps["t"]) {
  if (busy) return t(plugin.enabled ? "skills.official.disabling" : "skills.official.enabling");
  return t(plugin.enabled ? "skills.official.disable" : "skills.official.enable");
}

function installedActions(
  plugin: OfficialPluginItem,
  options: Omit<OfficialPluginGridProps, "items">,
) {
  const toggleAction: OfficialPluginAction = plugin.enabled ? "disable" : "enable";
  const toggleBusy = options.busyAction?.pluginId === plugin.id
    && options.busyAction.action === toggleAction;
  const removeBusy = options.busyAction?.pluginId === plugin.id
    && options.busyAction.action === "remove";
  const busy = options.busyAction?.pluginId === plugin.id;
  return (
    <div className="official-plugin-actions">
      <button
        type="button"
        className={`official-plugin-toggle${plugin.enabled ? " active" : ""}`}
        disabled={busy}
        onClick={() => void options.onAction(plugin, toggleAction)}
      >
        {toggleBusy ? <LoaderCircle className="spin" size={16} /> : <Power size={16} />}
        {toggleLabel(plugin, toggleBusy, options.t)}
      </button>
      <button
        type="button"
        className="skill-install-button uninstall"
        disabled={busy}
        onClick={() => void options.onAction(plugin, "remove")}
      >
        {removeBusy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
        {options.t(removeBusy ? "skills.official.uninstalling" : "skills.official.uninstall")}
      </button>
    </div>
  );
}

function OfficialPluginCard(options: Omit<OfficialPluginGridProps, "items"> & {
  plugin: OfficialPluginItem;
}) {
  const { plugin, t } = options;
  const installBusy = options.busyAction?.pluginId === plugin.id
    && options.busyAction.action === "install";
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
        {plugin.installed ? installedActions(plugin, options) : (
          <button
            type="button"
            className="skill-install-button"
            disabled={installBusy}
            onClick={() => void options.onAction(plugin, "install")}
          >
            <InstallIcon busy={installBusy} />
            {t(installBusy ? "skills.official.installing" : "skills.official.install")}
          </button>
        )}
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
          busyAction={props.busyAction}
          onAction={props.onAction}
          plugin={plugin}
          t={props.t}
        />
      ))}
    </div>
  );
}
