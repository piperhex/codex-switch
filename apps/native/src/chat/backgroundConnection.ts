import { AppRegistry, DeviceEventEmitter, NativeModules, Platform } from 'react-native';

export const CHAT_SERVICE_STOPPED = 'codexChatConnectionStopped';
interface ChatBackgroundModule { start: () => Promise<boolean>; stop: () => Promise<void> }
const native: ChatBackgroundModule | undefined = NativeModules.ChatBackground;
let operation = Promise.resolve();

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('CodexChatConnection', () => () => new Promise<void>((resolve) => {
    const subscription = DeviceEventEmitter.addListener(CHAT_SERVICE_STOPPED, () => {
      subscription.remove(); resolve();
    });
  }));
}

export function keepChatConnected(enabled: boolean): Promise<void> {
  const next = operation.then(async () => {
    if (Platform.OS !== 'android') return;
    if (!native) throw new Error('请安装新版应用以使用后台聊天。');
    if (enabled) await native.start();
    else await native.stop();
  });
  operation = next.catch(() => undefined);
  return next;
}
