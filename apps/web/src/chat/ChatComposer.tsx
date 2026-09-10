import { useEffect, useState } from 'react';
import { ChatSettings } from './ChatSettings';
import type { Model, SendInput } from './types';
import { composerLabel, type ComposerSettings } from '../../../../shared/remote-chat/composer';

interface Props {
  models: Model[];
  selection: ComposerSettings;
  settingsBusy: boolean;
  settingsError: string;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  active: boolean;
  ready: boolean;
  sending: boolean;
  running: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => void;
}
export function ChatComposer({ models, selection, settingsBusy, settingsError, updateSettings,
  active, ready, sending, running, send, interrupt }: Props) {
  const [text, setText] = useState('');
  const [settings, setSettings] = useState(false);
  useEffect(() => { if (!active) setSettings(false); }, [active]);
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
    {settings && <ChatSettings models={models} selection={selection}
      saving={settingsBusy} error={settingsError} ready={ready}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </>;
}
