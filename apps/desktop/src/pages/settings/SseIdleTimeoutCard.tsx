import { Switch } from "antd";
import { TimerReset } from "lucide-react";
import { MAX_SSE_IDLE_TIMEOUT_SECONDS } from "../../api/sseIdleTimeout";
import { DurationTimePicker } from "./DurationTimePicker";
import type { SettingsPageProps } from "./types";

export function SseIdleTimeoutCard({ settings }: { settings: SettingsPageProps }) {
  const { sseIdleTimeout: timeout, t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><TimerReset size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.sseIdleTimeout.title")}</h3>
          <p>{t("settings.sseIdleTimeout.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="sse-idle-timeout-enabled">{t("settings.sseIdleTimeout.enabled")}</label>
          <Switch
            id="sse-idle-timeout-enabled"
            checked={timeout.settings.enabled}
            loading={timeout.loading}
            disabled={timeout.loading}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={timeout.updateEnabled}
          />
        </div>
        {timeout.settings.enabled && (
          <div className="settings-field">
            <label htmlFor="sse-idle-timeout-seconds">{t("settings.sseIdleTimeout.duration")}</label>
            <DurationTimePicker
              id="sse-idle-timeout-seconds"
              value={timeout.settings.timeoutSeconds}
              disabled={timeout.loading}
              maxSeconds={MAX_SSE_IDLE_TIMEOUT_SECONDS}
              onChange={timeout.updateSeconds}
            />
          </div>
        )}
      </div>
    </section>
  );
}
