import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import type { ChatProject, ChatState, Thread } from './types';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import { useThreadGroups } from '../../../../shared/remote-chat/client/useThreadGroups';
import { palette, styles } from './styles';

interface Props {
  state: ChatState; newChat: (project?: ChatProject) => void; select: (thread: Thread) => void;
  refresh: () => void; loadMore: () => void;
}

export function ChatThreadList({ state, newChat, select, refresh, loadMore }: Props) {
  const { groups, toggle } = useThreadGroups(state);
  const ready = state.ready;
  return (
    <SectionList sections={groups} keyExtractor={(thread) => thread.id}
      contentContainerStyle={listStyles.content} stickySectionHeadersEnabled={false} keyboardShouldPersistTaps="handled"
      refreshing={state.loading} onRefresh={refresh}
      renderSectionHeader={({ section }) => <View style={styles.row}>
        <Text accessibilityRole="header" numberOfLines={1} style={[listStyles.project, styles.fill]}>
          {section.label}</Text>
        {!!section.cwd && <Pressable accessibilityRole="button" accessibilityLabel={`在 ${section.label} 中新建对话`}
          disabled={state.sending} style={[listStyles.add, state.sending && styles.disabled]}
          onPress={() => newChat(section)}><Text style={listStyles.plus}>＋</Text></Pressable>}
      </View>}
      renderSectionFooter={({ section }) => section.canToggle ? <Pressable accessibilityRole="button"
        accessibilityLabel={`${section.expanded ? '收起' : '展开显示'}：${section.label}`}
        accessibilityState={{ expanded: section.expanded }} style={listStyles.more} onPress={() => toggle(section.cwd)}>
        <Text style={styles.subtitle}>{section.expanded ? '收起' : '展开显示'}</Text>
      </Pressable> : null}
      renderItem={({ item }) => {
        const view = threadPresentation(item, state.sidebar);
        return <Pressable accessibilityRole="button" accessibilityLabel={view.title}
          accessibilityState={{ selected: state.selected?.id === item.id }} disabled={!ready || state.sending}
          style={[listStyles.thread, state.selected?.id === item.id && listStyles.selected]}
          onPress={() => select(item)}>
          <Text numberOfLines={1} style={listStyles.title}>{view.title}</Text>
          <View style={listStyles.status}>
            {view.running ? <ActivityIndicator size="small" color={palette.muted} accessibilityLabel="正在回复" />
              : view.unread && <View accessible accessibilityLabel="未读回复" style={listStyles.dot} />}
          </View>
        </Pressable>;
      }}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.subtitle}>
        {ready ? '暂时没有聊天' : '连接电脑后查看聊天'}</Text></View>}
      ListFooterComponent={state.cursor ? <Pressable style={styles.button} disabled={state.loading || !ready}
        onPress={loadMore}><Text style={styles.buttonText}>加载更多</Text></Pressable>
        : null} />
  );
}

const listStyles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingBottom: 16 },
  project: { color: palette.muted, fontSize: 12, fontWeight: '600', paddingHorizontal: 10, marginVertical: 12 },
  add: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  plus: { color: palette.muted, fontSize: 22 },
  thread: { minHeight: 46, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center',
    gap: 10, borderRadius: 10 },
  selected: { backgroundColor: '#e6f8f1' },
  title: { flex: 1, color: palette.ink, fontSize: 14 },
  status: { width: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#a7b1ab' },
  more: { paddingHorizontal: 10, minHeight: 40, justifyContent: 'center' },
});
