import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { AuthSession, RemoteDevice } from '../types';
import { ChatApproval } from './ChatApprovals';
import { ChatComposer } from './ChatComposer';
import { ChatMessages } from './ChatMessages';
import { ChatProcessing } from './ChatProcessing';
import { ChatImageContext } from './ChatImage';
import { ChatThreads } from './ChatThreads';
import { ChatDrawer, type ChatDrawerMethods } from './ChatDrawer';
import { ChatDevices } from './ChatDevices';
import { useChat } from './useChat';
import { styles } from './styles';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';

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
  const drawerRef = useRef<ChatDrawerMethods>(null);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const [pickingDevice, setPickingDevice] = useState(false);
  const ready = state.ready;
  const runningTurn = state.selected?.turns?.find((turn) => turn.status === 'inProgress');
  const running = Boolean(runningTurn);
  const openDrawer = () => { Keyboard.dismiss(); setDrawer(true); drawerRef.current?.openDrawer(); };
  const closeDrawer = (action?: () => void) => { afterClose.current = action; drawerRef.current?.closeDrawer(); };
  const closed = useCallback(() => {
    setDrawer(false);
    const action = afterClose.current;
    afterClose.current = undefined;
    action?.();
  }, []);
  const newChat = () => { if (!state.sending) closeDrawer(() => controller.back()); };
  useEffect(() => { controller.setViewing(active && !drawer && !pickingDevice); },
    [active, drawer, pickingDevice, controller]);
  useEffect(() => {
    if (!active) { afterClose.current = undefined; drawerRef.current?.closeDrawer(); setPickingDevice(false); }
  }, [active]);
  useEffect(() => {
    if (!active || pickingDevice || (!drawer && !state.selected)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawer) closeDrawer();
      else if (!state.sending) controller.back();
      return true;
    });
    return () => subscription.remove();
  }, [active, drawer, pickingDevice, state.selected?.id, state.sending, controller]);
  return <ChatDrawer ref={drawerRef} enabled={active && !pickingDevice}
    onOpen={() => setDrawer(true)} onMoving={() => setDrawer(true)} onClose={closed}
    navigation={<ChatThreads state={state} controller={controller} newChat={newChat} onClose={() => closeDrawer()}
      deviceName={device?.name ?? '选择电脑'} chooseDevice={() => closeDrawer(() => setPickingDevice(true))}
      select={(thread) => closeDrawer(() => { void controller.select(thread); })} />}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="打开聊天列表" style={styles.back}
        onPress={openDrawer}><Text style={styles.backText}>☰</Text></Pressable>
      <View style={styles.fill}>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {state.selected ? threadPresentation(state.selected, state.sidebar).title : '新聊天'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="选择电脑" onPress={() => setPickingDevice(true)}>
          <Text numberOfLines={1} style={styles.headerMeta}>{device ? `${device.name} · ${
            !ready && state.mode !== 'offline' ? '正在同步聊天…' : modeLabels[state.mode]}` : '选择电脑，开始聊天'}</Text>
        </Pressable>
      </View>
      {state.selected && <Pressable accessibilityRole="button" style={styles.compactButton} disabled={!ready || running}
        onPress={() => { void controller.archive().then(openDrawer); }}>
        <Text style={styles.buttonText}>{state.selectedArchived ? '恢复' : '归档'}</Text></Pressable>}
    </View>
    {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    <ChatImageContext.Provider value={{ threadId: state.selected?.id ?? null, ready, load: controller.imagePreview }}>
      <ChatMessages key={state.selected?.id ?? 'new'} thread={state.selected}
        loading={state.historyLoading} loadingMore={state.historyLoadingMore} hasMore={state.historyHasMore}
        loadOlder={() => controller.loadOlder()} />
    </ChatImageContext.Provider>
    {runningTurn && <ChatProcessing key={runningTurn.id} turn={runningTurn} active={active && ready} />}
    {state.approvals.some((event) => event.params.threadId === state.selected?.id) &&
      <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={styles.padded} keyboardShouldPersistTaps="handled">
        {state.approvals.filter((event) => event.params.threadId === state.selected?.id).map((event) =>
          <ChatApproval key={String(event.id)} event={event} respond={(reply) => controller.respond(reply)} />)}
      </ScrollView>}
    <ChatComposer threadId={state.selected?.id ?? null} models={state.models} selection={state.settings}
      settingsBusy={state.settingsBusy} settingsError={state.settingsError}
      updateSettings={(settings) => controller.setSettings(settings)}
      active={active} ready={ready} sending={state.sending} running={running}
      send={(input) => controller.send(input)} interrupt={() => { void controller.interrupt(); }} />
    {pickingDevice && <ChatDevices devices={devices} onClose={() => setPickingDevice(false)}
      choose={(id) => { chooseDevice(id); setPickingDevice(false); }} />}
  </KeyboardAvoidingView></ChatDrawer>;
}
