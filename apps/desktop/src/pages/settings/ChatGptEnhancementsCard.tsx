import { Switch } from "antd";
import { Sparkles } from "lucide-react";
import { useNonProxyEnhancements } from "../../hooks/useNonProxyEnhancements";
import type { Translate } from "../../i18n";

export function ChatGptEnhancementsCard({ t }: { t: Translate }) {
  const { enabled, loading, error, update } = useNonProxyEnhancements();
  return <section className="settings-card">
    <div className="settings-icon"><Sparkles size={23} /></div>
    <div className="settings-card-content">
      <div className="settings-card-copy">
        <h3>{t("settings.chatGptEnhancements.title")}</h3>
        <p>{t("settings.chatGptEnhancements.description")}</p>
        <p>{t("settings.chatGptEnhancements.nextLaunch")}</p>
        {error && <p role="alert">{t(`settings.chatGptEnhancements.${error}Error`)}</p>}
      </div>
      <div className="settings-field">
        <label htmlFor="non-proxy-enhancements">{t("settings.chatGptEnhancements.label")}</label>
        <Switch id="non-proxy-enhancements" checked={enabled} loading={loading} disabled={loading}
          checkedChildren={t("settings.autoRefresh.on")} unCheckedChildren={t("settings.autoRefresh.off")}
          onChange={(next) => { void update(next); }} />
      </div>
    </div>
  </section>;
}
