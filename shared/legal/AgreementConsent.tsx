import { useState } from 'react';
import { Button, Modal } from 'antd';
import { AGREEMENT_VERSION, agreementCopy, getUserAgreement } from './agreement';
import type { AgreementLanguage } from './types';
import type { AgreementConsent as Consent } from './useAgreementConsent';
import './agreement.css';

export function AgreementConsent({ consent, language, disabled = false }: {
  consent: Consent; language: AgreementLanguage; disabled?: boolean;
}) {
  const [reading, setReading] = useState(false);
  const copy = agreementCopy[language];
  const agreement = getUserAgreement(language);
  const closeReader = () => setReading(false);

  return <div className="agreement-consent">
    <div className="agreement-check-row">
      <label className="agreement-check-label">
        <input type="checkbox" checked={consent.accepted} disabled={disabled} aria-label={copy.checkbox}
          onChange={event => consent.setAccepted(event.target.checked)} />
        <span>{copy.prefix}</span>
      </label>
      <button type="button" className="agreement-link" onClick={() => setReading(true)}>{copy.link}</button>
    </div>
    <Modal open={consent.pendingAction !== null && !reading} centered width={400} title={copy.title}
      onCancel={consent.cancel} onOk={() => void consent.confirm()} cancelText={copy.cancel}
      okText={consent.pendingAction === 'register' ? copy.confirmRegister : copy.confirmLogin}
      className="agreement-confirm" maskClosable={false}>
      <p>{consent.pendingAction === 'register' ? copy.register : copy.login}</p>
      <button type="button" className="agreement-link" onClick={() => setReading(true)}>{copy.link}</button>
    </Modal>
    <Modal open={reading} centered width={720} title={agreement.title} onCancel={closeReader}
      className="agreement-reader" closeIcon={<span aria-label={copy.close}>×</span>}
      footer={<Button onClick={closeReader}>{copy.close}</Button>}>
      <article className="agreement-document" tabIndex={0} aria-label={agreement.title}
        data-agreement-version={AGREEMENT_VERSION}>
        <p className="agreement-updated">{agreement.updated}</p>
        <p>{agreement.introduction}</p>
        {agreement.sections.map(section => <section key={section.title}>
          <h3 className={section.important ? 'agreement-important' : undefined}>{section.title}</h3>
          {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        </section>)}
      </article>
    </Modal>
  </div>;
}
