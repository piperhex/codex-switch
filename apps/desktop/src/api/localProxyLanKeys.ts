import type { LocalProxyLanApiKey, LocalProxyLanApiKeyInput } from "../types";
import { hasLocalBackend, invoke } from "./backend";
import { previewCopyLocalProxyLanApiKey, previewDeleteLocalProxyLanApiKey,
  previewLocalProxyLanApiKeys, previewSaveLocalProxyLanApiKey } from "./localProxyLanKeysPreview";

export async function loadLocalProxyLanApiKeys(): Promise<LocalProxyLanApiKey[]> {
  if (!hasLocalBackend) return previewLocalProxyLanApiKeys();
  return invoke<LocalProxyLanApiKey[]>("list_local_proxy_lan_api_keys");
}

export async function saveLocalProxyLanApiKey(key: LocalProxyLanApiKeyInput): Promise<LocalProxyLanApiKey[]> {
  if (!hasLocalBackend) return previewSaveLocalProxyLanApiKey(key);
  return invoke<LocalProxyLanApiKey[]>("save_local_proxy_lan_api_key", { key });
}

export async function deleteLocalProxyLanApiKey(id: string): Promise<LocalProxyLanApiKey[]> {
  if (!hasLocalBackend) return previewDeleteLocalProxyLanApiKey(id);
  return invoke<LocalProxyLanApiKey[]>("delete_local_proxy_lan_api_key", { id });
}

export async function copyLocalProxyLanApiKey(id: string): Promise<void> {
  if (!hasLocalBackend) return previewCopyLocalProxyLanApiKey(id);
  return invoke<void>("copy_local_proxy_lan_api_key", { id });
}
