import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { AuthSession } from '../types';
import { prepareChatNotifications } from './chatNotifications';
import { chatAccountKey, notificationId, parseChatNotification, type ChatNotificationTarget } from './notificationTarget';

export function useChatNotificationNavigation(session: AuthSession | null, openChat: () => void) {
  const [target, setTarget] = useState<ChatNotificationTarget | null>(null);
  const [error, setError] = useState('');
  const opened = useRef<string | null>(null);
  const account = session ? chatAccountKey(session) : null;
  useEffect(() => {
    const receive = (response: Notifications.NotificationResponse) => {
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const next = parseChatNotification(response.notification.request.content.data);
      if (next) setTarget(next);
    };
    // Subscribe first so a tap while the initial response loads cannot be lost.
    let tapped = false;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      tapped = true; receive(response);
    });
    let cancelled = false;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!cancelled && !tapped && response) receive(response);
    }).catch(() => setError('暂时无法打开通知，请进入聊天查看回复。'));
    return () => { cancelled = true; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    let checking = false;
    const check = async () => {
      if (checking || AppState.currentState !== 'active') return;
      checking = true;
      try {
        const granted = await prepareChatNotifications();
        if (!cancelled) setError(granted ? '' : '开启通知后，回复完成时会提醒你。');
      } catch { if (!cancelled) setError('通知暂不可用，请检查系统通知设置。'); }
      finally { checking = false; }
    };
    void check();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => { cancelled = true; subscription.remove(); };
  }, [account]);
  useEffect(() => {
    if (!target || !account) return;
    if (target.account !== account) { setTarget(null); return; }
    const id = notificationId(target);
    if (opened.current === id) return;
    opened.current = id;
    openChat();
  }, [target, account, openChat]);
  const handled = useCallback((id: string) => {
    setTarget((current) => current && notificationId(current) === id ? null : current);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const last = parseChatNotification(response?.notification.request.content.data);
      if (last && notificationId(last) === id) return Notifications.clearLastNotificationResponseAsync();
    }).catch(() => console.warn('Could not clear handled chat notification.'));
  }, []);
  return { target: target?.account === account ? target : null, error, handled };
}
