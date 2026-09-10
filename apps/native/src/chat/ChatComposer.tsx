import { useEffect, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { ChatSettings } from './ChatSettings';
import { ChatAddButton, ChatAttachmentPreviews, ChatAttachmentSheet } from './ChatAttachments';
import { pickChatImages } from './pickChatImages';
import type { Model, SendInput } from './types';
import { styles } from './styles';
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
  const disabled = !ready || settingsBusy;
  const draft = useChatDraft({ threadId, sending, disabled, selection, send });
  const busy = sending || draft.picking;
  useEffect(() => { if (!active) { setSettings(false); setAttachments(false); } }, [active]);
  useEffect(() => { setSettings(false); setAttachments(false); }, [threadId]);
  const openAttachments = () => { Keyboard.dismiss(); setAttachments(true); };
  const pick = async () => { await draft.addImages(pickChatImages); setAttachments(false); };
  return <View style={styles.composer}>
    <ChatAttachmentPreviews images={draft.images} busy={busy} remove={draft.removeImage} add={openAttachments} />
    {!!draft.error && <Text accessibilityRole="alert" style={styles.error}>{draft.error}</Text>}
    {draft.picking && <Text style={styles.subtitle}>正在添加图片…</Text>}
    <TextInput accessibilityLabel="聊天消息" style={styles.input} multiline value={draft.text} maxLength={100_000}
      onChangeText={draft.setText} placeholder={ready ? '发消息给 Codex…' : '连接后即可发送消息'} />
    <View style={styles.row}>
      <Pressable accessibilityRole="button" style={[styles.compactButton, styles.fill]}
        accessibilityLabel={`${composerLabel(models, selection)}，聊天设置`} onPress={() => setSettings(true)}>
        <Text numberOfLines={1} style={styles.buttonText}>{composerLabel(models, selection)} ▾</Text>
      </Pressable>
      {running && <Pressable accessibilityRole="button" accessibilityLabel="停止回复" style={styles.compactButton}
        disabled={!ready} onPress={interrupt}><Text style={styles.buttonText}>停止</Text></Pressable>}
      {draft.hasContent || sending ? <Pressable accessibilityRole="button"
        accessibilityLabel={running ? '补充消息' : '发送消息'} disabled={disabled || busy}
        style={[styles.button, styles.primary, (disabled || busy) && styles.disabled]}
        onPress={() => { void draft.submit(); }}>
        <Text style={[styles.buttonText, styles.primaryText]}>{sending ? '发送中' : running ? '补充' : '发送 ↑'}</Text>
      </Pressable> : <ChatAddButton disabled={busy} onPress={openAttachments} />}
    </View>
    {attachments && <ChatAttachmentSheet busy={busy} pick={() => { void pick(); }}
      onClose={() => setAttachments(false)} />}
    {settings && <ChatSettings models={models} selection={selection}
      saving={settingsBusy} error={settingsError} ready={ready}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </View>;
}
