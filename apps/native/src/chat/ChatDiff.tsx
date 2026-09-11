import { useContext, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DiffFile, DiffLine } from '../../../../shared/chat/diff';
import { CopyTextButton } from './CopyTextButton';
import { ChatFileContext } from './ChatFilePreview';
import { palette, styles } from './styles';

const PAGE_LINES = 100;
const kinds: Record<string, string> = { add: '新增', delete: '删除', update: '修改' };

function DiffRow({ line }: { line: DiffLine }) {
  const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
  return <View style={[diffStyles.line, diffStyles[line.kind]]}>
    <Text style={[styles.code, diffStyles.number]}>{line.oldLine ?? ''}</Text>
    <Text style={[styles.code, diffStyles.number]}>{line.newLine ?? ''}</Text>
    <Text selectable style={[styles.code, { flexShrink: 1 }]}>{marker} {line.text}</Text>
  </View>;
}

function DiffFileView({ file }: { file: DiffFile }) {
  const [expanded, setExpanded] = useState(true);
  const [limit, setLimit] = useState(PAGE_LINES);
  const [wrap, setWrap] = useState(true);
  const openFile = useContext(ChatFileContext);
  const rows = <View>{file.lines.slice(0, limit).map((line, index) => <DiffRow key={index} line={line} />)}</View>;
  return <View style={diffStyles.file}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}>
      <Text style={styles.title}>{expanded ? '▾' : '▸'} {file.path}</Text>
      {file.previousPath && <Text selectable style={styles.subtitle}>原路径：{file.previousPath}</Text>}
      <Text style={styles.subtitle}>{file.previousPath ? '重命名' : kinds[file.kind] ?? '修改'} ·
        新增 {file.added} 行 · 删除 {file.removed} 行</Text>
    </Pressable>
    {expanded && <>
      <View style={diffStyles.toolbar}>
        <CopyTextButton text={file.raw} label="复制 diff" />
        <Pressable accessibilityRole="button" style={styles.compactButton} onPress={() => setWrap(!wrap)}>
          <Text style={styles.buttonText}>{wrap ? '横向滚动' : '自动换行'}</Text></Pressable>
        {openFile && file.kind !== 'delete' && <Pressable accessibilityRole="button" style={styles.compactButton}
          onPress={() => openFile({ path: file.path })}><Text style={styles.buttonText}>查看文件</Text></Pressable>}
      </View>
      {wrap ? rows : <ScrollView horizontal nestedScrollEnabled>{rows}</ScrollView>}
      {!file.lines.length && <Text style={styles.subtitle}>文件内容为空</Text>}
      {file.lines.length > limit && <Pressable accessibilityRole="button" style={styles.button}
        onPress={() => setLimit(limit + PAGE_LINES)}><Text style={styles.buttonText}>显示更多修改</Text></Pressable>}
    </>}
  </View>;
}

export function ChatDiff({ files }: { files: DiffFile[] }) {
  return <View style={{ gap: 16 }}>{files.map((file, index) =>
    <DiffFileView key={`${file.path}:${index}`} file={file} />)}</View>;
}

const diffStyles = StyleSheet.create({
  file: { gap: 10, borderWidth: 1, borderColor: palette.border, borderRadius: 10, padding: 10 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  line: { flexDirection: 'row', paddingVertical: 2, minHeight: 23 },
  number: { width: 38, color: palette.muted, textAlign: 'right', marginRight: 6 },
  add: { backgroundColor: '#dff4e5' }, remove: { backgroundColor: '#ffe5e5' },
  hunk: { backgroundColor: '#e7effa' }, meta: { backgroundColor: '#eef1ef' }, context: {},
});
