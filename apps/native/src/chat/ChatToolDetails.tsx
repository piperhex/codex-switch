import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import type { Item } from './types';
import { styles } from './styles';

const TOOL_LABELS: Record<string, string> = {
  commandExecution: '执行命令', fileChange: '文件修改', reasoning: '思考过程', webSearch: '搜索网页',
  mcpToolCall: '使用工具', dynamicToolCall: '使用工具', functionCallOutput: '工具输出',
  collabAgentToolCall: '协作任务', collabToolCall: '协作任务', plan: '执行计划',
};

export function toolLabel(item: Item) {
  return TOOL_LABELS[item.type] ?? '任务活动';
}

export function messageContent(item: Item) {
  if (item.text) return item.text;
  return (item.content ?? []).map((entry) => typeof entry === 'string' ? entry : entry.text ?? '').join('\n');
}

function toolDetails(item: Item) {
  return item.aggregatedOutput || item.summary?.join('\n') || messageContent(item)
    || item.changes?.map((change) => `${change.path}\n${change.diff}`).join('\n')
    || (item.output != null ? JSON.stringify(item.output, null, 2) : '')
    || (item.result != null ? JSON.stringify(item.result, null, 2) : '');
}

export function ChatToolDetails({ item, onClose }: { item: Item; onClose: () => void }) {
  const details = toolDetails(item);
  return <BottomSheet visible title={toolLabel(item)} onClose={onClose} dragFromHeaderOnly>
    <ScrollView style={sheetStyles.scroll} contentContainerStyle={sheetStyles.content}
      showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
      {item.status === 'inProgress' && <Text style={styles.subtitle}>进行中…</Text>}
      {!!item.command && <View style={sheetStyles.section}>
        <Text style={styles.title}>命令</Text>
        <Text selectable style={styles.code}>{item.command}</Text>
      </View>}
      <View style={sheetStyles.section}>
        {!!item.command && <Text style={styles.title}>输出</Text>}
        <Text selectable style={styles.code}>{details
          || (item.status === 'inProgress' ? '正在等待内容…' : '暂无文本内容')}</Text>
      </View>
    </ScrollView>
  </BottomSheet>;
}

const sheetStyles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  content: { width: '100%', maxWidth: 400, alignSelf: 'center', paddingBottom: 20, gap: 16 },
  section: { gap: 8 },
});
