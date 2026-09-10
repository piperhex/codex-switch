import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { Model, SendInput } from './types';
import { ACCESS_OPTIONS, EFFORT_LABELS, composerLabel,
  type ComposerSettings } from '../../../../shared/remote-chat/composer';

interface Props {
  models: Model[];
  selection: ComposerSettings;
  settingsBusy: boolean;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  active: boolean;
  ready: boolean;
  sending: boolean;
  running: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => void;
}
export function ChatComposer({ models, selection, settingsBusy, updateSettings,
  active, ready, sending, running, send, interrupt }: Props) {
  const [text, setText] = useState('');
  const [settings, setSettings] = useState(false);
  useEffect(() => { if (!active) setSettings(false); }, [active]);
  const model = models.find((entry) => entry.model === selection.model);
  const disabled = !ready || settingsBusy;
  const submit = async () => {
    if (disabled || sending || !text.trim()) return;
    const submitted = text;
    const sent = await send({ text: submitted, ...selection });
    if (sent) setText((current) => current === submitted ? '' : current);
  };
  const submitLabel = running ? '补充消息' : '发送消息';
  const buttonText = sending ? '发送中' : running ? '补充' : '发送 ↑';
  return <>
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea aria-label="聊天消息" value={text} maxLength={100_000} rows={2}
        onChange={(event) => setText(event.target.value)} placeholder={ready ? '发消息给 Codex…' : '连接后即可发送消息'}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)) return;
          event.preventDefault(); void submit();
        }} />
      <div className="chat-row">
        <button type="button" className="chat-button chat-grow chat-model" onClick={() => setSettings(true)}>
          {composerLabel(models, selection)} ▾</button>
        {running && <button type="button" className="chat-button" aria-label="停止回复" disabled={!ready}
          onClick={interrupt}>停止</button>}
        <button type="submit" className="chat-button chat-primary" aria-label={submitLabel}
          disabled={disabled || sending || !text.trim()}>{buttonText}</button>
      </div>
    </form>
    <AdaptiveSheet open={settings} title="聊天设置" width={400} onClose={() => setSettings(false)}>
      <div className="chat-settings">
        <label>模型<select aria-label="模型" value={selection.model} disabled={disabled}
          onChange={(event) => { void updateSettings({ model: event.target.value }); }}>
          {models.map((entry) => <option key={entry.id} value={entry.model}>{entry.displayName}</option>)}
        </select></label>
        <label>思考深度<select aria-label="思考深度" value={selection.effort} disabled={disabled}
          onChange={(event) => { void updateSettings({ effort: event.target.value }); }}>
          {model?.supportedReasoningEfforts?.map((entry) => <option key={entry.reasoningEffort}
            value={entry.reasoningEffort}>{EFFORT_LABELS[entry.reasoningEffort] ?? entry.reasoningEffort}</option>)}
        </select></label>
        <label>访问权限<select aria-label="访问权限" value={selection.access} disabled={disabled}
          onChange={(event) => { void updateSettings({ access: event.target.value as SendInput['access'] }); }}>
          {ACCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <p className="chat-muted">{ACCESS_OPTIONS.find((option) => option.value === selection.access)?.description}</p>
        <button type="button" className="chat-button chat-primary" onClick={() => setSettings(false)}>完成</button>
      </div>
    </AdaptiveSheet>
  </>;
}
