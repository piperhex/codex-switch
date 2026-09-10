import { memo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { ChatMarkdown } from './Markdown';
import { ChatImage } from './ChatImage';
import { itemImageSources } from '../../../../shared/chat/imageSources';
import type { Item } from './types';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import { styles } from './styles';

const SCROLL_EDGE_DISTANCE = 100;

function content(item: Item) {
  if (item.text) return item.text;
  return (item.content ?? []).map((entry) => typeof entry === 'string' ? entry : entry.text ?? '').join('\n');
}

function ToolMessage({ item }: { item: Item }) {
  const [expanded, setExpanded] = useState(false);
  const labels: Record<string, string> = { commandExecution: '执行命令', fileChange: '文件修改', reasoning: '思考过程',
    webSearch: '搜索网页', mcpToolCall: '使用工具', collabAgentToolCall: '协作任务', plan: '执行计划' };
  const details = item.aggregatedOutput || item.summary?.join('\n') || content(item)
    || item.changes?.map((change) => `${change.path}\n${change.diff}`).join('\n')
    || (item.output ? JSON.stringify(item.output, null, 2) : '');
  return <View style={styles.tool}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}>
      <Text style={styles.subtitle}>{expanded ? '▾' : '▸'} {labels[item.type] ?? '任务活动'}
        {item.status === 'inProgress' ? ' · 进行中' : ''}</Text>
      {item.command && <Text numberOfLines={expanded ? undefined : 1} style={styles.code}>{item.command}</Text>}
    </Pressable>
    {expanded && !!details && <ScrollView horizontal><Text selectable style={styles.code}>{details}</Text></ScrollView>}
  </View>;
}

const ChatMessage = memo(function ChatMessage({ item }: { item: Item }) {
  const images = itemImageSources(item);
  if (item.type === 'userMessage') return <View style={[styles.userMessage, images.length > 0 && { width: '92%' }]}>
    <Text selectable style={styles.messageText}>{content(item)}</Text>
    {images.map((source, index) => <ChatImage key={index} source={source} />)}
  </View>;
  if (images.length) return <View>{images.map((source, index) => <ChatImage key={index} source={source} />)}</View>;
  if (item.type !== 'agentMessage') return <ToolMessage item={item} />;
  return <View style={styles.assistantMessage}>
    <Text style={styles.speaker}>Codex</Text>
    <ChatMarkdown text={content(item)} />
  </View>;
});

export function ChatMessages({ thread, loading, loadingMore, hasMore, loadOlder }: ChatMessagesProps) {
  const list = useRef<FlatList<Item>>(null);
  const following = useRef(true);
  const scrolling = useRef(false);
  const position = useRef(0);
  const [preservePosition, setPreservePosition] = useState(false);
  const items = thread?.turns?.flatMap((turn) => turn.items) ?? [];
  const lastTurn = thread?.turns?.at(-1);
  const updateFollowing = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    following.current = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height
      - nativeEvent.contentOffset.y < SCROLL_EDGE_DISTANCE;
    setPreservePosition(!following.current);
  };
  const more = () => {
    if (!hasMore || loadingMore || !loadOlder) return;
    following.current = false;
    setPreservePosition(true);
    void loadOlder();
  };
  const finishScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    updateFollowing(event);
    scrolling.current = false;
    // Android can deliver the final scroll position after the drag event has ended.
    if (event.nativeEvent.contentOffset.y < SCROLL_EDGE_DISTANCE) more();
  };
  return <FlatList ref={list} data={items} keyExtractor={(item) => item.id}
    contentContainerStyle={items.length ? styles.messages : styles.empty}
    renderItem={({ item }) => <ChatMessage item={item} />}
    keyboardShouldPersistTaps="handled" initialNumToRender={10}
    maintainVisibleContentPosition={preservePosition ? { minIndexForVisible: 1 } : undefined}
    // Image loads also emit scroll events. Only a user's gesture should turn off following new replies.
    onScrollBeginDrag={() => { scrolling.current = true; }}
    onScrollEndDrag={finishScroll}
    onMomentumScrollBegin={() => { scrolling.current = true; }}
    onMomentumScrollEnd={finishScroll}
    onScroll={(event) => {
      const top = event.nativeEvent.contentOffset.y;
      if (scrolling.current) {
        updateFollowing(event);
        if (top < position.current && top < SCROLL_EDGE_DISTANCE) more();
      }
      position.current = top;
    }} scrollEventThrottle={100}
    onContentSizeChange={(_, height) => {
      // Cell estimates can still be zero on the first layout; use the measured content height.
      if (following.current && !scrolling.current) list.current?.scrollToOffset({ offset: height, animated: false });
    }}
    ListHeaderComponent={hasMore || (loading && !items.length) ? <View style={styles.historyStatus}>
      {loadingMore || (loading && !items.length) ? <>
        <ActivityIndicator size="small" accessibilityLabel="正在加载聊天记录" />
        <Text style={styles.subtitle}>正在加载聊天记录…</Text>
      </> : <Pressable accessibilityRole="button" onPress={more}>
        <Text style={styles.subtitle}>加载更早的消息</Text>
      </Pressable>}
    </View> : null}
    ListEmptyComponent={loading ? null : <View style={styles.empty}>
      <Text style={styles.emptyGlyph}>✳</Text>
      <Text style={styles.title}>想一起完成什么？</Text>
      <Text style={[styles.subtitle, styles.centerText]}>消息会发送到你的电脑，随时可以接着聊。</Text>
    </View>}
    ListFooterComponent={lastTurn?.error ? <Text style={styles.error}>{lastTurn.error.message}</Text> : null} />;
}
