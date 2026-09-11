import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform,
  Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import type { ChatController } from './controller';
import type { ChatState, Thread } from './types';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import { useChatSearch } from './useChatSearch';
import { palette, styles } from './styles';

interface Props { state: ChatState; controller: ChatController; onClose: () => void; select: (thread: Thread) => void }

export function ChatSearch({ state, controller, onClose, select }: Props) {
  const [query, setQuery] = useState('');
  const input = useRef<TextInput>(null);
  const search = useChatSearch({ controller, query, archived: state.archived, ready: state.ready });
  const emptyMessage = !state.ready ? '连接电脑后即可搜索聊天' : query.trim() ? '没有找到相关聊天' : '输入关键词，查找聊天';
  return <Modal visible animationType="slide" statusBarTranslucent
    onRequestClose={onClose} onShow={() => input.current?.focus()}>
    <SafeAreaView style={searchStyles.page}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={searchStyles.header}>
          <Text accessibilityRole="header" style={searchStyles.label}>聊天</Text>
          {state.archived && <Text style={styles.subtitle}>已归档</Text>}
        </View>
        <FlatList data={search.threads} keyExtractor={(thread) => thread.id} style={styles.fill}
          contentContainerStyle={searchStyles.results} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" renderItem={({ item }) => {
            const view = threadPresentation(item, state.sidebar);
            return <Pressable accessibilityRole="button" accessibilityLabel={view.title}
              disabled={!state.ready || state.sending} style={searchStyles.result} onPress={() => select(item)}>
              <View style={searchStyles.glyph}><Feather name="message-square" size={21} color={palette.ink} /></View>
              <View style={styles.fill}><Text numberOfLines={1} style={searchStyles.title}>{view.title}</Text>
                <Text numberOfLines={1} style={styles.subtitle}>{view.projectName}</Text></View>
            </Pressable>;
          }}
          ListEmptyComponent={!search.loading && !search.error
            ? <Text style={searchStyles.empty}>{emptyMessage}</Text> : null}
          ListFooterComponent={<View style={searchStyles.status}>
            {search.loading && <ActivityIndicator accessibilityLabel="正在搜索" color={palette.green} />}
            {!!search.error && <><Text accessibilityRole="alert" style={styles.error}>{search.error}</Text>
              <Pressable accessibilityRole="button" style={styles.button} onPress={search.reload}>
                <Text style={styles.buttonText}>重试</Text></Pressable></>}
            {!!search.cursor && !search.loading && !search.error && <Pressable accessibilityRole="button"
              disabled={!state.ready} style={styles.button} onPress={search.loadMore}>
              <Text style={styles.buttonText}>加载更多</Text></Pressable>}
          </View>} />
        <View style={searchStyles.toolbar}>
          <View style={searchStyles.field}>
            <Feather name="search" size={21} color={palette.muted} />
            <TextInput ref={input} accessibilityLabel="搜索聊天" placeholder="搜索聊天" value={query}
              onChangeText={setQuery} style={searchStyles.input} placeholderTextColor={palette.muted}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={search.reload}
              blurOnSubmit={false} />
            {!!query && <Pressable accessibilityRole="button" accessibilityLabel="清空搜索"
              style={searchStyles.clear} onPress={() => { setQuery(''); input.current?.focus(); }}>
              <Feather name="x-circle" size={21} color={palette.muted} /></Pressable>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭搜索" style={searchStyles.close}
            onPress={onClose}><Feather name="x" size={25} color={palette.ink} /></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const searchStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { color: palette.ink, fontSize: 17, fontWeight: '600', borderRadius: 24,
    backgroundColor: palette.background, paddingHorizontal: 20, paddingVertical: 12, overflow: 'hidden' },
  results: { paddingHorizontal: 20, paddingBottom: 16 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingVertical: 10 },
  glyph: { width: 44, height: 44, borderRadius: 14, backgroundColor: palette.background,
    alignItems: 'center', justifyContent: 'center' },
  title: { color: palette.ink, fontSize: 15, lineHeight: 24 },
  empty: { color: palette.muted, fontSize: 14, textAlign: 'center', paddingVertical: 40 },
  status: { gap: 8, paddingVertical: 12 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: palette.background },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 16,
    paddingRight: 4, minHeight: 52, borderRadius: 28, backgroundColor: '#fff' },
  input: { flex: 1, minWidth: 0, color: palette.ink, fontSize: 16, paddingHorizontal: 10, paddingVertical: 14 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  close: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center' },
});
