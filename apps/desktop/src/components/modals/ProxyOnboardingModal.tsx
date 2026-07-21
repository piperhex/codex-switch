import { RadioTower } from "lucide-react";
import type { Translate } from "../../i18n";

interface ProxyOnboardingModalProps {
  busy: boolean;
  onDecline: () => void;
  onEnable: () => void;
  t: Translate;
}

export function ProxyOnboardingModal({ busy, onDecline, onEnable, t }: ProxyOnboardingModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="proxy-onboarding-title">
        <div className="modal-icon"><RadioTower size={25} /></div>
        <h2 id="proxy-onboarding-title">{t("proxy.onboarding.title")}</h2>
        <p>{t("proxy.onboarding.description")}</p>
        <div className="update-actions">
          <button type="button" className="refresh-all" disabled={busy} onClick={onDecline}>
            {t("proxy.onboarding.decline")}
          </button>
          <button type="button" className="primary-button" disabled={busy} onClick={onEnable}>
            {t("proxy.onboarding.enable")}
          </button>
        </div>
      </section>
    </div>
  );
}
