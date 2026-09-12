import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { QueueProps } from '../../../../shared/remote-chat/client/queueProps';
import { palette, styles } from './styles';

export function ChatQueue({ messages, running, disabled, act }: QueueProps) {
  if (!messages.length) return null;
  const sending = messages.some((message) => message.busy);
  return <View style={queueStyles.queue} accessibilityLabel="待发送消息">
    <View style={queueStyles.heading}><Text style={styles.subtitle}>待发送 · {messages.length}</Text>
      {!running && <Pressable accessibilityRole="button" disabled={disabled || sending}
        style={queueStyles.action} onPress={() => void act('queueFlush')}>
        <Text style={[styles.buttonText, (disabled || sending) && styles.disabled]}>发送全部</Text>
      </Pressable>}</View>
    <ScrollView style={queueStyles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
      {messages.map((message) => <View key={message.id} style={queueStyles.item}>
        <Text style={styles.subtitle}>↳</Text>
        <View style={styles.fill}>
          <Text numberOfLines={2} style={queueStyles.text}>{message.text || '图片消息'}</Text>
          {message.imageCount > 0 && <Text style={styles.subtitle}>{message.imageCount} 张图片</Text>}
          {message.attachmentCount > 0 && <Text style={styles.subtitle}>{message.attachmentCount} 个附件</Text>}
          {message.busy && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>正在发送…</Text>}
          {message.error && <Text accessibilityRole="alert" style={queueStyles.error}>{message.error}</Text>}
        </View>
        <Pressable accessibilityRole="button" disabled={disabled || sending} style={queueStyles.action}
          onPress={() => void act('queueSendNow', message.id)}>
          <Text style={[styles.buttonText, (disabled || sending) && styles.disabled]}>立即发送</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="删除待发送消息"
          disabled={disabled || message.busy} style={queueStyles.action}
          onPress={() => void act('queueRemove', message.id)}>
          <Text style={[styles.subtitle, (disabled || message.busy) && styles.disabled]}>×</Text></Pressable>
      </View>)}
    </ScrollView>
  </View>;
}

const queueStyles = StyleSheet.create({
  queue: { marginHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 12,
    backgroundColor: '#fff', overflow: 'hidden' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12,
    minHeight: 34 },
  list: { maxHeight: 180, flexGrow: 0, paddingHorizontal: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1,
    borderColor: palette.border, paddingVertical: 6 },
  text: { color: palette.ink, fontSize: 13, lineHeight: 20 },
  action: { minHeight: 40, minWidth: 32, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  error: { color: palette.danger, fontSize: 12, lineHeight: 18 },
});
