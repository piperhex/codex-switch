import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import type { AuthSession } from '../types';
import { ChatController } from './controller';
import { CHAT_SERVICE_STOPPED } from './backgroundConnection';

export function useChat(session: AuthSession, deviceId: string, enabled: boolean) {
  const controller = useMemo(() => new ChatController(session, deviceId), [session, deviceId]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!enabled) return;
    controller.start();
    const stopped = DeviceEventEmitter.addListener(CHAT_SERVICE_STOPPED, () => controller.stop());
    const resumed = AppState.addEventListener('change', (next) => {
      if (next === 'active') { controller.start(); void controller.refreshSelected(); }
    });
    return () => { stopped.remove(); resumed.remove(); controller.stop(); };
  }, [enabled, controller]);
  useEffect(() => {
    if (!enabled || !foreground || (state.mode !== 'direct' && state.mode !== 'relay')) return;
    const timer = setInterval(() => { void controller.refreshSelected(); }, 15_000);
    return () => clearInterval(timer);
  }, [enabled, foreground, controller, state.mode]);
  return { controller, state, foreground };
}
