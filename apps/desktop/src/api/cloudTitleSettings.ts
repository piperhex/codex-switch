import { DEFAULT_CLOUD_BASE_URL, hasLocalBackend, invoke, loadCloudAuthState } from './backend';
import { parseTitleSettings, type TitleSettings } from '../../../../shared/chat/titleSettings';

const SETTINGS_TIMEOUT_MS = 5_000;

export async function fetchCloudTitleSettings(): Promise<TitleSettings> {
  if (hasLocalBackend) {
    return parseTitleSettings(await invoke<unknown>('fetch_cloud_title_settings'));
  }
  const auth = await loadCloudAuthState();
  const base = (auth.baseUrl || DEFAULT_CLOUD_BASE_URL).replace(/\/+$/, '');
  const response = await fetch(`${base}/chat/title-settings`, {
    cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(SETTINGS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('Title settings unavailable');
  return parseTitleSettings(await response.json());
}
