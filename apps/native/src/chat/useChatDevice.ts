import { useCallback, useEffect, useState } from 'react';
import type { AuthSession, RemoteDevice } from '../types';
import { chatAccountKey } from './notificationTarget';
import { loadLastSelectedDevice, saveLastSelectedDevice } from './lastSelectedDevice';

interface Selection { account: string; rememberedId: string | null; selectedId: string | null }
interface Options {
  session: AuthSession; devices: RemoteDevice[]; devicesLoaded: boolean; requestedDeviceId?: string;
}

export function resolveChatDevice(options: {
  devices: RemoteDevice[]; devicesLoaded: boolean; rememberedId: string | null; selectedId?: string | null;
}) {
  const { devices, devicesLoaded, rememberedId, selectedId } = options;
  if (selectedId) return devices.find((device) => device.deviceId === selectedId);
  const remembered = devices.find((device) => device.deviceId === rememberedId);
  // Cached devices have no live presence. Do not abandon the preference before discovery finishes.
  if (remembered && (!devicesLoaded || remembered.online)) return remembered;
  return devices.find((device) => device.online) ?? remembered ?? devices[0];
}

export function useChatDevice({ session, devices, devicesLoaded, requestedDeviceId }: Options) {
  const account = chatAccountKey(session);
  const [selection, setSelection] = useState<Selection>();
  useEffect(() => {
    let active = true;
    void loadLastSelectedDevice(account).then((rememberedId) => {
      if (!active) return;
      setSelection((current) => current?.account === account && current.selectedId
        ? current : { account, rememberedId, selectedId: null });
    });
    return () => { active = false; };
  }, [account]);
  const chooseDevice = useCallback((deviceId: string) => {
    setSelection({ account, rememberedId: deviceId, selectedId: deviceId });
    void saveLastSelectedDevice(account, deviceId);
  }, [account]);
  const current = selection?.account === account ? selection : undefined;
  const selectedId = requestedDeviceId ?? current?.selectedId;
  const device = current || requestedDeviceId ? resolveChatDevice({
    devices, devicesLoaded, rememberedId: current?.rememberedId ?? null, selectedId,
  }) : undefined;
  useEffect(() => {
    if (requestedDeviceId) chooseDevice(requestedDeviceId);
  }, [requestedDeviceId, chooseDevice]);
  useEffect(() => {
    // Commit only a live initial choice; cached/offline browsing must not replace the preference.
    if (!selectedId && devicesLoaded && device?.online) chooseDevice(device.deviceId);
  }, [selectedId, devicesLoaded, device?.deviceId, device?.online, chooseDevice]);
  return { device, chooseDevice };
}
