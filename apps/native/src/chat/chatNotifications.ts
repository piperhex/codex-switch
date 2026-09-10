import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { notificationId, type ChatNotificationTarget } from './notificationTarget';

const COMPLETION_CHANNEL = 'chat-completed';
const MAX_NOTICES = 512;
const delivered = new Set<string>();
let askedPermission = false;
let setup: Promise<void> | undefined;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  }),
});
async function prepareChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(COMPLETION_CHANNEL, {
    name: '聊天回复完成', description: '电脑上的 Codex 回复完成后提醒你',
    importance: Notifications.AndroidImportance.HIGH, sound: 'default',
    vibrationPattern: [0, 200, 100, 200], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}
function setupNotifications() {
  setup ??= prepareChannel().catch((error: unknown) => { setup = undefined; throw error; });
  return setup;
}
export async function prepareChatNotifications() {
  await setupNotifications();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain && !askedPermission && AppState.currentState === 'active') {
    askedPermission = true;
    permission = await Notifications.requestPermissionsAsync();
  }
  return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function notifyChatCompleted(target: ChatNotificationTarget, title: string, failed: boolean) {
  const identifier = notificationId(target);
  if (delivered.has(identifier)) return;
  delivered.add(identifier);
  if (delivered.size > MAX_NOTICES) delivered.delete(delivered.values().next().value!);
  try {
    await setupNotifications();
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title: failed ? 'Codex 回复未完成' : 'Codex 回复完成',
        body: title.slice(0, 100) || '点击查看对话', data: { ...target }, sound: 'default',
        autoDismiss: true, priority: Notifications.AndroidNotificationPriority.HIGH },
      trigger: Platform.OS === 'android' ? { channelId: COMPLETION_CHANNEL } : null,
    });
  } catch (error) { delivered.delete(identifier); throw error; }
}
