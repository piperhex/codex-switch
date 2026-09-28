import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { adminRequest } from '../api/client';
import type { AuthSession } from '../types';
import { chatAccountKey } from './notificationTarget';
import { prepareChatNotifications } from './chatNotifications';

/** iOS uses APNs through Expo; Android retains its existing foreground service. */
export function useChatPush(session: AuthSession | null) {
  const account = session ? chatAccountKey(session) : null;
  useEffect(() => {
    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    if (!session || !projectId || Platform.OS !== 'ios') return;
    let active = true;
    let running = false;
    let token: string | undefined;
    const remove = async (value: string) => {
      try { await adminRequest(session, '/chat-push/subscription', {
        method: 'DELETE', body: JSON.stringify({ token: value }),
      }); } catch { console.warn('Chat push subscription could not be removed.'); }
    };
    const register = async () => {
      if (!active || running || AppState.currentState !== 'active') return;
      running = true;
      try {
        const status = await adminRequest<{ enabled: boolean }>(session, '/chat-push/status');
        if (!active || !status.enabled || !await prepareChatNotifications()) return;
        const next = await Notifications.getExpoPushTokenAsync({ projectId });
        if (!active) return;
        token = next.data;
        await adminRequest(session, '/chat-push/subscription', {
          method: 'POST', body: JSON.stringify({ token, account }),
        });
        if (!active) await remove(next.data);
      } catch { console.warn('Chat push registration is unavailable.'); }
      finally { running = false; }
    };
    void register();
    const state = AppState.addEventListener('change', value => { if (value === 'active') void register(); });
    const changed = Notifications.addPushTokenListener(() => { void register(); });
    return () => { active = false; state.remove(); changed.remove(); if (token) void remove(token); };
  }, [session, account]);
}
