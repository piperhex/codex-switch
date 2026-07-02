import { Button, InputNumber, Segmented, Space, Switch } from "antd";
import { CircleGauge, FolderKey, KeyRound, Languages, RefreshCw, ShieldCheck } from "lucide-react";
import { MAX_AUTO_REFRESH_SECONDS, MIN_AUTO_REFRESH_SECONDS } from "../hooks/useAutoRefresh";
import { LANGUAGE_OPTIONS, type Language, type Translate } from "../i18n";
import type { AppInfo } from "../types";

export function SettingsPage({
  info,
  autoRefreshEnabled,
  autoRefreshSeconds,
  onEnabledChange,
  onSecondsChange,
  floatingBubbleEnabled,
  floatingBubbleLoading,
  onFloatingBubbleChange,
  language,
  onLanguageChange,
  t,
}: {
  info: AppInfo | null;
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
  onEnabledChange: (enabled: boolean) => void;
  onSecondsChange: (value: number | string | null) => void;
  floatingBubbleEnabled: boolean;
  floatingBubbleLoading: boolean;
  onFloatingBubbleChange: (enabled: boolean) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  t: Translate;
}) {
  return (
    <div className="settings-page">
      <section className="settings-card">
        <div className="settings-icon"><Languages size={23} /></div>
        <div><h3>{t("settings.language.title")}</h3><p>{t("settings.language.description")}</p>
          <div className="settings-field">
            <label htmlFor="language-selector">{t("settings.language.label")}</label>
            <Segmented id="language-selector" value={language} options={[...LANGUAGE_OPTIONS]}
              onChange={(value) => onLanguageChange(value as Language)} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><CircleGauge size={23} /></div>
        <div><h3>{t("settings.floatingBubble.title")}</h3><p>{t("settings.floatingBubble.description")}</p>
          <div className="settings-field">
            <label htmlFor="floating-bubble-enabled">{t("settings.floatingBubble.enabled")}</label>
            <Switch id="floating-bubble-enabled" checked={floatingBubbleEnabled} loading={floatingBubbleLoading}
              checkedChildren={t("settings.autoRefresh.on")} unCheckedChildren={t("settings.autoRefresh.off")}
              onChange={onFloatingBubbleChange} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><RefreshCw size={23} /></div>
        <div><h3>{t("settings.autoRefresh.title")}</h3><p>{t("settings.autoRefresh.description")}</p>
          <div className="settings-field">
            <label htmlFor="auto-refresh-enabled">{t("settings.autoRefresh.enabled")}</label>
            <Switch id="auto-refresh-enabled" checked={autoRefreshEnabled} checkedChildren={t("settings.autoRefresh.on")} unCheckedChildren={t("settings.autoRefresh.off")}
              onChange={onEnabledChange} />
            <label htmlFor="auto-refresh-interval">{t("settings.autoRefresh.interval")}</label>
            <Space.Compact>
              <InputNumber id="auto-refresh-interval" min={MIN_AUTO_REFRESH_SECONDS} max={MAX_AUTO_REFRESH_SECONDS}
                step={1} value={autoRefreshSeconds} disabled={!autoRefreshEnabled} onChange={onSecondsChange} />
              <Button disabled>{t("settings.autoRefresh.seconds")}</Button>
            </Space.Compact>
          </div>
        </div>
      </section>
      <section className="settings-card"><div className="settings-icon"><FolderKey size={23} /></div>
        <div><h3>Codex Home</h3><p>{t("settings.codexHome.description")}</p>
          <code>{info?.codexHome ?? t("settings.loading")}</code></div></section>
      <section className="settings-card"><div className="settings-icon"><KeyRound size={23} /></div>
        <div><h3>{t("settings.accountStore.title")}</h3><p>{t("settings.accountStore.description")}</p>
          <code>{info?.accountStore ?? t("settings.loading")}</code></div></section>
      <section className="settings-card note-card"><div className="settings-icon"><ShieldCheck size={23} /></div>
        <div><h3>{t("settings.security.title")}</h3><p>{t("settings.security.description")}</p></div></section>
    </div>
  );
}
