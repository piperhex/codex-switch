import {
  Activity,
  ChevronDown,
  CircleHelp,
  Download,
  Gauge,
  MessageSquareText,
  Palette,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import type { Translate } from "../../i18n";

export type HelpVersionState =
  | { status: "checking" }
  | { status: "latest" }
  | { status: "available"; latestVersion: string }
  | { status: "error" };

interface HelpModalProps {
  onClose: () => void;
  onUpdate: () => void;
  onFeedback: () => void;
  version: string;
  versionState: HelpVersionState;
  faq: Array<{ id: string; question: string; answer: string }>;
  t: Translate;
}

function versionStatusLabel(state: HelpVersionState, t: Translate) {
  if (state.status === "latest") return t("help.version.latest");
  if (state.status === "available") return t("help.version.available", { version: state.latestVersion });
  if (state.status === "error") return t("help.version.error");
  return t("help.version.checking");
}

export function HelpModal({
  onClose,
  onUpdate,
  onFeedback,
  version,
  versionState,
  faq,
  t,
}: HelpModalProps) {
  const features = [
    { icon: <UserRound size={19} />, title: t("help.multi.title"), description: t("help.multi.description"), tone: "mint" },
    { icon: <RotateCcw size={19} />, title: t("help.switch.title"), description: t("help.switch.description"), tone: "blue" },
    { icon: <Gauge size={19} />, title: t("help.usage.title"), description: t("help.usage.description"), tone: "amber" },
    { icon: <Server size={19} />, title: t("help.providers.title"), description: t("help.providers.description"), tone: "violet" },
    { icon: <Activity size={19} />, title: t("help.automation.title"), description: t("help.automation.description"), tone: "coral" },
    { icon: <Palette size={19} />, title: t("help.personalize.title"), description: t("help.personalize.description"), tone: "cyan" },
  ];
  const steps = [
    t("help.quickStart.step1"),
    t("help.quickStart.step2"),
    t("help.quickStart.step3"),
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title"
        onClick={(event) => event.stopPropagation()}>
        <div className="help-hero">
          <button type="button" className="modal-close" aria-label={t("help.close")} onClick={onClose}><X size={19} /></button>
          <div className="help-hero-icon"><CircleHelp size={23} /></div>
          <div className="help-hero-copy">
            <span className="help-eyebrow">{t("help.eyebrow")}</span>
            <h2 id="help-modal-title">{t("help.title")}</h2>
            <p>{t("help.description")}</p>
          </div>
          <div className="help-hero-orbit" aria-hidden="true"><RefreshCw size={22} /></div>
        </div>

        <div className="help-scroll">
          <section className="help-section">
            <div className="help-section-heading">
              <div>
                <span>{t("help.overview.eyebrow")}</span>
                <h3>{t("help.overview.title")}</h3>
              </div>
              <small>{t("help.overview.description")}</small>
            </div>
            <div className="help-features">
              {features.map((feature) => (
                <article className={`help-feature-card ${feature.tone}`} key={feature.title}>
                  <div>{feature.icon}</div>
                  <span><b>{feature.title}</b><small>{feature.description}</small></span>
                </article>
              ))}
            </div>
          </section>

          <section className="help-quick-start">
            <div className="help-quick-start-copy">
              <span>{t("help.quickStart.eyebrow")}</span>
              <h3>{t("help.quickStart.title")}</h3>
              <p>{t("help.quickStart.description")}</p>
            </div>
            <ol>
              {steps.map((step, index) => (
                <li key={step}><b>{String(index + 1).padStart(2, "0")}</b><span>{step}</span></li>
              ))}
            </ol>
          </section>

          <aside className="help-security-note">
            <div><ShieldCheck size={20} /></div>
            <span>
              <b>{t("help.security.title")}</b>
              <small>{t("help.security.description")}</small>
            </span>
          </aside>

          {faq.length > 0 && (
            <section className="help-section help-faq-section">
              <div className="help-section-heading">
                <div>
                  <span>FAQ</span>
                  <h3>{t("help.faq.title")}</h3>
                </div>
                <small>{t("help.faq.description")}</small>
              </div>
              <div className="help-faq-list">
                {faq.map((item, index) => (
                  <details key={item.id} open={index === 0}>
                    <summary>
                      <span><b>{String(index + 1).padStart(2, "0")}</b>{item.question}</span>
                      <ChevronDown size={17} />
                    </summary>
                    <p>{item.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="help-version">
          <span>Codex Switch</span>
          <div className="help-version-details">
            <button type="button" className="help-feedback-button" onClick={onFeedback}>
              <MessageSquareText size={12} />{t("help.feedback")}
            </button>
            <b>v{version}</b>
            <span className={`help-version-status ${versionState.status}`} role="status" aria-live="polite">
              {versionStatusLabel(versionState, t)}
            </span>
            {versionState.status === "available" && (
              <button type="button" className="help-update-button" onClick={onUpdate}>
                <Download size={12} />{t("update.download")}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
