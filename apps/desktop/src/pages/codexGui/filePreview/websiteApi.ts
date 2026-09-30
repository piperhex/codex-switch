import { invoke } from "@tauri-apps/api/core";

export interface WebsitePreviewRequest {
  id: string;
  url: string;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export const websitePreviewApi = {
  sync: (request: WebsitePreviewRequest) => invoke<void>("codex_gui_sync_website_preview", { request }),
  close: (id: string) => invoke<void>("codex_gui_close_website_preview", { id }),
};

/** Coalesce resize events and finish pending creation before closing its native view. */
export function websitePreviewSession(onError: () => void) {
  const id = crypto.randomUUID();
  let pending: WebsitePreviewRequest | undefined;
  let flight: Promise<void> | undefined;
  let closed = false;
  let failed = false;
  const flush = async () => {
    while (pending && !closed) {
      const request = pending;
      pending = undefined;
      try { await websitePreviewApi.sync(request); }
      catch {
        failed = true; pending = undefined;
        try { await websitePreviewApi.close(id); }
        catch (error) { console.error("Failed to release unavailable website preview", error); }
        if (!closed) onError();
      }
    }
  };
  return {
    update: (request: Omit<WebsitePreviewRequest, "id">) => {
      if (closed || failed) return;
      pending = { ...request, id };
      if (!flight) flight = flush().finally(() => { flight = undefined; });
    },
    close: async () => {
      closed = true; pending = undefined;
      await flight;
      await websitePreviewApi.close(id);
    },
  };
}
