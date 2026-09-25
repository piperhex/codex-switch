import * as SecureStore from 'expo-secure-store';
import type { StartupUpdateOptions } from '../../../../shared/app-update/useStartupUpdate';
import { checkForAppUpdate, getAndroidUpdateDownloadState,
  refreshAndroidUpdateDownloadState, type AppRelease } from './appUpdate';

const IGNORED_VERSION_KEY = 'codex-switch.mobile.ignored-update-version.v1';

export const startupUpdateOptions: StartupUpdateOptions<AppRelease> = {
  async check() {
    const [result] = await Promise.all([
      checkForAppUpdate(),
      refreshAndroidUpdateDownloadState(),
    ]);
    const download = getAndroidUpdateDownloadState();
    // Existing downloads already have their own progress and installation prompt.
    if (download.status === 'downloading' || download.status === 'downloaded') return null;
    return result.updateAvailable ? result.release : null;
  },
  readIgnoredVersion: () => SecureStore.getItemAsync(IGNORED_VERSION_KEY),
  writeIgnoredVersion: (version) => SecureStore.setItemAsync(IGNORED_VERSION_KEY, version),
};
