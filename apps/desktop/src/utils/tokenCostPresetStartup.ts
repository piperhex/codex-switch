import { invoke } from "@tauri-apps/api/core";
import {
  applyTokenCostPresets, reloadCachedTokenCostPresets, TOKEN_COST_CATALOG_STORAGE_KEY,
  TOKEN_COST_REFERENCE_MODEL_EVENT,
} from "./tokenCostPresets";

let startupRequest: Promise<void> | undefined;

// Called outside React so StrictMode and component remounts never repeat the startup fetch.
export function refreshTokenCostPresetsOnce(): Promise<void> {
  startupRequest ??= invoke<unknown>("fetch_cloud_token_cost_presets")
    .then((document) => { applyTokenCostPresets(document); })
    .catch(() => { /* Offline startup retains the last validated cache or bundled prices. */ });
  return startupRequest;
}

export function subscribeToTokenCostPresetStorage() {
  const reload = (event: StorageEvent) => {
    if (event.key !== TOKEN_COST_CATALOG_STORAGE_KEY && event.key !== null) return;
    reloadCachedTokenCostPresets();
    window.dispatchEvent(new CustomEvent(TOKEN_COST_REFERENCE_MODEL_EVENT));
  };
  window.addEventListener("storage", reload);
  return () => window.removeEventListener("storage", reload);
}