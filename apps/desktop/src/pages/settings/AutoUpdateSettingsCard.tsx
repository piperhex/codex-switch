import { Switch } from "antd";
import { Download } from "lucide-react";
import type { SettingsPageProps } from "./types";

export function AutoUpdateSettingsCard({ settings }: { settings: SettingsPageProps }) {
  const { autoUpdateEnabled, onAutoUpdateChange, t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><Download size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.autoUpdate.title")}</h3>
          <p>{t("settings.autoUpdate.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="auto-update-enabled">{t("settings.autoUpdate.label")}</label>
          <Switch
            id="auto-update-enabled"
            checked={autoUpdateEnabled}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={onAutoUpdateChange}
          />
        </div>
      </div>
    </section>
  );
}
