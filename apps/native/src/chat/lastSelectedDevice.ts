import * as SecureStore from 'expo-secure-store';

const STORAGE_PREFIX = 'codex-switch.mobile.last-selected-device.v1';
let pendingSave = Promise.resolve();

export async function loadLastSelectedDevice(account: string): Promise<string | null> {
  try {
    await pendingSave;
    return await SecureStore.getItemAsync(`${STORAGE_PREFIX}.${account}`);
  } catch {
    // Device discovery remains available when local preferences cannot be read.
    return null;
  }
}

export function saveLastSelectedDevice(account: string, deviceId: string): Promise<void> {
  // Keep rapid selections in order, including across page remounts.
  pendingSave = pendingSave.then(() => SecureStore.setItemAsync(`${STORAGE_PREFIX}.${account}`, deviceId))
    .catch(() => { console.warn('Could not remember the selected chat computer.'); });
  return pendingSave;
}
