import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DesktopUpdateConnection, type UpdateConnectionOptions } from './connection';
import { DESKTOP_UPDATE_CAPABILITY, isUpdateBusy, UPDATE_MESSAGES } from './protocol';

const STATUS_POLL_MS = 2_000;

export function useDesktopUpdate(options: UpdateConnectionOptions) {
  const connection = useMemo(() => new DesktopUpdateConnection(options), [options]);
  const state = useSyncExternalStore(connection.subscribe, connection.snapshot);
  useEffect(() => { connection.start(); return () => connection.stop(); }, [connection]);
  useEffect(() => {
    if (!isUpdateBusy(state.status)) return;
    const timer = setInterval(() => connection.request('status'), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [connection, state.status?.phase]);
  const device = state.devices.find((item) => item.deviceId === state.selectedId);
  const supported = device?.capabilities?.includes(DESKTOP_UPDATE_CAPABILITY) ?? false;
  const available = state.connected && !!device?.online && supported;
  const busy = state.busy || isUpdateBusy(state.status);
  let message: string = UPDATE_MESSAGES.idle;
  if (state.status) message = state.checked && state.status.phase === 'idle'
    ? UPDATE_MESSAGES.latest : UPDATE_MESSAGES[state.status.phase];
  if (state.status?.error) message = state.status.error;
  if (state.updated) message = '电脑端已更新。';
  if (!supported && device) message = UPDATE_MESSAGES.unsupported;
  if (!device?.online && device) message = UPDATE_MESSAGES.offline;
  if ((!state.connected || !device?.online) && state.status
    && ['downloading', 'installing'].includes(state.status.phase)) message = UPDATE_MESSAGES.reconnecting;
  return { ...state, device, message, select: connection.select,
    canCheck: available && !busy,
    canInstall: available && !busy && !!state.status?.latestVersion,
    check: () => connection.request('check'),
    install: (version: string) => connection.request('install', version),
  };
}
