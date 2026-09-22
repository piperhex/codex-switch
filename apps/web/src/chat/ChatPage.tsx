import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import type { AuthSession, RemoteDevice } from '../types';
import { ConnectedChat } from './ConnectedChat';
import { useChat } from './useChat';
import { useChatViewport } from './useChatViewport';

interface Props { session: AuthSession; devices: RemoteDevice[]; active: boolean }

export function ChatPage({ session, devices, active }: Props) {
  useLanguage();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const device = devices.find((entry) => entry.deviceId === deviceId)
    ?? devices.find((entry) => entry.online) ?? devices[0];
  useEffect(() => { if (!deviceId && device) setDeviceId(device.deviceId); }, [deviceId, device?.deviceId]);
  useChatViewport(active);
  return <section className="chat-page" hidden={!active} aria-label={t("Codex 聊天")}>
    <WebChat key={JSON.stringify([session.baseUrl, session.email, device?.deviceId])} session={session}
      device={device} devices={devices} active={active} chooseDevice={setDeviceId} />
  </section>;
}

function WebChat({ session, device, ...props }: Props & {
  device?: RemoteDevice; chooseDevice: (id: string) => void;
}) {
  const chat = useChat(session, device?.deviceId ?? '', props.active && Boolean(device));
  return <ConnectedChat {...props} chat={chat} device={device} email={session.email}
    scope={JSON.stringify([session.baseUrl, session.email, device?.deviceId ?? ''])} />;
}
