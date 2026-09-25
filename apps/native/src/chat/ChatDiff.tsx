import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { DiffFile } from '../../../../shared/chat/diff';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView } from '../components/SheetScrollView';
import { ChatDiffContent } from './ChatDiffContent';
import { groupDiffFiles } from './diffGroups';
import { palette, styles } from './styles';
import { SelectableChatText } from './SelectableChatText';
import type { CopyAction } from './CopyTextButton';

const KINDS: Record<string, string> = { add: '新增', delete: '删除', update: '修改' };

export function DiffCounts({ added, removed }: { added: number; removed: number }) {
  return <View style={diffStyles.counts} accessibilityLabel={`新增 ${added} 行，删除 ${removed} 行`}>
    <Text style={diffStyles.added}>+{added}</Text><Text style={diffStyles.removed}>−{removed}</Text>
  </View>;
}

export function ChatDiff({ files, copy }: { files: DiffFile[]; copy?: CopyAction }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const groups = groupDiffFiles(files);
  const lastIndex = groups.at(-1)?.entries.at(-1)?.index;
  // Resolve from incoming props so an open drawer follows live edits.
  const selected = files.find((file, index) => `${file.path}:${index}` === selectedKey);
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  return <View style={diffStyles.document}>
    <View style={diffStyles.summary}>
      <Text style={styles.subtitle}>{new Set(files.map((file) => file.path)).size} 个文件</Text>
      <DiffCounts added={added} removed={removed} />
    </View>
    {groups.map((group) => <View key={group.directory} style={diffStyles.group}>
      <View style={diffStyles.folder}>
        <Feather name="folder" size={15} color={palette.muted} />
        <View style={styles.fill}>
          <Text accessibilityRole="header" style={diffStyles.folderName}>{group.name}</Text>
          <Text style={diffStyles.folderPath}>{group.directory || '.'}</Text>
        </View>
      </View>
      {group.entries.map(({ file, index }) => <Pressable key={`${file.path}:${index}`} accessibilityRole="button"
        accessibilityLabel={`查看 ${file.path} 的修改`} style={diffStyles.file}
        onPress={() => setSelectedKey(`${file.path}:${index}`)}>
        <Feather name="file-text" size={15} color={palette.muted} />
        <SelectableChatText style={[styles.messageText, styles.fill]}
          copy={index === lastIndex ? copy : undefined}>{file.path.split(/[\\/]/).pop()}</SelectableChatText>
        <Text style={styles.subtitle}>{file.previousPath ? '重命名' : KINDS[file.kind] ?? '修改'}</Text>
        <DiffCounts added={file.added} removed={file.removed} />
        <Feather name="chevron-right" size={15} color={palette.muted} />
      </Pressable>)}
    </View>)}
    {selected && <BottomSheet fullWidthContent visible tall title="文件差异" subtitle={selected.path}
      onClose={() => setSelectedKey(null)} onBack={() => setSelectedKey(null)} dragFromHeaderOnly>
      <SheetScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
        <ChatDiffContent key={selectedKey} file={selected} />
      </SheetScrollView>
    </BottomSheet>}
  </View>;
}

const diffStyles = StyleSheet.create({
  document: { gap: 8 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  group: { gap: 8, marginTop: 8 },
  folder: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, paddingVertical: 4 },
  folderName: { color: palette.ink, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  folderPath: { color: palette.muted, fontSize: 11, lineHeight: 18 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1,
    borderColor: palette.border, borderRadius: 8, padding: 10, minHeight: 44 },
  counts: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  added: { color: '#2e9863', fontSize: 12, lineHeight: 20 },
  removed: { color: '#c15a5a', fontSize: 12, lineHeight: 20 },
});
