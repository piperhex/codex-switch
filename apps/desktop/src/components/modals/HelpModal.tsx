import {
  ChevronDown,
  CircleHelp,
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
  faq: Array<{ id: string; question: string; answer: string }>;
  t: Translate;
}

export function HelpModal({
  onClose,
  faq,
  t,
}: HelpModalProps) {
  const steps = [
    t("help.quickStart.step1"),
    t("help.quickStart.step2"),
    t("help.quickStart.step3"),
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title"
        onClick={(event) => event.stopPropagation()}>
        <header className="help-header">
          <button type="button" className="modal-close" aria-label={t("help.close")} onClick={onClose}><X size={19} /></button>
          <div className="help-header-icon"><CircleHelp size={20} /></div>
          <h2 id="help-modal-title">{t("help.title")}</h2>
        </header>

        <div className="help-scroll">
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
      </section>
    </div>
  );
}
