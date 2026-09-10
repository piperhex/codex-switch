import { useState } from 'react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { Model } from './types';
import type { ComposerSettings } from '../../../../shared/remote-chat/composer';
import { SETTINGS_FIELDS, settingOptions, settingValue,
  type SettingField } from '../../../../shared/remote-chat/settingsMenu';

interface Props {
  models: Model[];
  selection: ComposerSettings;
  disabled: boolean;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  onClose: () => void;
}

export function ChatSettings({ models, selection, disabled, updateSettings, onClose }: Props) {
  const [field, setField] = useState<SettingField | null>(null);
  const choose = async (value: string) => {
    if (!field || disabled) return;
    if (value !== selection[field]) await updateSettings({ [field]: value });
    setField((current) => current === field ? null : current);
  };
  return <AdaptiveSheet open title="聊天设置" width={400} onClose={onClose}>
    <div className="chat-settings" aria-hidden={field !== null}>
      {SETTINGS_FIELDS.map((entry) => <button key={entry.field} type="button" className="chat-setting-entry"
        aria-label={`设置${entry.label}`} onClick={() => setField(entry.field)} tabIndex={field ? -1 : 0}>
        <strong>{entry.label}</strong><span>{settingValue(entry.field, models, selection)}</span>
        <span aria-hidden="true">›</span>
      </button>)}
      <button type="button" className="chat-button chat-primary" tabIndex={field ? -1 : 0} onClick={onClose}>完成</button>
    </div>
    {field && <AdaptiveSheet open title={SETTINGS_FIELDS.find((entry) => entry.field === field)!.title} width={400}
      onBack={() => setField(null)} onClose={() => setField(null)}>
      <div className="chat-settings chat-setting-options" role="radiogroup">
        {settingOptions(field, models, selection).map((option) => <button key={option.value}
          type="button" role="radio" aria-label={option.label} aria-checked={selection[field] === option.value}
          disabled={disabled} className="chat-setting-option" onClick={() => { void choose(option.value); }}>
          <span className="chat-row"><strong className="chat-grow">{option.label}</strong>
            {selection[field] === option.value && <span aria-hidden="true">✓</span>}</span>
          {option.description && <small>{option.description}</small>}
        </button>)}
      </div>
    </AdaptiveSheet>}
  </AdaptiveSheet>;
}
