import { guiText } from "../../i18n/guiText";
import type { GuiModelCatalog } from "./modelCatalog";
import { subscribeGuiEvent } from "./webEvents";
import { isHostedWebApp, subscribeToProviderEvents } from "../../api/backend";

// Codex refreshes its remote catalog in the background; copy updates into the shared UI state.
export const MODEL_CATALOG_REFRESH_MS = 60_000;

export function watchModelCatalog(catalog: GuiModelCatalog, report: (error: unknown) => void) {
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  let observed: Promise<void> | undefined;
  const failed = () => { if (!stopped) report(guiText("模型列表暂时无法更新，请稍后重试。")); };
  const refresh = (invalidate = false) => {
    const pending = invalidate ? catalog.invalidate() : catalog.refresh();
    if (observed === pending) return;
    observed = pending;
    void pending.catch(failed).finally(() => { if (observed === pending) observed = undefined; });
  };
  const timer = setInterval(refresh, MODEL_CATALOG_REFRESH_MS);
  // Hosted subscriptions poll without a change signal; invalidating every tick starves slow reads.
  const stopProviders = subscribeToProviderEvents(() => { if (!stopped) refresh(!isHostedWebApp); });
  void subscribeGuiEvent("codex-gui-account-changed", () => {
    if (!stopped) refresh(true);
  }).then((stop) => {
    if (stopped) stop();
    else unsubscribe = stop;
  }).catch(failed);
  return () => { stopped = true; clearInterval(timer); stopProviders(); unsubscribe?.(); };
}
