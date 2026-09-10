import { useEffect, useRef, useState } from 'react';
import { ChatSettings } from './ChatSettings';
import { ChatAddButton, ChatAttachmentPreviews, ChatAttachmentSheet } from './ChatAttachments';
import { pickChatImages } from './pickChatImages';
import type { Model, SendInput } from './types';
import { composerLabel, type ComposerSettings } from '../../../../shared/remote-chat/composer';
import { useChatDraft } from '../../../../shared/remote-chat/client/useChatDraft';

interface Props {
  models: Model[];
  selection: ComposerSettings;
  settingsBusy: boolean;
  settingsError: string;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  threadId: string | null;
  active: boolean;
  ready: boolean;
  sending: boolean;
  running: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => void;
}
export function ChatComposer({ models, selection, settingsBusy, settingsError, updateSettings,
  threadId, active, ready, sending, running, send, interrupt }: Props) {
  const [settings, setSettings] = useState(false);
  const [attachments, setAttachments] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickerThread = useRef(threadId);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const disabled = !ready || settingsBusy;
  const draft = useChatDraft({ threadId, sending, disabled, selection, send });
  const busy = sending || draft.picking;
  useEffect(() => { if (!active) { setSettings(false); setAttachments(false); } }, [active]);
  useEffect(() => { setSettings(false); setAttachments(false); }, [threadId]);
  const openAttachments = () => { textarea.current?.blur(); setAttachments(true); };
  const openAlbum = () => {
    pickerThread.current = threadId;
    fileInput.current?.click();
    setAttachments(false);
  };
  const submitLabel = running ? '补充消息' : '发送消息';
  const buttonText = sending ? '发送中' : running ? '补充' : '发送 ↑';
  return <>
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void draft.submit(); }}>
      <input ref={fileInput} type="file" accept="image/*" multiple hidden aria-label="选择相册图片"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (pickerThread.current === threadId) void draft.addImages((remaining) => pickChatImages(files, remaining));
        }} />
      <ChatAttachmentPreviews images={draft.images} busy={busy} remove={draft.removeImage} add={openAttachments} />
      {!!draft.error && <p role="alert" className="chat-error">{draft.error}</p>}
      {draft.picking && <p role="status" className="chat-muted">正在添加图片…</p>}
      <textarea ref={textarea} aria-label="聊天消息" value={draft.text} maxLength={100_000} rows={2}
        onChange={(event) => draft.setText(event.target.value)}
        placeholder={ready ? '发消息给 Codex…' : '连接后即可发送消息'}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)) return;
          event.preventDefault(); void draft.submit();
        }} />
      <div className="chat-row">
        <button type="button" className="chat-button chat-grow chat-model" onClick={() => setSettings(true)}>
          {composerLabel(models, selection)} ▾</button>
        {running && <button type="button" className="chat-button" aria-label="停止回复" disabled={!ready}
          onClick={interrupt}>停止</button>}
        {draft.hasContent || sending ? <button type="submit" className="chat-button chat-primary"
          aria-label={submitLabel} disabled={disabled || busy}>{buttonText}</button>
          : <ChatAddButton disabled={busy} onClick={openAttachments} />}
      </div>
    </form>
    {attachments && <ChatAttachmentSheet busy={busy} pick={openAlbum} onClose={() => setAttachments(false)} />}
    {settings && <ChatSettings models={models} selection={selection}
      saving={settingsBusy} error={settingsError} ready={ready}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </>;
}
