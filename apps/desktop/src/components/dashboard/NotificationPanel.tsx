import type { Translate } from "../../i18n";
import type { Language } from "../../i18n";
import type { CloudNotification } from "../../types";

interface NotificationPanelProps {
  language: Language;
  notifications: CloudNotification[];
  onOpenLink: (link: string) => void;
  t: Translate;
}

function normalizeHttpUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

export function NotificationPanel({ language, notifications, onOpenLink, t }: NotificationPanelProps) {
  return (
    <section className="notification-panel" aria-label={t("notification.title")}>
      <div className="notification-panel-header">
        <strong>{t("notification.title")}</strong>
        <span>{t("notification.count", { count: notifications.length })}</span>
      </div>
      <div className="notification-list">
        {notifications.length ? notifications.map((notification) => {
          const title = language === "zh" ? notification.titleZh : notification.titleEn;
          const content = language === "zh" ? notification.contentZh : notification.contentEn;
          const linkLabel = (language === "zh"
            ? notification.linkLabelZh
            : notification.linkLabelEn).trim() || t("notification.learnMore");
          return (
            <article className="notification-item" key={notification.id}>
              <div className="notification-item-heading">
                <strong>{title}</strong>
                <time dateTime={notification.publishedAt}>
                  {new Date(notification.publishedAt).toLocaleString(
                    language === "zh" ? "zh-CN" : "en-US",
                    { dateStyle: "medium", timeStyle: "short" },
                  )}
                </time>
              </div>
              <p>{content}</p>
              {normalizeHttpUrl(notification.link) && (
                <button type="button" onClick={() => onOpenLink(notification.link)}>
                  {linkLabel}
                </button>
              )}
            </article>
          );
        }) : <div className="notification-empty">{t("notification.empty")}</div>}
      </div>
    </section>
  );
}
