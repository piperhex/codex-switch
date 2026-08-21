import {
  Download,
  Github,
  MessageSquareText,
  RotateCcw,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Translate } from "../../../i18n";
import type { HelpVersionState } from "../HelpModal";
import "./index.module.less";

interface AboutModalProps {
  logoUrl: string;
  onClose: () => void;
  onFeedback: () => void;
  onOpenRepository: () => void;
  onUpdate: () => void;
  version: string;
  versionState: HelpVersionState;
  t: Translate;
}

function versionStatusLabel(state: HelpVersionState, t: Translate) {
  if (state.status === "latest") return t("help.version.latest");
  if (state.status === "available") return t("help.version.available", { version: state.latestVersion });
  if (state.status === "error") return t("help.version.error");
  return t("help.version.checking");
}

export function AboutModal({
  logoUrl,
  onClose,
  onFeedback,
  onOpenRepository,
  onUpdate,
  version,
  versionState,
  t,
}: AboutModalProps) {
  const principles = [
    {
      icon: <ShieldCheck size={18} />,
      title: t("about.local.title"),
      description: t("about.local.description"),
    },
    {
      icon: <RotateCcw size={18} />,
      title: t("about.workflow.title"),
      description: t("about.workflow.description"),
    },
    {
      icon: <Server size={18} />,
      title: t("about.ecosystem.title"),
      description: t("about.ecosystem.description"),
    },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="modal-close" aria-label={t("about.close")} onClick={onClose}>
          <X size={19} />
        </button>

        <header className="about-hero">
          <div className="about-brand-mark">
            <img src={logoUrl} alt="" />
          </div>
          <div className="about-brand-copy">
            <span>{t("about.eyebrow")}</span>
            <h2 id="about-modal-title">Codex Switch</h2>
            <p>{t("about.tagline")}</p>
          </div>
          <div className="about-badges" aria-label={t("about.badges")}>
            <span>{t("about.badge.local")}</span>
            <span>{t("about.badge.desktop")}</span>
            <span>Apache-2.0</span>
          </div>
        </header>

        <div className="about-body">
          <p className="about-introduction">{t("about.description")}</p>

          <div className="about-principles">
            {principles.map((principle) => (
              <article key={principle.title}>
                <div>{principle.icon}</div>
                <span>
                  <b>{principle.title}</b>
                  <small>{principle.description}</small>
                </span>
              </article>
            ))}
          </div>

          <div className="about-version-panel">
            <div>
              <span>{t("about.currentVersion")}</span>
              <b>v{version}</b>
            </div>
            <span className={`help-version-status ${versionState.status}`} role="status" aria-live="polite">
              {versionStatusLabel(versionState, t)}
            </span>
          </div>

          <div className="about-actions">
            <button type="button" onClick={onOpenRepository}>
              <Github size={15} />
              {t("about.repository")}
            </button>
            <button type="button" onClick={onFeedback}>
              <MessageSquareText size={15} />
              {t("help.feedback")}
            </button>
            {versionState.status === "available" && (
              <button type="button" className="primary" onClick={onUpdate}>
                <Download size={15} />
                {t("update.download")}
              </button>
            )}
          </div>

          <footer className="about-legal">
            <span>{t("about.license")}</span>
            <p>{t("about.disclaimer")}</p>
          </footer>
        </div>
      </section>
    </div>
  );
}
