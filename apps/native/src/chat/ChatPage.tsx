import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { AuthSession, RemoteDevice } from '../types';
import { ChatApproval } from './ChatApprovals';
import { ChatComposer } from './ChatComposer';
import { ChatQueue } from './ChatQueue';
import { queueProps } from '../../../../shared/remote-chat/client/queueProps';
import { ChatMessages } from './ChatMessages';
import { ChatProcessing } from './ChatProcessing';
import { ChatImageContext } from './ChatImage';
import { ChatThreads } from './ChatThreads';
import { ChatAccountPicker, type ChatAccountSelection } from './ChatAccountPicker';
import { ChatDrawer, type ChatDrawerMethods } from './ChatDrawer';
import { ChatDevices } from './ChatDevices';
import { useChat } from './useChat';
import { useChatDrawerSwipe } from './useChatDrawerSwipe';
import { useChatBackground } from './useChatBackground';
import { useChatCompletionNotifications, useOpenChatNotification } from './useChatNotifications';
import { notificationId, type ChatNotificationTarget } from './notificationTarget';
import { styles } from './styles';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import type { ChatProject } from './types';
import { compactUnavailableReason } from '../../../../shared/remote-chat/client/composerCommands';

interface Props {
  session: AuthSession; devices: RemoteDevice[]; active: boolean;
  notification: ChatNotificationTarget | null; notificationError: string;
  notificationHandled: (id: string) => void;
  accountSelection: ChatAccountSelection;
}
const modeLabels = { connecting: '正在连接…', direct: '已直连', relay: '通过服务器连接', offline: '等待重新连接' };

export function ChatPage(props: Props) {
  const { session, devices, active, notification, notificationError, notificationHandled, accountSelection } = props;
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const requestedId = notification?.deviceId ?? deviceId;
  const device = requestedId ? devices.find((entry) => entry.deviceId === requestedId)
    : devices.find((entry) => entry.online) ?? devices[0];
  useEffect(() => { if (notification) setDeviceId(notification.deviceId); }, [notification]);
  const backgroundError = useChatBackground(Boolean(device));
  const chooseDevice = (id: string) => {
    if (notification) notificationHandled(notificationId(notification));
    setDeviceId(id);
  };
  useEffect(() => { if (!deviceId && device) setDeviceId(device.deviceId); }, [deviceId, device?.deviceId]);
  return <View style={[styles.page, !active && styles.hidden]}>
    {notification && devices.length > 0 && !device && <Text style={styles.error}>
      通知对应的电脑暂不可用，请选择其他电脑。</Text>}
    {!!backgroundError && <Text accessibilityRole="alert" style={styles.error}>{backgroundError}</Text>}
    {!!notificationError && <Pressable accessibilityRole="button" accessibilityLabel="打开通知设置"
      onPress={() => { void Linking.openSettings(); }}><Text style={styles.error}>{notificationError}</Text></Pressable>}
    <ConnectedChat key={`${session.baseUrl}:${session.email}:${device?.deviceId ?? ''}`} session={session}
      device={device} devices={devices} active={active} chooseDevice={chooseDevice}
      accountSelection={accountSelection}
      notification={notification} notificationError={notificationError} notificationHandled={notificationHandled} />
  </View>;
}

function ConnectedChat({ session, device, devices, active, chooseDevice, notification, notificationHandled,
  accountSelection }: Props & {
  device?: RemoteDevice; chooseDevice: (id: string) => void;
}) {
  const { state, controller, foreground, catalog } = useChat(session, device?.deviceId ?? '', Boolean(device));
  useChatCompletionNotifications(controller, session, device?.deviceId ?? '');
  useOpenChatNotification({ controller, target: notification?.deviceId === device?.deviceId ? notification : null,
    ready: state.ready, sending: state.sending, handled: notificationHandled });
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<ChatDrawerMethods>(null);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const [pickingDevice, setPickingDevice] = useState(false);
  useEffect(() => {
    if (notification) { afterClose.current = undefined; drawerRef.current?.closeDrawer(); setPickingDevice(false); }
  }, [notification]);
  const ready = state.ready;
  const runningTurn = state.selected?.turns?.find((turn) => turn.status === 'inProgress');
  const running = Boolean(runningTurn);
  const openDrawer = useCallback(() => { Keyboard.dismiss(); setDrawer(true); drawerRef.current?.openDrawer(); }, []);
  const drawerSwipeHandlers = useChatDrawerSwipe(active && !drawer && !pickingDevice, openDrawer);
  const closeDrawer = (action?: () => void) => { afterClose.current = action; drawerRef.current?.closeDrawer(); };
  const closed = useCallback(() => {
    setDrawer(false);
    const action = afterClose.current;
    afterClose.current = undefined;
    action?.();
  }, []);
  const newChat = (project?: ChatProject) => { if (!state.sending) closeDrawer(() => controller.back(project)); };
  useEffect(() => { controller.setViewing(active && foreground && !drawer && !pickingDevice); },
    [active, foreground, drawer, pickingDevice, controller]);
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
      accountPicker={<ChatAccountPicker {...accountSelection} device={device} active={active && drawer} />}
      select={(thread) => closeDrawer(() => { void controller.select(thread); })} />}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      {...drawerSwipeHandlers}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="打开聊天列表" style={styles.back}
        onPress={openDrawer}><Text style={styles.backText}>☰</Text></Pressable>
      <View style={styles.fill}>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {state.selected ? threadPresentation(state.selected, state.sidebar).title : '新聊天'}</Text>
        {!state.selected && state.draftProject && <Text numberOfLines={1} style={styles.headerMeta}>
          {state.draftProject.label}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="选择电脑" onPress={() => setPickingDevice(true)}>
          <Text numberOfLines={1} style={styles.headerMeta}>{device ? `${device.name} · ${
            !ready && state.mode !== 'offline' ? '正在同步聊天…' : modeLabels[state.mode]}` : '选择电脑，开始聊天'}</Text>
        </Pressable>
      </View>
      {state.selected && state.selectedArchived && <Pressable accessibilityRole="button"
        style={styles.compactButton} disabled={!ready || running}
        onPress={() => { void controller.archive().then(openDrawer); }}>
        <Text style={styles.buttonText}>恢复</Text></Pressable>}
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
    <ChatQueue {...queueProps(state, controller)} />
    <ChatComposer threadId={state.selected?.id ?? null} models={state.models} selection={state.settings}
      catalog={catalog} cwd={state.selected?.cwd ?? state.draftProject?.cwd ?? ''}
      compactReason={compactUnavailableReason(state)} compacting={!!state.compacting
        && state.compacting === state.selected?.id} compact={controller.compact}
      settingsBusy={state.settingsBusy} settingsError={state.settingsError}
      updateSettings={(settings) => controller.setSettings(settings)}
      active={active} ready={ready} sending={state.sending} running={running}
      send={(input) => controller.send(input)} interrupted={state.selected?.turns?.at(-1)?.status === 'interrupted'}
      interrupt={() => controller.interrupt()} />
    {pickingDevice && <ChatDevices devices={devices} onClose={() => setPickingDevice(false)}
      choose={(id) => { chooseDevice(id); setPickingDevice(false); }} />}
  </KeyboardAvoidingView></ChatDrawer>;
}
