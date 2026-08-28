import {
  ChevronRight, ClipboardPaste, ExternalLink, FileInput, Globe2, KeyRound, LayoutGrid, ShieldCheck, X,
} from "lucide-react";
import type { Translate } from "../../i18n";

export function LoginModal({ onClose, onWebSession, onStart, onImport, onImportClipboard, t }: {
  onClose: () => void;
  onWebSession: () => void;
  onStart: (embedded: boolean) => void;
  onImport: () => void;
  onImportClipboard: () => void;
  t: Translate;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label={t("login.close")} onClick={onClose}><X size={19} /></button>
        <div className="modal-icon"><KeyRound size={25} /></div>
        <h2>{t("login.title")}</h2>
        <p>{t("login.description")}</p>
        <button type="button" className="login-choice featured" onClick={() => onStart(true)}>
          <span className="choice-icon"><LayoutGrid size={20} /></span>
          <span><b>{t("login.embedded.title")}</b><small>{t("login.embedded.description")}</small></span><ChevronRight size={19} />
        </button>
        <button type="button" className="login-choice" onClick={onWebSession}>
          <span className="choice-icon"><Globe2 size={20} /></span>
          <span><b>{t("login.webSession.title")}</b><small>{t("login.webSession.description")}</small></span>
          <ChevronRight size={19} />
        </button>
        <button type="button" className="login-choice" onClick={() => onStart(false)}>
          <span className="choice-icon"><ExternalLink size={20} /></span>
          <span><b>{t("login.browser.title")}</b><small>{t("login.browser.description")}</small></span><ChevronRight size={19} />
        </button>
        <div className="modal-divider"><span>{t("login.or")}</span></div>
        <button type="button" className="login-choice import-choice" onClick={onImport}>
          <span className="choice-icon"><FileInput size={20} /></span>
          <span><b>{t("login.importMultiple")}</b><small>{t("login.importCompatible")}</small></span>
          <ChevronRight size={19} />
        </button>
        <button type="button" className="login-choice import-choice" onClick={onImportClipboard}>
          <span className="choice-icon"><ClipboardPaste size={20} /></span>
          <span><b>{t("login.importClipboard")}</b><small>{t("login.importClipboardDescription")}</small></span>
          <ChevronRight size={19} />
        </button>
        <div className="safety-note"><ShieldCheck size={16} />{t("login.safety")}</div>
      </section>
    </div>
  );
}
