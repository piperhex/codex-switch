import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BottomSheet } from '../components/BottomSheet';
import { THREAD_NAME_LIMIT, type ThreadAction } from '../../../../shared/remote-chat/client/threadActions';
import type { ThreadActionsModel } from '../../../../shared/remote-chat/client/useThreadActions';
import { palette, styles } from './styles';

export function ChatThreadActions({ actions }: { actions: ThreadActionsModel }) {
  if (!actions.target) return null;
  const { view, busy, error, name, reason } = actions;
  const archive: ThreadAction = actions.target.archived ? 'unarchive' : 'archive';
  const title = view === 'menu' ? '对话操作' : view === 'rename' ? '重命名对话' : '删除这条对话？';
  const hint = reason(view === 'menu' ? archive : view);
  return <BottomSheet visible title={title} maxWidth={400} dismissible={!busy} dragFromHeaderOnly
    onClose={actions.close} onBack={view !== 'menu' && !busy ? () => actions.changeView('menu') : undefined}
    actions={view === 'menu' ? [] : [
      { label: '取消', onPress: actions.close, disabled: busy },
      { label: view === 'rename' ? '保存' : '删除', tone: view === 'delete' ? 'danger' : 'primary',
        loading: busy, disabled: !!hint || (view === 'rename' && !name.trim()),
        onPress: () => actions.submit(view) },
    ]}>
    <View style={actionStyles.content}>
      {view === 'menu' && <>
        <Action label="重命名" icon="edit-2" disabled={!!reason('rename')} onPress={() => actions.changeView('rename')} />
        <Action label={actions.target.archived ? '恢复' : '归档'} icon="archive" disabled={!!reason(archive)}
          onPress={() => { void actions.submit(archive); }} />
        <Action label="删除" icon="trash-2" danger disabled={!!reason('delete')}
          onPress={() => actions.changeView('delete')} />
      </>}
      {view === 'rename' && <TextInput accessibilityLabel="对话名称" value={name} onChangeText={actions.setName}
        style={actionStyles.input} maxLength={THREAD_NAME_LIMIT} autoFocus selectTextOnFocus editable={!busy}
        returnKeyType="done" onSubmitEditing={() => { if (!hint && name.trim()) void actions.submit('rename'); }} />}
      {view === 'delete' && <Text style={actionStyles.copy}>
        删除后可在电脑端“会话管理”的回收站中恢复。</Text>}
      {!!(error || hint) && <Text accessibilityRole="alert" style={error ? styles.error : styles.subtitle}>
        {error || hint}</Text>}
    </View>
  </BottomSheet>;
}

function Action({ label, icon, disabled, danger, onPress }: {
  label: string; icon: 'edit-2' | 'archive' | 'trash-2'; disabled: boolean; danger?: boolean; onPress: () => void;
}) {
  const color = danger ? palette.danger : palette.ink;
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[actionStyles.action, disabled && styles.disabled]}>
    <Feather name={icon} size={20} color={color} /><Text style={[actionStyles.label, { color }]}>{label}</Text>
  </Pressable>;
}

const actionStyles = StyleSheet.create({
  content: { gap: 8, paddingBottom: 12 },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10 },
  label: { fontSize: 16 },
  copy: { color: palette.ink, fontSize: 15, lineHeight: 24 },
  input: { borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, color: palette.ink, fontSize: 16 },
});
