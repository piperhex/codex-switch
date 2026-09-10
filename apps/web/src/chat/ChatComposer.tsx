import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Pause, Play, Plus } from 'lucide-react';
import { useComposerKeyboard } from './useComposerKeyboard';
import { composerAction, COMPOSER_ACTION_LABELS, CONTINUE_MESSAGE }
  from '../../../../shared/remote-chat/composerAction';
import { ChatSettings } from './ChatSettings';
import { ChatAttachmentPreviews, ChatAttachmentSheet } from './ChatAttachments';
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
  interrupted?: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => Promise<void>;
}
export function ChatComposer({ models, selection, settingsBusy, settingsError, updateSettings,
  threadId, active, ready, sending, running, interrupted = false, send, interrupt }: Props) {
  const [settings, setSettings] = useState(false);
  const [attachments, setAttachments] = useState(false);
  const [pausing, setPausing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickerThread = useRef(threadId);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const keyboardVisible = useComposerKeyboard(active);
  const disabled = !ready || settingsBusy;
  const draft = useChatDraft({ threadId, sending, disabled, selection, send });
  const busy = sending || draft.picking;
  const action = composerAction({ running: running && !draft.hasContent, interrupted, hasDraft: draft.hasContent });
  const actionDisabled = action === 'pause' ? !ready || pausing
    : disabled || busy || (action === 'send' && !draft.hasContent);
  useEffect(() => { if (!active) { setSettings(false); setAttachments(false); } }, [active]);
  useEffect(() => { setSettings(false); setAttachments(false); }, [threadId]);
  useLayoutEffect(() => {
    if (!textarea.current || !active) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${textarea.current.scrollHeight}px`;
  }, [draft.text, active]);
  const openAttachments = () => { textarea.current?.blur(); setAttachments(true); };
  const openAlbum = () => {
    pickerThread.current = threadId;
    fileInput.current?.click();
    setAttachments(false);
  };
  const submit = async () => {
    if (actionDisabled) return;
    if (action === 'pause') {
      setPausing(true);
      try { await interrupt(); } finally { setPausing(false); }
      return;
    }
    await draft.submit(action === 'continue' ? { text: CONTINUE_MESSAGE } : {});
  };
  const ActionIcon = { send: ArrowUp, pause: Pause, continue: Play }[action];
  return <>
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input ref={fileInput} type="file" accept="image/*" multiple hidden aria-label="选择相册图片"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (pickerThread.current === threadId) void draft.addImages((remaining) => pickChatImages(files, remaining));
        }} />
      <ChatAttachmentPreviews images={draft.images} busy={busy} remove={draft.removeImage} add={openAttachments} />
      {!!draft.error && <p role="alert" className="chat-error">{draft.error}</p>}
      {draft.picking && <p role="status" className="chat-muted">正在添加图片…</p>}
      <div className={`chat-composer-field${draft.text.length === 0 ? ' chat-composer-field-empty' : ''}`}>
        <textarea ref={textarea} aria-label="聊天消息" value={draft.text} maxLength={100_000} rows={1}
          onChange={(event) => draft.setText(event.target.value)}
          placeholder={ready ? '发消息给 Codex…' : '连接后即可发送消息'}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)) return;
            event.preventDefault(); void submit();
          }} />
        <div className="chat-composer-actions">
          <button type="button" className="chat-composer-add" aria-label="添加内容" disabled={busy}
            onPointerDown={(event) => event.preventDefault()} onClick={openAttachments}>
            <Plus size={24} aria-hidden="true" />
          </button>
          <button type="submit" className="chat-composer-submit" aria-label={COMPOSER_ACTION_LABELS[action]}
            onPointerDown={(event) => event.preventDefault()}
            aria-busy={pausing || sending} disabled={actionDisabled}>
            <ActionIcon size={20} aria-hidden="true" fill={action === 'continue' ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
      {keyboardVisible && <div className="chat-row chat-composer-settings">
        <button type="button" className="chat-button chat-model" onPointerDown={(event) => event.preventDefault()}
          aria-label={`${composerLabel(models, selection)}，聊天设置`} onClick={() => setSettings(true)}>
          {composerLabel(models, selection)} ▾</button>
      </div>}
    </form>
    {attachments && <ChatAttachmentSheet busy={busy} pick={openAlbum} onClose={() => setAttachments(false)} />}
    {settings && <ChatSettings models={models} selection={selection}
      saving={settingsBusy} error={settingsError} ready={ready}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </>;
}
