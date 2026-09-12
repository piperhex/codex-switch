import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, Text, View } from 'react-native';
import { useChatScroll } from './useChatScroll';
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

function MessageSeparator() {
  return <View style={styles.messageSeparator} />;
}

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
  const items = thread?.turns?.flatMap((turn) => turn.items) ?? [];
  const { list, more, preservePosition, initializing, onItemLayout, onFooterLayout, ...scrollHandlers }
    = useChatScroll({
    hasMore, loading, loadingMore, loadOlder, latestItemId: items.at(-1)?.id, bottomPadding: styles.messages.padding,
  });
  const showInitialLoading = initializing || (loading && !items.length);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const openTool = useCallback((id: string) => { Keyboard.dismiss(); setSelectedToolId(id); }, []);
  // Resolve from the live messages so output keeps updating while the drawer is open.
  const selectedTool = items.find((item) => item.id === selectedToolId);
  const lastTurn = thread?.turns?.at(-1);
  const changedTurn = thread?.turns?.slice().reverse().find((turn) => turn.diff?.trim()
    || turn.items.some((item) => item.changes?.length));
  return <><View style={styles.fill}><FlatList ref={list} data={items} keyExtractor={(item) => item.id}
    style={showInitialLoading && styles.messageListLoading}
    pointerEvents={showInitialLoading ? 'none' : 'auto'} accessibilityElementsHidden={showInitialLoading}
    importantForAccessibility={showInitialLoading ? 'no-hide-descendants' : 'auto'}
    contentContainerStyle={items.length ? styles.messages : styles.empty}
    renderItem={({ item }) => <View collapsable={false} onLayout={() => onItemLayout(item.id)}>
      <ChatMessage item={item} onOpen={openTool} />
    </View>}
    ItemSeparatorComponent={MessageSeparator}
    keyboardShouldPersistTaps="handled" initialNumToRender={10}
    // Keep message views attached while the keyboard changes the native clipping bounds.
    removeClippedSubviews={false}
    maintainVisibleContentPosition={preservePosition ? { minIndexForVisible: 1 } : undefined}
    {...scrollHandlers} scrollEventThrottle={100}
    ListHeaderComponent={hasMore ? <View
      style={[styles.historyStatus, styles.messageHeader]}>
      {loadingMore ? <>
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
    ListFooterComponent={<View style={styles.messageFooter} onLayout={onFooterLayout}>
      {changedTurn && <Pressable accessibilityRole="button" style={styles.button}
        onPress={() => { Keyboard.dismiss(); setChangesOpen(true); }}>
        <Text style={styles.buttonText}>查看最近一轮文件修改</Text></Pressable>}
      {lastTurn?.error && <Text style={styles.error}>{lastTurn.error.message}</Text>}
    </View>} />
    {showInitialLoading && <View style={styles.messageLoadingOverlay}>
      <ActivityIndicator size="small" accessibilityLabel="正在加载聊天记录" />
      <Text style={[styles.subtitle, styles.messageLoadingText]}>正在加载聊天记录…</Text>
    </View>}
    </View>
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
