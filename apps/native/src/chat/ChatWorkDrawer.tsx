import { StyleSheet, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetFlatList } from '../components/SheetScrollView';
import { ChatMessage } from './ChatMessage';
import type { WorkEntry } from './turnPresentation';

export function ChatWorkDrawer({ entry, onOpen, onClose }: {
  entry: Pick<WorkEntry, 'turn' | 'items'>; onOpen: (id: string) => void; onClose: () => void;
}) {
  const running = entry.turn.status === 'inProgress';
  return <BottomSheet fullWidthContent visible tall title={running ? '正在处理' : '处理过程'}
    subtitle={`${entry.items.length} 项活动`} onClose={onClose} dragFromHeaderOnly>
    <SheetFlatList data={entry.items} keyExtractor={(item) => item.id} style={workStyles.list}
      contentContainerStyle={workStyles.content} keyboardShouldPersistTaps="handled"
      ItemSeparatorComponent={() => <View style={workStyles.separator} />}
      renderItem={({ item }) => <ChatMessage item={item} onOpen={onOpen} process onQuote={onClose}
        running={running && item.status !== 'completed'} />} />
  </BottomSheet>;
}

const workStyles = StyleSheet.create({
  list: { flexShrink: 1 },
  content: { paddingBottom: 20 },
  separator: { height: 14 },
});
