import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import type { AuthSession, RemoteDevice } from '../types';
import { ConnectedChat } from './ConnectedChat';
import { ChatTerminal } from './ChatTerminal';
import { useChat } from './useChat';
import { useChatViewport } from './useChatViewport';
import { loadLastConnectedDevice } from './lastConnectedDevice';

interface Props { session: AuthSession; devices: RemoteDevice[]; active: boolean }

export function ChatPage({ session, devices, active }: Props) {
  useLanguage();
  const [lastConnectedDeviceId] = useState(() => loadLastConnectedDevice(session));
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const device = devices.find((entry) => entry.deviceId === deviceId)
    ?? devices.find((entry) => entry.deviceId === lastConnectedDeviceId && entry.online)
    ?? devices.find((entry) => entry.online);
  useEffect(() => {
    if (device && deviceId !== device.deviceId) setDeviceId(device.deviceId);
  }, [deviceId, device?.deviceId]);
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
    headerActions={<ChatTerminal client={chat.controller.guiTools.terminal} active={props.active}
      connected={chat.state.ready} deviceName={device?.name}
      cwd={chat.state.selected?.cwd ?? chat.state.draftProject?.cwd ?? ''} />}
    scope={JSON.stringify([session.baseUrl, session.email, device?.deviceId ?? ''])} />;
}
