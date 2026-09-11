import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { ChatController } from './controller';
import type { ChatProject, ChatState, Thread } from './types';
import { ChatThreadList } from './ChatThreadList';
import { palette, styles } from './styles';

interface Props {
  state: ChatState; controller: ChatController; newChat: (project?: ChatProject) => void;
  openSearch: () => void; select: (thread: Thread) => void; profileMenu: ReactNode;
}

export function ChatThreads({ state, controller, newChat, openSearch, select, profileMenu }: Props) {
  return <View style={styles.fill}>
    <View style={styles.padded}>
      <View style={styles.row}>
        <Text style={[styles.heading, styles.fill]}>聊天</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="搜索聊天" onPress={openSearch}
          style={listStyles.search}><Feather name="search" size={23} color={palette.ink} /></Pressable>
      </View>
      <Pressable accessibilityRole="button" style={listStyles.filter} disabled={!state.ready || state.loading}
        onPress={() => { void controller.list({ archived: !state.archived }); }}>
        <Text style={styles.subtitle}>{state.archived ? '已归档 ▾' : '最近聊天 ▾'}</Text>
      </Pressable>
    </View>
    <ChatThreadList state={state} newChat={newChat} select={select}
      refresh={() => { void controller.list(); }} loadMore={() => { void controller.list({ more: true }); }} />
    <View style={listStyles.footer}>
      <Pressable accessibilityRole="button" accessibilityLabel="新聊天" disabled={state.sending}
        style={[listStyles.newChat, state.sending && styles.disabled]} onPress={() => newChat()}>
        <Feather name="edit" size={21} color="#fff" /><Text style={listStyles.newChatText}>新聊天</Text>
      </Pressable>
      {profileMenu}
    </View>
  </View>;
}

const listStyles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, backgroundColor: '#fff' },
  search: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.background,
    alignItems: 'center', justifyContent: 'center' },
  filter: { minHeight: 36, justifyContent: 'center' },
  newChat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 52, paddingHorizontal: 24, borderRadius: 26, backgroundColor: palette.green },
  newChatText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
