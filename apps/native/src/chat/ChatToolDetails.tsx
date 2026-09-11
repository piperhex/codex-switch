import { ScrollView, StyleSheet, Text } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import type { Item } from './types';
import { styles } from './styles';
import { messageLabel, messageSections } from '../../../../shared/chat/messageDetails';
import { changedFiles } from '../../../../shared/chat/diff';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatDiff } from './ChatDiff';

export function ChatToolDetails({ item, onClose }: { item: Item; onClose: () => void }) {
  const sections = messageSections(item);
  const files = changedFiles(item.changes ?? []);
  return <BottomSheet visible tall title={messageLabel(item)} onClose={onClose} dragFromHeaderOnly>
    <ScrollView style={sheetStyles.scroll} contentContainerStyle={sheetStyles.content}
      showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
      {item.status === 'inProgress' && <Text style={styles.subtitle}>进行中…</Text>}
      {files.length > 0 && <ChatDiff files={files} />}
      {sections.map((section, index) => <ChatCodeBlock key={index} text={section.text} label={section.title} />)}
      {!sections.length && !files.length && <Text style={styles.subtitle}>
        {item.status === 'inProgress' ? '正在等待内容…' : '暂无文本内容'}</Text>}
    </ScrollView>
  </BottomSheet>;
}

const sheetStyles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  content: { width: '100%', maxWidth: 400, alignSelf: 'center', paddingBottom: 20, gap: 16 },
});
