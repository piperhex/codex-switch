import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { AuthSession } from '../types';
import { ChatController } from './controller';

export function useChat(session: AuthSession, deviceId: string, active: boolean) {
  const controller = useMemo(() => new ChatController(session, deviceId), [session, deviceId]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!active || !foreground) return;
    controller.start();
    return () => controller.stop();
  }, [active, foreground, controller]);
  useEffect(() => {
    if (!active || !foreground || (state.mode !== 'direct' && state.mode !== 'relay')) return;
    const timer = setInterval(() => { void controller.refreshSelected(); }, 15_000);
    return () => clearInterval(timer);
  }, [active, foreground, controller, state.mode]);
  return { controller, state };
}
