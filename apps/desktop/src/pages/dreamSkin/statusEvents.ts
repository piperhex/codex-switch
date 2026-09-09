import type { DreamSkinStatus } from "../../types";

export const DREAM_SKIN_STATUS_CHANGED = "codex-switch:dream-skin-status-changed";

export function publishDreamSkinStatus(status: DreamSkinStatus) {
  window.dispatchEvent(new CustomEvent(DREAM_SKIN_STATUS_CHANGED, { detail: status }));
}
