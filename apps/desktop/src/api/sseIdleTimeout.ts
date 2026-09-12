import { hasLocalBackend, invoke, loadAppSettings } from "./backend";

export interface SseIdleTimeoutSettings {
  enabled: boolean;
  timeoutSeconds: number;
}

export const DEFAULT_SSE_IDLE_TIMEOUT: SseIdleTimeoutSettings = { enabled: true, timeoutSeconds: 120 };
export const MAX_SSE_IDLE_TIMEOUT_SECONDS = 3_600;
const PREVIEW_KEY = "codex-switch.sse-idle-timeout";

export async function loadSseIdleTimeout(): Promise<SseIdleTimeoutSettings> {
  if (!hasLocalBackend) {
    const saved = window.localStorage.getItem(PREVIEW_KEY);
    return saved ? JSON.parse(saved) as SseIdleTimeoutSettings : DEFAULT_SSE_IDLE_TIMEOUT;
  }
  return (await loadAppSettings()).sseIdleTimeout ?? DEFAULT_SSE_IDLE_TIMEOUT;
}

export async function saveSseIdleTimeout(settings: SseIdleTimeoutSettings): Promise<SseIdleTimeoutSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(PREVIEW_KEY, JSON.stringify(settings));
    return settings;
  }
  return invoke<SseIdleTimeoutSettings>("set_sse_idle_timeout", { settings });
}
