import { Button, Switch } from "antd";
import { FileDown, FolderKey, FolderOpen, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
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

function FolderCard({
  options,
}: { options: {
  icon: "home" | "store";
  onOpen: () => void;
  path?: string;
  title: string;
  settings: SettingsPageProps;
} }) {
  const { icon, onOpen, path, title, settings } = options;
  const { t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon">
        {icon === "home" ? <FolderKey size={23} /> : <KeyRound size={23} />}
      </div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{title}</h3>
          <p>{t(icon === "home" ? "settings.codexHome.description" : "settings.accountStore.description")}</p>
          <code>{path ?? t("settings.loading")}</code>
        </div>
        <Button
          size="small"
          icon={<FolderOpen size={14} />}
          disabled={!path}
          onClick={onOpen}
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

export function LocalSettingsCards({ settings }: { settings: SettingsPageProps }) {
  return (
    <>
      <AutoRefreshCard settings={settings} />
      <AccountAutoRefreshCard settings={settings} />
      <FolderCard
        options={{
          icon: "home",
          onOpen: settings.onOpenCodexHome,
          path: settings.info?.codexHome,
          title: "Codex Home",
          settings,
        }}
      />
      <FolderCard
        options={{
          icon: "store",
          onOpen: settings.onOpenAccountStore,
          path: settings.info?.accountStore,
          title: settings.t("settings.accountStore.title"),
          settings,
        }}
      />
      <SecurityCard settings={settings} />
      <LogsCard settings={settings} />
    </>
  );
}
