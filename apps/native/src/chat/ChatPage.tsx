import { useEffect, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { AuthSession, RemoteDevice } from '../types';
import { ChatApproval } from './ChatApprovals';
import { ChatComposer } from './ChatComposer';
import { ChatMessages } from './ChatMessages';
import { ChatImageContext } from './ChatImage';
import { ChatThreads } from './ChatThreads';
import { ChatDrawer } from './ChatDrawer';
import { ChatDevices } from './ChatDevices';
import { useChat } from './useChat';
import { styles } from './styles';

interface Props { session: AuthSession; devices: RemoteDevice[]; active: boolean }
const modeLabels = { connecting: '正在连接…', direct: '已直连', relay: '通过服务器连接', offline: '等待重新连接' };

export function ChatPage({ session, devices, active }: Props) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const device = devices.find((entry) => entry.deviceId === deviceId)
    ?? devices.find((entry) => entry.online) ?? devices[0];
  useEffect(() => { if (!deviceId && device) setDeviceId(device.deviceId); }, [deviceId, device?.deviceId]);
  return <View style={[styles.page, !active && styles.hidden]}>
    <ConnectedChat key={`${session.baseUrl}:${session.email}:${device?.deviceId ?? ''}`} session={session}
      device={device} devices={devices} active={active} chooseDevice={setDeviceId} />
  </View>;
}

function ConnectedChat({ session, device, devices, active, chooseDevice }: Props & {
  device?: RemoteDevice; chooseDevice: (id: string) => void;
}) {
  const { state, controller } = useChat(session, device?.deviceId ?? '', active && Boolean(device));
  const [drawer, setDrawer] = useState(false);
  const [pickingDevice, setPickingDevice] = useState(false);
  const ready = state.ready;
  const running = state.selected?.turns?.some((turn) => turn.status === 'inProgress') ?? false;
  const newChat = () => { if (!state.sending) { controller.back(); setDrawer(false); } };
  useEffect(() => { controller.setViewing(active && !drawer && !pickingDevice); },
    [active, drawer, pickingDevice, controller]);
  useEffect(() => { if (!active) { setDrawer(false); setPickingDevice(false); } }, [active]);
  useEffect(() => {
    if (!active || !state.selected) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { newChat(); return true; });
    return () => subscription.remove();
  }, [active, state.selected?.id, controller]);
  return <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="打开聊天列表" style={styles.back}
        onPress={() => { Keyboard.dismiss(); setDrawer(true); }}><Text style={styles.backText}>☰</Text></Pressable>
      <View style={styles.fill}>
        <Text numberOfLines={1} style={styles.headerTitle}>{state.selected?.name || '新聊天'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="选择电脑" onPress={() => setPickingDevice(true)}>
          <Text numberOfLines={1} style={styles.headerMeta}>{device ? `${device.name} · ${
            !ready && state.mode !== 'offline' ? '正在同步聊天…' : modeLabels[state.mode]}` : '选择电脑，开始聊天'}</Text>
        </Pressable>
      </View>
      {state.selected && <Pressable accessibilityRole="button" style={styles.compactButton} disabled={!ready || running}
        onPress={() => { void controller.archive().then(() => setDrawer(true)); }}>
        <Text style={styles.buttonText}>{state.selectedArchived ? '恢复' : '归档'}</Text></Pressable>}
    </View>
    {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    <ChatImageContext.Provider value={{ threadId: state.selected?.id ?? null, ready, load: controller.imagePreview }}>
      <ChatMessages key={state.selected?.id ?? 'new'} thread={state.selected} />
    </ChatImageContext.Provider>
    {state.approvals.some((event) => event.params.threadId === state.selected?.id) &&
      <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={styles.padded} keyboardShouldPersistTaps="handled">
        {state.approvals.filter((event) => event.params.threadId === state.selected?.id).map((event) =>
          <ChatApproval key={String(event.id)} event={event} respond={(reply) => controller.respond(reply)} />)}
      </ScrollView>}
    <ChatComposer key={state.selected?.id ?? 'new'} models={state.models} selection={state.settings}
      settingsBusy={state.settingsBusy} updateSettings={(settings) => controller.setSettings(settings)}
      ready={ready} sending={state.sending} running={running}
      send={(input) => controller.send(input)} interrupt={() => { void controller.interrupt(); }} />
    {drawer && <ChatDrawer onClose={() => setDrawer(false)}>
      <ChatThreads state={state} controller={controller} newChat={newChat} onClose={() => setDrawer(false)}
        deviceName={device?.name ?? '选择电脑'} chooseDevice={() => { setDrawer(false); setPickingDevice(true); }} />
    </ChatDrawer>}
    {pickingDevice && <ChatDevices devices={devices} onClose={() => setPickingDevice(false)}
      choose={(id) => { chooseDevice(id); setPickingDevice(false); }} />}
  </KeyboardAvoidingView>;
}
