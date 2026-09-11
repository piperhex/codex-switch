import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { ChatSettings } from './ChatSettings';
import { ComposerActionButton } from './ComposerActionButton';
import Feather from '@expo/vector-icons/Feather';
import { modelLabelTail } from './modelLabel';
import { ComposerAddMenu, type ComposerAddAction } from './ComposerAddMenu';
import { ComposerPopover } from './ComposerPopover';
import { ComposerPluginMenu } from './ComposerPluginMenu';
import { ComposerReferences } from './ComposerReferences';
import { ComposerProjectFiles } from './ComposerProjectFiles';
import { useComposerAttachments } from './useComposerAttachments';
import type { RemoteComposerCatalog } from '../../../../shared/remote-chat/composerCatalog';
import type { ProjectFilesRequest, ProjectFilesResponse } from '../../../../shared/remote-chat/projectFiles';
import { MAX_CHAT_ATTACHMENT_DATA } from '../../../../shared/remote-chat/composerAttachments';
import { composerAction, CONTINUE_MESSAGE } from '../../../../shared/remote-chat/composerAction';
import { ChatPhotoPicker } from './ChatPhotoPicker';
import { useChatPhotos } from './useChatPhotos';
import { useChatKeyboard } from './useChatKeyboard';
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
  loadCatalog: (cwd: string) => Promise<RemoteComposerCatalog>;
  loadFiles: (options: ProjectFilesRequest) => Promise<ProjectFilesResponse>;
}

export function ChatComposer({ models, selection, settingsBusy, settingsError, updateSettings,
  threadId, active, ready, sending, running, interrupted = false, send, interrupt,
  catalog, cwd, compactReason, compacting, compact, loadCatalog, loadFiles }: Props) {
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pausing, setPausing] = useState(false);
  const keyboardVisible = useChatKeyboard();
  const [projectFiles, setProjectFiles] = useState<'files' | 'photos' | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const anchor = useRef<View>(null);
  const [anchorHeight, setAnchorHeight] = useState(0);
  const attachments = useComposerAttachments({ threadId, sending });
  const readCatalog = useCallback(() => loadCatalog(cwd), [loadCatalog, cwd]);
  const photos = useChatPhotos({ threadId, sending });
  const disabled = !ready || settingsBusy || compacting;
  const draft = useChatDraft({ threadId, sending, disabled: disabled || photos.busy || attachments.busy, selection, send });
  const menu = useComposerMenu({ draft, scope: `${threadId ?? ''}:${cwd}`, active,
    refresh: catalog.refresh, compact });
  const compactField = !keyboardVisible && draft.text.length === 0
    && photos.photos.length === 0 && !attachments.items.length;
  const hasDraft = draft.hasContent || photos.photos.length > 0 || attachments.items.length > 0;
  useEffect(() => { if (!active) { setSettings(false); setAdding(false); setProjectFiles(null); } }, [active]);
  useEffect(() => { setSettings(false); setAdding(false); setProjectFiles(null); setAttachmentError(''); }, [threadId]);
  useEffect(() => { setProjectFiles(null); }, [cwd]);
  const action = composerAction({ running: running && !hasDraft, interrupted, hasDraft });
  const attachmentBusy = sending || photos.busy || attachments.busy;
  const cannotSend = disabled || attachmentBusy || (action === 'send' && !hasDraft);
  const actionDisabled = action === 'pause' ? !ready || pausing : cannotSend;
  const submit = async () => {
    if (actionDisabled) return;
    if (action === 'pause') {
      setPausing(true);
      try { await interrupt(); } finally { setPausing(false); }
      return;
    }
    const submittedPhotos = photos.photos;
    const submittedAttachments = attachments.items;
    const size = submittedPhotos.reduce((total, photo) => total + photo.dataUrl.length, 0)
      + submittedAttachments.reduce((total, item) => total + (item.data?.length ?? 0), 0);
    if (size > MAX_CHAT_ATTACHMENT_DATA) { setAttachmentError('附件总大小过大，请减少照片或文件后再试。'); return; }
    setAttachmentError('');
    const sent = await draft.submit({ text: action === 'continue' ? CONTINUE_MESSAGE : draft.text,
      images: submittedPhotos.map((photo) => photo.dataUrl), attachments: submittedAttachments });
    if (sent) { photos.clearSubmitted(submittedPhotos); attachments.clearSubmitted(submittedAttachments); }
  };
  const chooseAdd = (choice: ComposerAddAction) => {
    setAdding(false); setAttachmentError('');
    if (choice === 'plugins') { menu.openPlugins(); return; }
    Keyboard.dismiss();
    if (choice === 'file') { void attachments.pick(); return; }
    if (choice === 'projectFiles' || choice === 'projectPhotos') {
      setProjectFiles(choice === 'projectPhotos' ? 'photos' : 'files'); return;
    }
    void photos.pick(choice);
  };
  const menuContent = () => {
    if (adding) return <ComposerAddMenu busy={attachmentBusy} choose={chooseAdd} />;
    if (menu.plugins) return <ComposerPluginMenu catalog={catalog} query={menu.query} load={readCatalog}
      chooseSkill={menu.choose} choosePlugin={(plugin) => { attachments.addPlugin(plugin); menu.consumeTrigger(); }} />;
    return <ChatCommandMenu catalog={catalog} query={menu.query} skillsOnly={menu.skillsOnly}
      compactReason={compactReason} choose={menu.choose}
      compact={() => { void menu.runCompact(); }} close={menu.close} />;
  };
  return <View style={styles.composer}>
    {!!draft.error && <Text accessibilityRole="alert" style={styles.error}>{draft.error}</Text>}
    {compacting && <Text style={styles.subtitle}>正在压缩上下文…</Text>}
    {!!(attachmentError || attachments.error) && <Text accessibilityRole="alert" style={styles.error}>
      {attachmentError || attachments.error}</Text>}
    {attachments.busy && <Text style={styles.status}>正在读取文件…</Text>}
    {(adding || menu.open) && <ComposerPopover anchor={anchor} anchorHeight={anchorHeight} wide={!adding}
      close={() => { setAdding(false); menu.close(); }}>
      {menuContent()}
    </ComposerPopover>}
    <View ref={anchor} collapsable={false} style={styles.composerField}
      onLayout={({ nativeEvent }) => setAnchorHeight(nativeEvent.layout.height)}>
      <ChatPhotoPicker photos={photos} disabled={sending} />
      <ComposerReferences items={attachments.items} disabled={attachmentBusy} remove={attachments.remove} />
      <TextInput ref={menu.input} accessibilityLabel="聊天消息"
        style={[styles.input, compactField && styles.composerEmptyInput]}
        multiline value={draft.text} maxLength={100_000} selection={menu.selection}
        onSelectionChange={(event) => menu.setSelection(event.nativeEvent.selection)}
        onChangeText={draft.setText} placeholder={ready ? '发消息，输入 @ 选择插件…' : '连接后即可发送消息'} />
      <View pointerEvents="box-none" style={[styles.composerActions, compactField && styles.composerEmptyActions]}>
        <Pressable accessibilityRole="button" accessibilityLabel="添加内容" style={styles.composerAdd}
          accessibilityState={{ expanded: adding }} onPress={() => { menu.close(); setAdding((current) => !current); }}>
          <Text style={styles.composerAddText}>+</Text>
        </Pressable>
        <View style={styles.composerTrailing}>
          {!compactField && <Pressable accessibilityRole="button" style={styles.composerModel}
            accessibilityLabel={`${composerLabel(models, selection)}，聊天设置`} onPress={() => setSettings(true)}>
            <Text numberOfLines={1} ellipsizeMode="head" style={styles.composerModelText}>
              {modelLabelTail(composerLabel(models, selection))}</Text>
            <Feather name="chevron-down" size={12} color={styles.composerModelText.color} />
          </Pressable>}
          <ComposerActionButton action={action} disabled={actionDisabled} busy={pausing || sending}
            onPress={() => { void submit(); }} />
        </View>
      </View>
    </View>
    {projectFiles && <ComposerProjectFiles imagesOnly={projectFiles === 'photos'} threadId={threadId} cwd={cwd}
      load={loadFiles} close={() => setProjectFiles(null)} choose={(file) => {
        attachments.addFile({ kind: 'file', name: file.name, path: file.path }); setProjectFiles(null);
      }} />}
    {settings && <ChatSettings models={models} selection={selection}
      saving={settingsBusy} error={settingsError} ready={ready}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </View>;
}
