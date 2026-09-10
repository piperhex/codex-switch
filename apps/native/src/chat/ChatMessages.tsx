import { useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { ChatMarkdown } from './Markdown';
import { ChatImage } from './ChatImage';
import { itemImageSources } from '../../../../shared/chat/imageSources';
import type { Item, Thread } from './types';
import { styles } from './styles';

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

function ChatMessage({ item }: { item: Item }) {
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
}

export function ChatMessages({ thread }: { thread: Thread | null }) {
  const list = useRef<FlatList<Item>>(null);
  const following = useRef(true);
  const scrolling = useRef(false);
  const items = thread?.turns?.flatMap((turn) => turn.items) ?? [];
  const running = thread?.turns?.some((turn) => turn.status === 'inProgress');
  const lastTurn = thread?.turns?.at(-1);
  const updateFollowing = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    following.current = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height
      - nativeEvent.contentOffset.y < 100;
  };
  return <FlatList ref={list} data={items} keyExtractor={(item) => item.id}
    contentContainerStyle={items.length ? styles.messages : styles.empty}
    renderItem={({ item }) => <ChatMessage item={item} />}
    keyboardShouldPersistTaps="handled" initialNumToRender={16}
    // Image loads also emit scroll events. Only a user's gesture should turn off following new replies.
    onScrollBeginDrag={() => { scrolling.current = true; }}
    onScrollEndDrag={(event) => { updateFollowing(event); scrolling.current = false; }}
    onMomentumScrollBegin={() => { scrolling.current = true; }}
    onMomentumScrollEnd={(event) => { updateFollowing(event); scrolling.current = false; }}
    onScroll={(event) => { if (scrolling.current) updateFollowing(event); }} scrollEventThrottle={100}
    onContentSizeChange={() => {
      if (following.current && !scrolling.current) list.current?.scrollToEnd({ animated: false });
    }}
    ListEmptyComponent={<View style={styles.empty}>
      <Text style={styles.emptyGlyph}>✳</Text>
      <Text style={styles.title}>想一起完成什么？</Text>
      <Text style={[styles.subtitle, styles.centerText]}>消息会发送到你的电脑，随时可以接着聊。</Text>
    </View>}
    ListFooterComponent={running ? <Text style={styles.status}>Codex 正在处理…</Text>
      : lastTurn?.error ? <Text style={styles.error}>{lastTurn.error.message}</Text> : null} />;
}
