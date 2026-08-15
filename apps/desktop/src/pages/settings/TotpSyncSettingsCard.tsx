import { Switch, Tooltip } from "antd";
import { ShieldCheck } from "lucide-react";
import type { SettingsPageProps } from "./types";

export function TotpSyncSettingsCard({ settings }: { settings: SettingsPageProps }) {
  const {
    cloudAuthenticated,
    onTotpCloudSyncChange,
    t,
    totpCloudSyncEnabled,
    totpCloudSyncLoading,
  } = settings;
  const disabled = (!cloudAuthenticated && !totpCloudSyncEnabled) || totpCloudSyncLoading;
  return (
    <section className="settings-card totp-sync-settings-card">
      <div className="settings-icon"><ShieldCheck size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.totpSync.title")}</h3>
          <p>{t("settings.totpSync.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="totp-cloud-sync-enabled">{t("settings.totpSync.label")}</label>
          <Tooltip title={cloudAuthenticated || totpCloudSyncEnabled
            ? null
            : t("settings.totpSync.loginRequired")}
            styles={{ root: { maxWidth: 400 } }}>
            <span>
              <Switch id="totp-cloud-sync-enabled" checked={totpCloudSyncEnabled}
                disabled={disabled} loading={totpCloudSyncLoading}
                checkedChildren={t("settings.autoRefresh.on")}
                unCheckedChildren={t("settings.autoRefresh.off")}
                onChange={onTotpCloudSyncChange} />
            </span>
          </Tooltip>
        </div>
      </div>
    </section>
  );
}
