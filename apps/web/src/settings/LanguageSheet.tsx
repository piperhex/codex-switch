import { Check } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { setLanguage, t, useLanguage, LANGUAGE_OPTIONS } from '../i18n';

export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const language = useLanguage();
  return <AdaptiveSheet open title={t('语言')} width={400} onClose={onClose}>
    <div className="settings-language-options" role="radiogroup" aria-label={t('语言')}>
      {LANGUAGE_OPTIONS.map(option => <button key={option.value} type="button" role="radio"
        aria-checked={language === option.value} className="settings-row"
        onClick={() => { setLanguage(option.value); onClose(); }}>
        <span className="settings-row-label" lang={option.value === 'zh' ? 'zh-CN' : option.value}>{option.label}</span>
        {language === option.value && <Check size={18} aria-hidden="true" />}
      </button>)}
    </div>
  </AdaptiveSheet>;
}
