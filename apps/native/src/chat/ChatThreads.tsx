import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import type { ChatController } from './controller';
import type { ChatState } from './types';
import { styles } from './styles';

function projectName(cwd: string) { return cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? '聊天'; }

export function ChatThreads({ state, controller, newChat }: {
  state: ChatState; controller: ChatController; newChat: () => void;
}) {
  const [search, setSearch] = useState(state.search);
  const ready = state.mode === 'direct' || state.mode === 'relay';
  return <View style={styles.fill}>
    <View style={styles.padded}>
      <View style={styles.row}>
        <Text style={[styles.heading, styles.fill]}>聊天</Text>
        <Pressable accessibilityRole="button" style={[styles.button, !ready && styles.disabled]} disabled={!ready}
          onPress={newChat}><Text style={styles.buttonText}>＋ 新聊天</Text></Pressable>
      </View>
      <TextInput accessibilityLabel="搜索聊天" placeholder="搜索电脑上的聊天" value={search} onChangeText={setSearch}
        style={styles.search} returnKeyType="search" onSubmitEditing={() => { void controller.list({ search }); }} />
      <View style={styles.row}>
        <Pressable style={styles.compactButton} onPress={() => { void controller.list({ archived: !state.archived }); }}>
          <Text style={styles.buttonText}>{state.archived ? '已归档 ▾' : '最近聊天 ▾'}</Text>
        </Pressable>
        <Text style={styles.subtitle}>与电脑保持同步</Text>
      </View>
    </View>
    <FlatList data={state.threads} keyExtractor={(thread) => thread.id} contentContainerStyle={styles.list}
      refreshing={state.loading} onRefresh={() => { void controller.list(); }}
      renderItem={({ item }) => <Pressable accessibilityRole="button" style={styles.card}
        disabled={!ready} onPress={() => { void controller.select(item); }}>
        <Text numberOfLines={1} style={styles.title}>{item.name || item.preview || '新聊天'}</Text>
        <Text numberOfLines={2} style={styles.threadPreview}>{item.preview}</Text>
        <View style={styles.row}>
          <Text numberOfLines={1} style={[styles.subtitle, styles.fill]}>{projectName(item.cwd)}</Text>
          <Text style={styles.subtitle}>{new Date(item.updatedAt * 1000).toLocaleDateString('zh-CN')}</Text>
        </View>
      </Pressable>}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.title}>
        {ready ? '暂时没有聊天' : '正在连接你的电脑…'}</Text>
        <Text style={[styles.subtitle, styles.centerText]}>{ready ? '创建新聊天，或换个关键词搜索。'
          : '请保持电脑上的 Codex Switch 运行，并登录同一账号。'}</Text></View>}
      ListFooterComponent={state.cursor ? <Pressable style={styles.button} disabled={state.loading || !ready}
        onPress={() => { void controller.list({ more: true }); }}><Text style={styles.buttonText}>加载更多</Text></Pressable>
        : null} />
  </View>;
}
