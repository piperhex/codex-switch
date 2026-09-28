import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import { ChatConnection } from '../../../../../../shared/remote-chat/client/connection';
import { setChatConnectionMode } from '../../../../../../shared/remote-chat/policy';
import { createDesktopPeer } from '../../../remoteChat/peer';
import { NativeGuiSocket } from './nativeSocket';
import type { GuiCloudIdentity } from './types';

const HISTORY_REFRESH_MS = 15_000;

export function useRemoteGui(identity: GuiCloudIdentity, deviceId: string, active: boolean) {
  const controller = useMemo(() => new ChatController((events) => new ChatConnection({
    ...events, deviceId, tcpPunch: true, managePolicyMode: false,
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    authorize: async () => ({ baseUrl: identity.baseUrl, accessToken: '' }),
    createSocket: () => new NativeGuiSocket(identity),
    createPeer: createDesktopPeer,
  })), [identity.baseUrl, identity.userId, deviceId]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  useEffect(() => {
    if (!active) return;
    setChatConnectionMode(state.mode);
    return () => setChatConnectionMode('offline');
  }, [active, state.mode]);
  useEffect(() => {
    if (!active || !state.ready) return;
    const refresh = () => { void controller.refreshSelected(); };
    refresh();
    const timer = setInterval(refresh, HISTORY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, state.ready, controller]);
  return { controller, state, foreground: true };
}
