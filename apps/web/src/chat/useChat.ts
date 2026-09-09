import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { apiJson, getActiveSession } from '../api';
import type { AuthSession } from '../types';
import { ChatConnection } from '../../../../shared/remote-chat/client/connection';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { RtcPeer } from '../../../../shared/remote-chat/rtcPeer';

const HISTORY_REFRESH_MS = 15_000;

function createController(session: AuthSession, deviceId: string) {
  return new ChatController((events) => new ChatConnection({ ...events, deviceId,
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    authorize: async () => {
      await apiJson('/auth/me');
      const current = getActiveSession();
      if (!current || current.baseUrl !== session.baseUrl || current.email !== session.email) {
        throw new Error('请重新登录后连接电脑。');
      }
      return current;
    },
    createPeer: (options) => new RtcPeer(options, () => new RTCPeerConnection({ iceServers: options.iceServers })),
  }));
}

export function useChat(session: AuthSession, deviceId: string, active: boolean) {
  // Token refresh keeps the same conversation; reconnect reads the renewed account credentials.
  const controller = useMemo(() => createController(session, deviceId), [session.baseUrl, session.email, deviceId]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [foreground, setForeground] = useState(document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setForeground(document.visibilityState === 'visible');
    const hide = () => setForeground(false);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', update);
    };
  }, []);
  useEffect(() => {
    if (!active || !foreground) return;
    controller.start();
    return () => controller.stop();
  }, [active, foreground, controller]);
  useEffect(() => {
    if (!active || !foreground || (state.mode !== 'direct' && state.mode !== 'relay')) return;
    const timer = window.setInterval(() => { void controller.refreshSelected(); }, HISTORY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, foreground, controller, state.mode]);
  return { controller, state };
}
