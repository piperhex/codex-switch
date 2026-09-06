import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isDesktopApp } from "./backend";

const OFFICIAL_MODEL_REFRESH_FAILED_EVENT = "official-model-refresh-failed";

interface OfficialModelRefreshFailure {
  usingCachedCatalog: boolean;
}

export function subscribeToOfficialModelRefreshFailures(
  onFailure: (failure: OfficialModelRefreshFailure) => void,
): () => void {
  if (!isDesktopApp) return () => undefined;

  let active = true;
  let unlisten: UnlistenFn | undefined;
  void listen<OfficialModelRefreshFailure>(OFFICIAL_MODEL_REFRESH_FAILED_EVENT, ({ payload }) => {
    if (active) onFailure(payload);
  }).then((unsubscribe) => {
    if (active) unlisten = unsubscribe;
    else unsubscribe();
  }).catch(() => {
    console.debug("Official model refresh notifications are unavailable.");
  });

  return () => {
    active = false;
    unlisten?.();
  };
}
