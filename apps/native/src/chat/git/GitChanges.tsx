import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { selectionState } from '../../../../../shared/remote-chat/gitFiles';
import type { GitFileRow } from '../../../../../shared/remote-chat/useGitFileList';
import type { RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { gitStyles as styles } from './styles';
import { palette } from '../styles';

export function GitChanges({ panel, connected }: { panel: RemoteGit; connected: boolean }) {
  const files = panel.changes?.files ?? [];
  const list = panel.fileList;
  const count = Object.keys(panel.selected).length;
  const all = selectionState(files, panel.selected);
  return <>
    <View style={styles.selection}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="全选" accessibilityState={{ checked: all }}
        disabled={panel.busy || !files.some(file => !file.conflict)}
        onPress={panel.selectAll} style={styles.checkButton}>
        <Text style={styles.check}>{checkSymbol(all)}</Text><Text style={styles.meta}>全选</Text></Pressable>
      <Text style={styles.meta}>已选 {count} 个文件</Text>
      <View style={styles.viewToggle}>{(['tree', 'flat'] as const).map(mode =>
        <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: mode === list.mode }}
          onPress={() => list.setMode(mode)} style={[styles.modeButton, mode === list.mode && styles.activeMode]}>
          <Text style={styles.meta}>{mode === 'tree' ? '文件夹' : '平铺'}</Text></Pressable>)}</View>
    </View>
    <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled">
      {panel.changes && !files.length && <Text style={styles.notice}>工作区没有未提交的改动。</Text>}
      {list.rows.map(row => <GitRow key={row.id} row={row} panel={panel} connected={connected}
        flat={list.mode === 'flat'} onToggle={() => list.toggleFolder(row.id)} />)}
    </ScrollView>
    <View style={styles.form}>
      <TextInput accessibilityLabel="提交说明" placeholder="填写提交说明" placeholderTextColor={palette.muted}
        style={styles.input} multiline maxLength={4000} value={panel.message} editable={!panel.busy}
        onChangeText={panel.setMessage} />
      <Text style={styles.hint}>提交所选文件的全部改动，包含已暂存和未暂存的内容。</Text>
      <Pressable accessibilityRole="button" disabled={!panel.canCommit}
        style={[styles.submit, !panel.canCommit && styles.disabled]} onPress={() => void panel.commit()}>
        <Text style={styles.submitText}>提交 {count} 个文件</Text></Pressable>
    </View>
  </>;
}

const checkSymbol = (state: boolean | 'mixed') => state === 'mixed' ? '⊟' : state ? '☑' : '☐';
function GitRow({ row, panel, connected, flat, onToggle }: {
  row: GitFileRow; panel: RemoteGit; connected: boolean; flat: boolean; onToggle: () => void;
}) {
  const checked = selectionState(row.files, panel.selected);
  const folder = row.kind === 'folder';
  const area = row.kind === 'area';
  const color = { color: row.area.color };
  const disabled = panel.busy || !row.files.some(file => !file.conflict);
  return <View style={[styles.file, { paddingLeft: 16 + Math.min(row.depth, 4) * 16 },
    area && { backgroundColor: row.area.background }]}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={`选择 ${row.path}`}
      accessibilityState={{ checked, disabled }} disabled={disabled}
      onPress={() => panel.selectFiles(row.files)} style={styles.checkButton}>
      <Text style={[styles.check, color, disabled && styles.disabled]}>{checkSymbol(checked)}</Text></Pressable>
    {area ? <Text style={[styles.areaTitle, color]}>{row.name}  {row.files.length}</Text>
      : <Pressable accessibilityRole="button" accessibilityLabel={`${folder ? '展开或收起' : '查看'} ${row.path}`}
        accessibilityState={{ expanded: folder ? !row.collapsed : undefined }}
        disabled={panel.busy || (!folder && !connected)} style={styles.fileButton}
        onPress={() => folder ? onToggle() : panel.setDetail({ path: row.path, title: row.path })}>
        {folder && <Text style={color}>{row.collapsed ? '▸' : '▾'}</Text>}
        <View style={styles.fill}><Text style={[styles.path, color]}>{row.name}</Text>
          {flat && row.path !== row.name && <Text style={styles.meta}>{row.path}</Text>}
          {row.file?.originalPath && <Text style={styles.meta}>{row.file.originalPath} → {row.path}</Text>}</View>
        <Text style={[styles.status, color]}>{folder ? row.files.length : row.file?.status.trim()}</Text>
      </Pressable>}
  </View>;
}
