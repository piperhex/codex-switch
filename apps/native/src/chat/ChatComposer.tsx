import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ChatSettings } from './ChatSettings';
import { ComposerActionButton } from './ComposerActionButton';
import { useChatKeyboard } from './useChatKeyboard';
import { composerAction, CONTINUE_MESSAGE } from '../../../../shared/remote-chat/composerAction';
import { ChatPhotoPicker } from './ChatPhotoPicker';
import { useChatPhotos } from './useChatPhotos';
import { ChatCommandMenu } from './ChatCommandMenu';
import { useComposerMenu } from './useComposerMenu';
import type { SkillCatalogState } from './skillCatalog';
import { useChatDraft } from '../../../../shared/remote-chat/client/useChatDraft';
import type { Model, SendInput } from './types';
import { styles } from './styles';
import { composerLabel, type ComposerSettings } from '../../../../shared/remote-chat/composer';

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
  catalog: SkillCatalogState & { refresh: () => void };
  cwd: string;
  compactReason: string | null;
  compacting: boolean;
  compact: () => Promise<boolean>;
}

export function ChatComposer({ models, selection, settingsBusy, settingsError, updateSettings,
  threadId, active, ready, sending, running, interrupted = false, send, interrupt,
  catalog, cwd, compactReason, compacting, compact }: Props) {
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [focused, setFocused] = useState(false);
  const keyboardVisible = useChatKeyboard();
  const photos = useChatPhotos({ threadId, sending });
  const disabled = !ready || settingsBusy || compacting;
  const draft = useChatDraft({ threadId, sending, disabled: disabled || photos.busy, selection, send });
  const menu = useComposerMenu({ draft, scope: `${threadId ?? ''}:${cwd}`, active,
    refresh: catalog.refresh, compact });
  const compactField = draft.text.length === 0 && !adding && photos.photos.length === 0;
  const hasDraft = draft.hasContent || photos.photos.length > 0;
  useEffect(() => { if (!active) { setSettings(false); setAdding(false); } }, [active]);
  useEffect(() => { setSettings(false); setAdding(false); }, [threadId]);
  const action = composerAction({ running: running && !hasDraft, interrupted, hasDraft });
  const cannotSend = disabled || sending || photos.busy || (action === 'send' && !hasDraft);
  const actionDisabled = action === 'pause' ? !ready || pausing : cannotSend;
  const submit = async () => {
    if (actionDisabled) return;
    if (action === 'pause') {
      setPausing(true);
      try { await interrupt(); } finally { setPausing(false); }
      return;
    }
    const submittedPhotos = photos.photos;
    const sent = await draft.submit({ text: action === 'continue' ? CONTINUE_MESSAGE : draft.text,
      images: submittedPhotos.map((photo) => photo.dataUrl) });
    if (sent) photos.clearSubmitted(submittedPhotos);
  };
  return <View style={styles.composer}>
    {!!draft.error && <Text accessibilityRole="alert" style={styles.error}>{draft.error}</Text>}
    {compacting && <Text style={styles.subtitle}>正在压缩上下文…</Text>}
    {menu.open && <ChatCommandMenu catalog={catalog} query={menu.query} skillsOnly={menu.skillsOnly}
      compactReason={compactReason} choose={menu.choose}
      compact={() => { void menu.runCompact(); }} close={menu.close} />}
    <View style={styles.composerField}>
      {(adding || photos.photos.length > 0) && <ChatPhotoPicker photos={photos} disabled={sending} />}
      <TextInput ref={menu.input} accessibilityLabel="聊天消息"
        style={[styles.input, compactField && styles.composerEmptyInput]}
        multiline value={draft.text} maxLength={100_000} selection={menu.selection}
        onSelectionChange={(event) => menu.setSelection(event.nativeEvent.selection)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChangeText={draft.setText} placeholder={ready ? '发消息，输入 / 选择命令或技能…' : '连接后即可发送消息'} />
      <View pointerEvents="box-none" style={[styles.composerActions, compactField && styles.composerEmptyActions]}>
        <Pressable accessibilityRole="button" accessibilityLabel="添加内容" style={styles.composerAdd}
          accessibilityState={{ expanded: adding }} onPress={() => setAdding((current) => !current)}>
          <Text style={styles.composerAddText}>+</Text>
        </Pressable>
        <ComposerActionButton action={action} disabled={actionDisabled} busy={pausing || sending}
          onPress={() => { void submit(); }} />
      </View>
    </View>
    {keyboardVisible && focused && <View style={styles.row}>
      <Pressable accessibilityRole="button" style={styles.compactButton}
        accessibilityLabel={`${composerLabel(models, selection)}，聊天设置`} onPress={() => setSettings(true)}>
        <Text numberOfLines={1} style={styles.buttonText}>{composerLabel(models, selection)} ▾</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="命令和技能"
        accessibilityState={{ expanded: menu.open }} style={styles.compactButton} onPress={menu.toggle}>
        <Text style={styles.buttonText}>/</Text>
      </Pressable>
    </View>}
    {settings && <ChatSettings models={models} selection={selection}
      saving={settingsBusy} error={settingsError} ready={ready}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </View>;
}
