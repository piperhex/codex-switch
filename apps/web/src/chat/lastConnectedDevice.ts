import type { AuthSession } from '../types';

const STORAGE_PREFIX = 'codex-switch.web.last-connected-device.v1';

function storageKey(session: AuthSession) {
  return `${STORAGE_PREFIX}.${encodeURIComponent(`${session.baseUrl}|${session.email.toLowerCase()}`)}`;
}

export function loadLastConnectedDevice(session: AuthSession): string | null {
  try {
    return localStorage.getItem(storageKey(session));
  } catch {
    return null;
  }
}

export function saveLastConnectedDevice(session: AuthSession, deviceId: string) {
  try {
    localStorage.setItem(storageKey(session), deviceId);
  } catch {
    // Remembering a computer is optional when browser storage is unavailable.
  }
}
