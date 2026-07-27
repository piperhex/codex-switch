import { useEffect, useState, type CSSProperties } from "react";
import { Button, ColorPicker, Input, InputNumber, Modal, Segmented, Space, Switch, TimePicker } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { CalendarDays, CircleGauge, Cloud, EyeOff, FileDown, FolderKey, FolderOpen, KeyRound, Languages, LayoutGrid, Palette, RefreshCw, ShieldCheck, TableProperties } from "lucide-react";
import { MAX_AUTO_REFRESH_SECONDS, MIN_AUTO_REFRESH_SECONDS } from "../hooks/useAutoRefresh";
import { MAX_TOKEN_USAGE_REFRESH_SECONDS, MAX_TOKEN_USAGE_WEEKS, MIN_TOKEN_USAGE_REFRESH_SECONDS, MIN_TOKEN_USAGE_WEEKS } from "../hooks/useTokenUsagePreferences";
import type { AccountDisplayMode } from "../hooks/useAccountDisplayMode";
import { DEFAULT_CLOUD_BASE_URL } from "../api/backend";
import { LANGUAGE_OPTIONS, type Language, type Translate } from "../i18n";
import type { AppInfo, BubbleResetDisplay, BubbleStyle } from "../types";

const DURATION_FORMAT = "HH:mm:ss";
const CLASSIC_BUBBLE_PREVIEW_STYLE = {
  "--bubble-progress": "57%",
  "--bubble-color": "#35ada7",
  "--bubble-water-level": "65%",
  "--bubble-water-top": "#20b7ed",
  "--bubble-water-color": "#0b93d9",
  "--bubble-water-bottom": "#0873d5",
} as CSSProperties;

function range(end: number) {
  return Array.from({ length: end }, (_, index) => index);
}

function secondsToDuration(seconds: number) {
  return dayjs().startOf("day").add(seconds, "second");
}

function durationToSeconds(value: Dayjs) {
  return value.hour() * 3600 + value.minute() * 60 + value.second();
}

function DurationTimePicker({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: number;
  disabled: boolean;
  onChange: (value: number | string | null) => void;
}) {
  const disabledTime = () => ({
    disabledHours: () => range(24).filter((hour) => {
      const firstSecond = hour * 3600;
      const lastSecond = firstSecond + 3599;
      return firstSecond > MAX_AUTO_REFRESH_SECONDS || lastSecond < MIN_AUTO_REFRESH_SECONDS;
    }),
    disabledMinutes: (hour: number) => range(60).filter((minute) => {
      const firstSecond = hour * 3600 + minute * 60;
      const lastSecond = firstSecond + 59;
      return firstSecond > MAX_AUTO_REFRESH_SECONDS || lastSecond < MIN_AUTO_REFRESH_SECONDS;
    }),
    disabledSeconds: (hour: number, minute: number) => range(60).filter((second) => {
      const duration = hour * 3600 + minute * 60 + second;
      return duration < MIN_AUTO_REFRESH_SECONDS || duration > MAX_AUTO_REFRESH_SECONDS;
    }),
  });

  return (
    <TimePicker
      id={id}
      className="duration-time-picker"
      value={secondsToDuration(value)}
      format={DURATION_FORMAT}
      placeholder="00:00:00"
      allowClear={false}
      showNow={false}
      disabled={disabled}
      disabledTime={disabledTime}
      onChange={(nextValue) => {
        if (nextValue) onChange(durationToSeconds(nextValue));
      }}
    />
  );
}

export function SettingsPage({
  info,
  autoRefreshEnabled,
  autoRefreshSeconds,
  onEnabledChange,
  onSecondsChange,
  currentAccountEmail,
  accountAutoRefreshEnabled,
  accountAutoRefreshSeconds,
  onAccountAutoRefreshEnabledChange,
  onAccountAutoRefreshSecondsChange,
  themeColor,
  themeColorLoading,
  onThemeColorChange,
  cloudBaseUrl,
  cloudBaseUrlLoading,
  cloudAuthenticated,
  onCloudBaseUrlSave,
  floatingBubbleEnabled,
  floatingBubbleLoading,
  onFloatingBubbleChange,
  bubbleResetDisplay,
  bubbleResetDisplayLoading,
  onBubbleResetDisplayChange,
  bubbleStyle,
  bubbleStyleLoading,
  onBubbleStyleChange,
  privacyModeEnabled,
  privacyModeLoading,
  onPrivacyModeChange,
  accountDisplayMode,
  onAccountDisplayModeChange,
  tokenUsageWeeks,
  tokenUsageRefreshSeconds,
  tokenUsagePreferencesLoading,
  onTokenUsageWeeksChange,
  onTokenUsageRefreshSecondsChange,
  onOpenCodexHome,
  onOpenAccountStore,
  onExportLogs,
  exportingLogs,
  language,
  onLanguageChange,
  t,
}: {
  info: AppInfo | null;
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
  onEnabledChange: (enabled: boolean) => void;
  onSecondsChange: (value: number | string | null) => void;
  currentAccountEmail: string | null;
  accountAutoRefreshEnabled: boolean;
  accountAutoRefreshSeconds: number;
  onAccountAutoRefreshEnabledChange: (enabled: boolean) => void;
  onAccountAutoRefreshSecondsChange: (value: number | string | null) => void;
  themeColor: string;
  themeColorLoading: boolean;
  onThemeColorChange: (color: string) => void;
  cloudBaseUrl: string;
  cloudBaseUrlLoading: boolean;
  cloudAuthenticated: boolean;
  onCloudBaseUrlSave: (baseUrl: string) => Promise<void> | void;
  floatingBubbleEnabled: boolean;
  floatingBubbleLoading: boolean;
  onFloatingBubbleChange: (enabled: boolean) => void;
  bubbleResetDisplay: BubbleResetDisplay;
  bubbleResetDisplayLoading: boolean;
  onBubbleResetDisplayChange: (display: BubbleResetDisplay) => void;
  bubbleStyle: BubbleStyle;
  bubbleStyleLoading: boolean;
  onBubbleStyleChange: (style: BubbleStyle) => void;
  privacyModeEnabled: boolean;
  privacyModeLoading: boolean;
  onPrivacyModeChange: (enabled: boolean) => void;
  accountDisplayMode: AccountDisplayMode;
  onAccountDisplayModeChange: (mode: AccountDisplayMode) => void;
  tokenUsageWeeks: number;
  tokenUsageRefreshSeconds: number;
  tokenUsagePreferencesLoading: boolean;
  onTokenUsageWeeksChange: (value: number | string | null) => void;
  onTokenUsageRefreshSecondsChange: (value: number | string | null) => void;
  onOpenCodexHome: () => void;
  onOpenAccountStore: () => void;
  onExportLogs: () => void;
  exportingLogs: boolean;
  language: Language;
  onLanguageChange: (language: Language) => void;
  t: Translate;
}) {
  const [cloudBaseUrlDraft, setCloudBaseUrlDraft] = useState(cloudBaseUrl);
  const [bubbleStyleModalOpen, setBubbleStyleModalOpen] = useState(false);
  const usingOfficialCloudServer = cloudBaseUrlDraft.trim().replace(/\/+$/, "").toLowerCase()
    === DEFAULT_CLOUD_BASE_URL.toLowerCase();

  useEffect(() => {
    setCloudBaseUrlDraft(cloudBaseUrl);
  }, [cloudBaseUrl]);

  return (
    <div className="settings-page">
      <section className="settings-card">
        <div className="settings-icon"><Languages size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.language.title")}</h3><p>{t("settings.language.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="language-selector">{t("settings.language.label")}</label>
            <Segmented id="language-selector" value={language} options={[...LANGUAGE_OPTIONS]}
              onChange={(value) => onLanguageChange(value as Language)} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><Cloud size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.cloud.title")}</h3><p>{t("settings.cloud.description")}</p>
            <p className="cloud-settings-status">
              {cloudBaseUrl
                ? cloudAuthenticated ? t("settings.cloud.signedIn") : t("settings.cloud.enabled")
                : t("settings.cloud.localMode")}
            </p>
          </div>
          <div className="settings-field settings-field-wide">
            <label htmlFor="cloud-base-url">{t("settings.cloud.label")}</label>
            <Input id="cloud-base-url" value={cloudBaseUrlDraft} disabled={cloudBaseUrlLoading}
              allowClear placeholder={t("settings.cloud.placeholder")}
              onChange={(event) => setCloudBaseUrlDraft(event.target.value)}
              onBlur={() => {
                if (cloudBaseUrlDraft !== cloudBaseUrl) void onCloudBaseUrlSave(cloudBaseUrlDraft);
              }} />
            {!usingOfficialCloudServer && (
              <Button size="small" disabled={cloudBaseUrlLoading} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                setCloudBaseUrlDraft(DEFAULT_CLOUD_BASE_URL);
                void onCloudBaseUrlSave(DEFAULT_CLOUD_BASE_URL);
              }}>
                {t("settings.cloud.useOfficial")}
              </Button>
            )}
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><Palette size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.theme.title")}</h3><p>{t("settings.theme.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="theme-color-picker">{t("settings.theme.label")}</label>
            <span id="theme-color-picker" className="theme-color-picker">
              <ColorPicker value={themeColor} disabled={themeColorLoading}
                showText disabledAlpha format="hex"
                onChangeComplete={(color) => onThemeColorChange(color.toHexString())} />
            </span>
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><CircleGauge size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.floatingBubble.title")}</h3><p>{t("settings.floatingBubble.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="floating-bubble-enabled">{t("settings.floatingBubble.enabled")}</label>
            <Switch id="floating-bubble-enabled" checked={floatingBubbleEnabled} loading={floatingBubbleLoading}
              checkedChildren={t("settings.autoRefresh.on")} unCheckedChildren={t("settings.autoRefresh.off")}
              onChange={onFloatingBubbleChange} />
            <label htmlFor="floating-bubble-reset-display">{t("settings.floatingBubble.resetDisplay")}</label>
            <Segmented id="floating-bubble-reset-display" value={bubbleResetDisplay} disabled={bubbleResetDisplayLoading}
              options={[
                { value: "countdown", label: t("settings.floatingBubble.countdown") },
                { value: "resetAt", label: t("settings.floatingBubble.resetAt") },
              ]}
              onChange={(value) => onBubbleResetDisplayChange(value as BubbleResetDisplay)} />
            <label>{t("settings.floatingBubble.style")}</label>
            <Button className="floating-bubble-style-trigger" onClick={() => setBubbleStyleModalOpen(true)}>
              {t("settings.floatingBubble.chooseStyle")}
            </Button>
          </div>
        </div>
      </section>
      <Modal
        open={bubbleStyleModalOpen}
        footer={null}
        width={760}
        title={t("settings.floatingBubble.styleModalTitle")}
        onCancel={() => setBubbleStyleModalOpen(false)}
      >
        <p className="floating-bubble-style-modal-description">{t("settings.floatingBubble.styleModalDescription")}</p>
        <div className="floating-bubble-style-options">
          <button type="button" className={`floating-bubble-style-option ${bubbleStyle === "classic" ? "is-selected" : ""}`}
            disabled={bubbleStyleLoading} onClick={() => onBubbleStyleChange("classic")}>
            <span className="floating-bubble-style-preview classic" aria-hidden="true">
              <span className="floating-bubble floating-bubble-demo" style={CLASSIC_BUBBLE_PREVIEW_STYLE}>
                <span className="floating-bubble-water" />
                <span className="floating-bubble-weekly">{t("settings.floatingBubble.weekShort")} 57%</span>
                <span className="floating-bubble-value">65%</span>
                <small className="floating-bubble-reset floating-bubble-reset-stacked">
                  <span>0{t("settings.floatingBubble.dayShort")}</span>
                  <span>01:28:39</span>
                </small>
              </span>
            </span>
            <span className="floating-bubble-style-option-copy"><strong>{t("settings.floatingBubble.classic")}</strong><small>{t("settings.floatingBubble.classicDescription")}</small></span>
          </button>
          <button type="button" className={`floating-bubble-style-option ${bubbleStyle === "glass" ? "is-selected" : ""}`}
            disabled={bubbleStyleLoading} onClick={() => onBubbleStyleChange("glass")}>
            <span className="floating-bubble-style-preview glass" aria-hidden="true">
              <span className="glass-preview-ring"><b>5%</b><small>{t("settings.floatingBubble.primaryRemaining")}</small></span>
              <span className="glass-preview-stats">
                <span>{t("settings.floatingBubble.distanceToReset")}<b>3d 18h</b></span>
                <span>{t("settings.floatingBubble.remainingResets")}<b>0</b></span>
                <span>{t("settings.floatingBubble.secondaryUsed")}<b>95%</b></span>
                <span>{t("settings.floatingBubble.quotaStatus")}<b>{t("settings.floatingBubble.lowQuota")}</b></span>
              </span>
            </span>
            <span className="floating-bubble-style-option-copy"><strong>{t("settings.floatingBubble.glass")}</strong><small>{t("settings.floatingBubble.glassDescription")}</small></span>
          </button>
        </div>
      </Modal>
      <section className="settings-card">
        <div className="settings-icon"><EyeOff size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.privacy.title")}</h3><p>{t("settings.privacy.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="privacy-mode-enabled">{t("settings.privacy.enabled")}</label>
            <Switch id="privacy-mode-enabled" checked={privacyModeEnabled} loading={privacyModeLoading}
              checkedChildren={t("settings.autoRefresh.on")} unCheckedChildren={t("settings.autoRefresh.off")}
              onChange={onPrivacyModeChange} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><LayoutGrid size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.accountDisplay.title")}</h3><p>{t("settings.accountDisplay.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="account-display-mode">{t("settings.accountDisplay.label")}</label>
            <Segmented id="account-display-mode" value={accountDisplayMode}
              options={[
                { value: "table", label: <span className="segmented-option-label"><TableProperties size={14} />{t("settings.accountDisplay.table")}</span> },
                { value: "cards", label: <span className="segmented-option-label"><LayoutGrid size={14} />{t("settings.accountDisplay.cards")}</span> },
              ]}
              onChange={(value) => onAccountDisplayModeChange(value as AccountDisplayMode)} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><CalendarDays size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.tokenUsage.title")}</h3><p>{t("settings.tokenUsage.description")}</p></div>
          <div className="settings-field token-usage-settings-field">
            <label htmlFor="token-usage-weeks">{t("settings.tokenUsage.weeks")}</label>
            <Space.Compact>
              <InputNumber id="token-usage-weeks" min={MIN_TOKEN_USAGE_WEEKS} max={MAX_TOKEN_USAGE_WEEKS}
                step={1} value={tokenUsageWeeks} disabled={tokenUsagePreferencesLoading}
                onChange={onTokenUsageWeeksChange} />
              <Button disabled>{t("settings.tokenUsage.weeksUnit")}</Button>
            </Space.Compact>
            <label htmlFor="token-usage-refresh-interval">{t("settings.tokenUsage.refreshInterval")}</label>
            <Space.Compact>
              <InputNumber id="token-usage-refresh-interval" min={MIN_TOKEN_USAGE_REFRESH_SECONDS}
                max={MAX_TOKEN_USAGE_REFRESH_SECONDS} step={1} value={tokenUsageRefreshSeconds}
                disabled={tokenUsagePreferencesLoading} onChange={onTokenUsageRefreshSecondsChange} />
              <Button disabled>{t("settings.autoRefresh.seconds")}</Button>
            </Space.Compact>
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><RefreshCw size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.autoRefresh.title")}</h3><p>{t("settings.autoRefresh.description")}</p></div>
          <div className="settings-field">
            <label htmlFor="auto-refresh-enabled">{t("settings.autoRefresh.enabled")}</label>
            <Switch id="auto-refresh-enabled" checked={autoRefreshEnabled} checkedChildren={t("settings.autoRefresh.on")} unCheckedChildren={t("settings.autoRefresh.off")}
              onChange={onEnabledChange} />
            <label htmlFor="auto-refresh-interval">{t("settings.autoRefresh.interval")}</label>
            <DurationTimePicker id="auto-refresh-interval" value={autoRefreshSeconds}
              disabled={!autoRefreshEnabled} onChange={onSecondsChange} />
          </div>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon"><RefreshCw size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.accountAutoRefresh.title")}</h3><p>{t("settings.accountAutoRefresh.description")}</p>
            <p className="settings-current-account">
              {currentAccountEmail
                ? t("settings.accountAutoRefresh.current", { email: currentAccountEmail })
                : t("settings.accountAutoRefresh.none")}
            </p>
          </div>
          <div className="settings-field">
            <label htmlFor="account-auto-refresh-enabled">{t("settings.autoRefresh.enabled")}</label>
            <Switch id="account-auto-refresh-enabled" checked={accountAutoRefreshEnabled}
              disabled={!currentAccountEmail} checkedChildren={t("settings.autoRefresh.on")}
              unCheckedChildren={t("settings.autoRefresh.off")} onChange={onAccountAutoRefreshEnabledChange} />
            <label htmlFor="account-auto-refresh-interval">{t("settings.autoRefresh.interval")}</label>
            <DurationTimePicker id="account-auto-refresh-interval" value={accountAutoRefreshSeconds}
              disabled={!currentAccountEmail || !accountAutoRefreshEnabled}
              onChange={onAccountAutoRefreshSecondsChange} />
          </div>
        </div>
      </section>
      <section className="settings-card"><div className="settings-icon"><FolderKey size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy">
            <h3>Codex Home</h3><p>{t("settings.codexHome.description")}</p>
            <code>{info?.codexHome ?? t("settings.loading")}</code>
          </div>
          <Button size="small" icon={<FolderOpen size={14} />} disabled={!info?.codexHome}
            onClick={onOpenCodexHome}>{t("settings.openFolder")}</Button>
        </div></section>
      <section className="settings-card"><div className="settings-icon"><KeyRound size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy">
            <h3>{t("settings.accountStore.title")}</h3><p>{t("settings.accountStore.description")}</p>
            <code>{info?.accountStore ?? t("settings.loading")}</code>
          </div>
          <Button size="small" icon={<FolderOpen size={14} />} disabled={!info?.accountStore}
            onClick={onOpenAccountStore}>{t("settings.openFolder")}</Button>
        </div></section>
      <section className="settings-card note-card"><div className="settings-icon"><ShieldCheck size={23} /></div>
        <div className="settings-card-content"><div className="settings-card-copy"><h3>{t("settings.security.title")}</h3><p>{t("settings.security.description")}</p></div></div></section>
      <section className="settings-card"><div className="settings-icon"><FileDown size={23} /></div>
        <div className="settings-card-content">
          <div className="settings-card-copy"><h3>{t("settings.logs.title")}</h3><p>{t("settings.logs.description")}</p></div>
          <Button size="small" icon={<FileDown size={14} />} loading={exportingLogs}
            onClick={onExportLogs}>{t("settings.logs.export")}</Button>
        </div></section>
    </div>
  );
}
