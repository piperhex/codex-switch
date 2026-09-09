import { useEffect, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { AuthSession, RemoteDevice } from '../types';
import { ChatApproval } from './ChatApprovals';
import { ChatComposer } from './ChatComposer';
import { ChatMessages } from './ChatMessages';
import { ChatThreads } from './ChatThreads';
import { useChat } from './useChat';
import { styles } from './styles';

interface Props { session: AuthSession; devices: RemoteDevice[]; active: boolean }

export function ChatPage({ session, devices, active }: Props) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const device = devices.find((entry) => entry.deviceId === deviceId);
  return <View style={[styles.page, !active && styles.hidden]}>
    {device ? <ConnectedChat session={session} device={device} active={active}
      disconnect={() => setDeviceId(null)} /> : <ScrollView contentContainerStyle={styles.padded}>
      <Text style={styles.heading}>聊天</Text>
      <Text style={styles.subtitle}>把电脑上的对话带在身边</Text>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>离开桌面，{ '\n' }也能接着聊。</Text>
        <Text style={styles.heroText}>连接你的电脑，查看历史、继续任务，实时收到回复。</Text>
        <Text style={styles.heroText}>优先直接连接，网络受限时自动切换。</Text>
      </View>
      <Text style={styles.title}>选择电脑</Text>
      {devices.map((entry) => <Pressable key={entry.deviceId} accessibilityRole="button"
        disabled={!entry.online} style={[styles.card, !entry.online && styles.disabled]}
        onPress={() => setDeviceId(entry.deviceId)}>
        <View style={styles.row}>
          <View style={styles.icon}><Text style={styles.iconText}>PC</Text></View>
          <View style={styles.fill}><Text style={styles.title}>{entry.name}</Text>
            <Text style={styles.subtitle}>{entry.platform}</Text></View>
          <Text style={styles.pill}>{entry.online ? '连接' : '离线'}</Text>
        </View>
      </Pressable>)}
      {!devices.length && <View style={styles.card}><Text style={styles.title}>还没有可连接的电脑</Text>
        <Text style={styles.subtitle}>在电脑上打开 Codex Switch 并登录同一账号，设备就会出现在这里。</Text></View>}
      <Text style={[styles.subtitle, styles.centerText]}>聊天内容在手机与电脑之间加密传输。</Text>
    </ScrollView>}
  </View>;
}

function ConnectedChat({ session, device, active, disconnect }: {
  session: AuthSession; device: RemoteDevice; active: boolean; disconnect: () => void;
}) {
  const { state, controller } = useChat(session, device.deviceId, active);
  const [composing, setComposing] = useState(false);
  const showingChat = composing || !!state.selected;
  const ready = state.mode === 'direct' || state.mode === 'relay';
  const modeLabels = { connecting: '正在连接…', direct: '已直连', relay: '通过服务器连接', offline: '等待重新连接' };
  const goBack = () => {
    if (showingChat) { setComposing(false); controller.back(); }
    else disconnect();
  };
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { goBack(); return true; });
    return () => subscription.remove();
  }, [active, showingChat, controller]);
  return <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>‹</Text></Pressable>
      <View style={styles.fill}>
        <Text numberOfLines={1} style={styles.headerTitle}>{state.selected?.name || device.name}</Text>
        <Text style={styles.headerMeta}>{device.name} · {modeLabels[state.mode]}</Text>
      </View>
      {showingChat && state.selected && <Pressable accessibilityRole="button" style={styles.compactButton}
        disabled={!ready || state.selected.turns?.some((turn) => turn.status === 'inProgress')}
        onPress={() => { void controller.archive().then(() => setComposing(false)); }}>
        <Text style={styles.buttonText}>{state.archived ? '恢复' : '归档'}</Text>
      </Pressable>}
    </View>
    {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    {showingChat ? <>
      <ChatMessages key={state.selected?.id ?? 'new'} thread={state.selected} />
      {state.approvals.some((event) => event.params.threadId === state.selected?.id) &&
        <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={styles.padded} keyboardShouldPersistTaps="handled">
          {state.approvals.filter((event) => event.params.threadId === state.selected?.id).map((event) =>
            <ChatApproval key={String(event.id)} event={event} respond={(reply) => controller.respond(reply)} />)}
        </ScrollView>}
      <ChatComposer models={state.models} ready={ready} sending={state.sending}
        running={state.selected?.turns?.some((turn) => turn.status === 'inProgress') ?? false}
        send={(input) => controller.send(input)} interrupt={() => { void controller.interrupt(); }} />
    </> : <ChatThreads state={state} controller={controller} newChat={() => setComposing(true)} />}
  </KeyboardAvoidingView>;
}
