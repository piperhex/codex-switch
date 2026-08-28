import {
  ChevronRight, ClipboardPaste, ExternalLink, FileInput, Globe2, KeyRound, LayoutGrid, ShieldCheck, X,
} from "lucide-react";
import { Button, Modal } from "antd";
import { useState } from "react";
import type { Translate } from "../../i18n";

export function LoginModal({ onClose, onWebSession, onStart, onImport, onImportClipboard, t }: {
  onClose: () => void;
  onWebSession: () => void;
  onStart: (embedded: boolean, privateMode?: boolean) => void;
  onImport: () => void;
  onImportClipboard: () => void;
  t: Translate;
}) {
  const [browserModeConfirmOpen, setBrowserModeConfirmOpen] = useState(false);

  const confirmWebSession = () => {
    Modal.confirm({
      title: t("login.webSessionConfirmTitle"),
      content: <span className="login-web-session-warning">{t("login.webSessionConfirmDescription")}</span>,
      okText: t("login.webSessionConfirmButton"),
      cancelText: t("login.webSessionCancelButton"),
      onOk: onWebSession,
    });
  };

  const startBrowserLogin = (privateMode: boolean) => {
    setBrowserModeConfirmOpen(false);
    onStart(false, privateMode);
  };

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
        <button type="button" className="login-choice" onClick={confirmWebSession}>
          <span className="choice-icon"><Globe2 size={20} /></span>
          <span><b>{t("login.webSession.title")}</b><small>{t("login.webSession.description")}</small></span>
          <ChevronRight size={19} />
        </button>
        <button type="button" className="login-choice" onClick={() => setBrowserModeConfirmOpen(true)}>
          <span className="choice-icon"><ExternalLink size={20} /></span>
          <span><b>{t("login.browser.title")}</b><small>{t("login.browser.description")}</small></span><ChevronRight size={19} />
        </button>
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
      <Modal
        open={browserModeConfirmOpen}
        title={t("login.browserModeConfirmTitle")}
        width={400}
        onCancel={() => setBrowserModeConfirmOpen(false)}
        footer={[
          <Button key="normal" danger type="primary" onClick={() => startBrowserLogin(false)}>
            {t("login.browserNormalButton")}
          </Button>,
          <Button key="private" type="primary" onClick={() => startBrowserLogin(true)}>
            {t("login.browserPrivateButton")}
          </Button>,
        ]}
      >
        <p className="login-browser-mode-warning">{t("login.browserModeConfirmDescription")}</p>
      </Modal>
    </div>
  );
}
