import { Switch } from "antd";
import { Braces, MessagesSquare, ShieldCheck } from "lucide-react";
import type { Translate } from "../../i18n";
import styles from "./index.module.less";

interface SystemPromptFilterPageProps {
  enabled: boolean;
  loading: boolean;
  onEnabledChange: (enabled: boolean) => void;
  proxyRunning: boolean;
  t: Translate;
}

const FILTERED_SOURCES = [
  { icon: Braces, title: "systemPromptFilter.responses", detail: "systemPromptFilter.responsesDetail" },
  { icon: MessagesSquare, title: "systemPromptFilter.messages", detail: "systemPromptFilter.messagesDetail" },
  { icon: ShieldCheck, title: "systemPromptFilter.anthropic", detail: "systemPromptFilter.anthropicDetail" },
] as const;

export function SystemPromptFilterPage({
  enabled,
  loading,
  onEnabledChange,
  proxyRunning,
  t,
}: SystemPromptFilterPageProps) {
  return (
    <div className={styles.page}>
      <section className={styles.controlCard}>
        <div className={styles.controlCopy}>
          <span className={`${styles.status}${proxyRunning ? ` ${styles.running}` : ""}`}>
            {t(proxyRunning ? "systemPromptFilter.proxyRunning" : "systemPromptFilter.proxyStopped")}
          </span>
          <h2>{t("systemPromptFilter.toggleTitle")}</h2>
          <p>{t("systemPromptFilter.description")}</p>
        </div>
        <Switch
          aria-label={t("systemPromptFilter.toggleTitle")}
          checked={enabled}
          loading={loading}
          onChange={onEnabledChange}
        />
      </section>

      <section className={styles.scopeSection}>
        <div className={styles.sectionHeading}>
          <h2>{t("systemPromptFilter.scopeTitle")}</h2>
          <p>{t("systemPromptFilter.scopeDescription")}</p>
        </div>
        <div className={styles.scopeGrid}>
          {FILTERED_SOURCES.map((source) => {
            const Icon = source.icon;
            return (
              <article className={styles.scopeCard} key={source.title}>
                <Icon size={20} />
                <div>
                  <strong>{t(source.title)}</strong>
                  <p>{t(source.detail)}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <p className={styles.notice}>{t("systemPromptFilter.notice")}</p>
    </div>
  );
}
