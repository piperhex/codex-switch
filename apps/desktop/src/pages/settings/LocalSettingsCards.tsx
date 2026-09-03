import { Button, Switch } from "antd";
import { FileDown, FolderOpen, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { CodexHomeSettingsCard } from "./CodexHomeSettingsCard";
import { DurationTimePicker } from "./DurationTimePicker";
import type { SettingsPageProps } from "./types";

function AutoRefreshCard({ settings }: { settings: SettingsPageProps }) {
  const { autoRefreshEnabled, autoRefreshSeconds, onEnabledChange, onSecondsChange, t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><RefreshCw size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.autoRefresh.title")}</h3><p>{t("settings.autoRefresh.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="auto-refresh-enabled">{t("settings.autoRefresh.enabled")}</label>
          <Switch
            id="auto-refresh-enabled"
            checked={autoRefreshEnabled}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={onEnabledChange}
          />
          <label htmlFor="auto-refresh-interval">{t("settings.autoRefresh.interval")}</label>
          <DurationTimePicker
            id="auto-refresh-interval"
            value={autoRefreshSeconds}
            disabled={!autoRefreshEnabled}
            onChange={onSecondsChange}
          />
        </div>
      </div>
    </section>
  );
}

function AccountAutoRefreshCard({ settings }: { settings: SettingsPageProps }) {
  const {
    accountAutoRefreshEnabled,
    accountAutoRefreshSeconds,
    currentAutoRefreshTarget,
    onAccountAutoRefreshEnabledChange,
    onAccountAutoRefreshSecondsChange,
    t,
  } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><RefreshCw size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.accountAutoRefresh.title")}</h3>
          <p>{t("settings.accountAutoRefresh.description")}</p>
          <p className="settings-current-account">
            {currentAutoRefreshTarget
              ? t("settings.accountAutoRefresh.current", { email: currentAutoRefreshTarget })
              : t("settings.accountAutoRefresh.none")}
          </p>
        </div>
        <div className="settings-field">
          <label htmlFor="account-auto-refresh-enabled">{t("settings.autoRefresh.enabled")}</label>
          <Switch
            id="account-auto-refresh-enabled"
            checked={accountAutoRefreshEnabled}
            disabled={!currentAutoRefreshTarget}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={onAccountAutoRefreshEnabledChange}
          />
          <label htmlFor="account-auto-refresh-interval">{t("settings.autoRefresh.interval")}</label>
          <DurationTimePicker
            id="account-auto-refresh-interval"
            value={accountAutoRefreshSeconds}
            disabled={!currentAutoRefreshTarget || !accountAutoRefreshEnabled}
            onChange={onAccountAutoRefreshSecondsChange}
          />
        </div>
      </div>
    </section>
  );
}

function AccountStoreCard({ settings }: { settings: SettingsPageProps }) {
  const { t } = settings;
  const path = settings.info?.accountStore;
  return (
    <section className="settings-card">
      <div className="settings-icon"><KeyRound size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.accountStore.title")}</h3>
          <p>{t("settings.accountStore.description")}</p>
          <code>{path ?? t("settings.loading")}</code>
        </div>
        <Button
          size="small"
          icon={<FolderOpen size={14} />}
          disabled={!path}
          onClick={settings.onOpenAccountStore}
        >
          {t("settings.openFolder")}
        </Button>
      </div>
    </section>
  );
}

function SecurityCard({ settings }: { settings: SettingsPageProps }) {
  const { t } = settings;
  return (
    <section className="settings-card note-card">
      <div className="settings-icon"><ShieldCheck size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.security.title")}</h3><p>{t("settings.security.description")}</p>
        </div>
      </div>
    </section>
  );
}

function LogsCard({ settings }: { settings: SettingsPageProps }) {
  const { exportingLogs, onExportLogs, t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><FileDown size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.logs.title")}</h3><p>{t("settings.logs.description")}</p>
        </div>
        <Button
          size="small"
          icon={<FileDown size={14} />}
          loading={exportingLogs}
          onClick={onExportLogs}
        >
          {t("settings.logs.export")}
        </Button>
      </div>
    </section>
  );
}

export function RefreshSettingsCards({ settings }: { settings: SettingsPageProps }) {
  return (
    <>
      <AutoRefreshCard settings={settings} />
      <AccountAutoRefreshCard settings={settings} />
    </>
  );
}

export function SecuritySettingsCard({ settings }: { settings: SettingsPageProps }) {
  return <SecurityCard settings={settings} />;
}

export function StorageSettingsCards({ settings }: { settings: SettingsPageProps }) {
  return (
    <>
      <CodexHomeSettingsCard settings={settings} />
      <AccountStoreCard settings={settings} />
      <LogsCard settings={settings} />
    </>
  );
}
