import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ApprovalReply, GuiEvent, Request } from "./types";

export const guiApi = {
  connect: () => invoke<GuiEvent[]>("codex_gui_connect"),
  async request<T>(request: Request) {
    const response = await invoke<{ data: T }>("codex_gui_request", { request });
    return response.data;
  },
  respond: (reply: ApprovalReply) => invoke<void>("codex_gui_respond", { reply }),
  subscribe: (callback: (event: GuiEvent) => void) =>
    listen<GuiEvent>("codex-gui-event", ({ payload }) => callback(payload)),
};
