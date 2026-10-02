import { guiText } from "../../i18n/guiText";

export const MODEL_CATALOG_TIMEOUT_MS = 20_000;

/** Bound waits before the backend timeout starts; callers must still ignore late IPC replies. */
export async function withModelCatalogTimeout<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      abort = () => reject(new Error(guiText("模型正在同步，请稍后重试。")));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error(guiText("模型加载超时，请重试。"))), MODEL_CATALOG_TIMEOUT_MS);
    })]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}
