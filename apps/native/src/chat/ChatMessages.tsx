import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { ChatMarkdown } from './Markdown';
import { ChatImage } from './ChatImage';
import { ChatToolDetails } from './ChatToolDetails';
import { messageContent, messageLabel as toolLabel, turnFiles } from '../../../../shared/chat/messageDetails';
import { ChatDiff } from './ChatDiff';
import { BottomSheet } from '../components/BottomSheet';
import { ScrollView } from 'react-native';
import { CopyTextButton } from './CopyTextButton';
import { itemImageSources } from '../../../../shared/chat/imageSources';
import type { Item } from './types';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import { styles } from './styles';

const SCROLL_EDGE_DISTANCE = 100;

function ToolMessage({ item, onOpen }: { item: Item; onOpen: (id: string) => void }) {
  return <View style={styles.tool}>
    <Pressable accessibilityRole="button" accessibilityLabel={`查看${toolLabel(item)}详情`}
      onPress={() => onOpen(item.id)}>
      <Text style={styles.subtitle}>▸ {toolLabel(item)}
        {item.status === 'inProgress' ? ' · 进行中' : ''}</Text>
      {item.command && <Text numberOfLines={1} style={styles.code}>{item.command}</Text>}
    </Pressable>
  </View>;
}

const ChatMessage = memo(function ChatMessage({ item, onOpen }: { item: Item; onOpen: (id: string) => void }) {
  const images = itemImageSources(item);
  if (item.type === 'userMessage') return <View style={[styles.userMessage, images.length > 0 && { width: '92%' }]}>
    <Text selectable style={styles.messageText}>{messageContent(item)}</Text>
    {images.map((source, index) => <ChatImage key={index} source={source} />)}
    <Pressable accessibilityRole="button" onPress={() => onOpen(item.id)}>
      <Text style={styles.buttonText}>查看全文</Text></Pressable>
  </View>;
  if (images.length) return <View>
    {images.map((source, index) => <ChatImage key={index} source={source} />)}
    <ToolMessage item={item} onOpen={onOpen} />
  </View>;
  if (item.type !== 'agentMessage') return <ToolMessage item={item} onOpen={onOpen} />;
  return <View style={styles.assistantMessage}>
    <Text style={styles.speaker}>Codex</Text>
    <ChatMarkdown text={messageContent(item)} />
    <View style={styles.row}>
      <Pressable accessibilityRole="button" style={styles.compactButton} onPress={() => onOpen(item.id)}>
        <Text style={styles.buttonText}>查看全文</Text></Pressable>
      <CopyTextButton text={messageContent(item)} label="复制回复" />
    </View>
  </View>;
});

export function ChatMessages({ thread, loading, loadingMore, hasMore, loadOlder }: ChatMessagesProps) {
  const list = useRef<FlatList<Item>>(null);
  const following = useRef(true);
  const scrolling = useRef(false);
  const position = useRef(0);
  const contentHeight = useRef(0);
  const followFrame = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const [preservePosition, setPreservePosition] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const openTool = useCallback((id: string) => { Keyboard.dismiss(); setSelectedToolId(id); }, []);
  const items = thread?.turns?.flatMap((turn) => turn.items) ?? [];
  // Resolve from the live messages so output keeps updating while the drawer is open.
  const selectedTool = items.find((item) => item.id === selectedToolId);
  const lastTurn = thread?.turns?.at(-1);
  const changedTurn = thread?.turns?.slice().reverse().find((turn) => turn.diff?.trim()
    || turn.items.some((item) => item.changes?.length));
  const followLatest = () => {
    if (followFrame.current !== undefined) cancelAnimationFrame(followFrame.current);
    // A fast history read can arrive before the new list has a viewport. Scroll after native layout settles.
    followFrame.current = requestAnimationFrame(() => {
      followFrame.current = undefined;
      if (following.current && !scrolling.current) {
        list.current?.scrollToOffset({ offset: contentHeight.current, animated: false });
      }
    });
  };
  useEffect(() => () => {
    if (followFrame.current !== undefined) cancelAnimationFrame(followFrame.current);
  }, []);
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
  return <><FlatList ref={list} data={items} keyExtractor={(item) => item.id}
    contentContainerStyle={items.length ? styles.messages : styles.empty}
    renderItem={({ item }) => <ChatMessage item={item} onOpen={openTool} />}
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
    onLayout={followLatest}
    onContentSizeChange={(_, height) => { contentHeight.current = height; followLatest(); }}
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
    ListFooterComponent={<View style={{ gap: 12 }}>
      {changedTurn && <Pressable accessibilityRole="button" style={styles.button}
        onPress={() => { Keyboard.dismiss(); setChangesOpen(true); }}>
        <Text style={styles.buttonText}>查看最近一轮文件修改</Text></Pressable>}
      {lastTurn?.error && <Text style={styles.error}>{lastTurn.error.message}</Text>}
    </View>} />
    {selectedTool && <ChatToolDetails key={selectedTool.id} item={selectedTool}
      onClose={() => setSelectedToolId(null)} />}
    {changesOpen && changedTurn && <BottomSheet visible tall title="文件修改"
      onClose={() => setChangesOpen(false)} dragFromHeaderOnly>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
        <ChatDiff files={turnFiles(changedTurn)} />
      </ScrollView>
    </BottomSheet>}
  </>;
}
