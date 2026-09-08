import { invoke, isHostedWebApp } from "../../api/backend";
import { subscribeGuiEvent } from "./webEvents";
import type { ApprovalReply, GuiEvent, Request } from "./types";

const MAX_WEB_REQUEST_BYTES = 8 * 1024 * 1024;

export const guiApi = {
  connect: () => invoke<GuiEvent[]>("codex_gui_connect"),
  async request<T>(request: Request) {
    if (isHostedWebApp && new TextEncoder().encode(JSON.stringify({ command: "codex_gui_request", args: { request } }))
      .length > MAX_WEB_REQUEST_BYTES) {
      throw new Error("消息太大，请减少图片或缩小图片后再发送。");
    }
    const response = await invoke<{ data: T }>("codex_gui_request", { request });
    return response.data;
  },
  respond: (reply: ApprovalReply) => invoke<void>("codex_gui_respond", { reply }),
  subscribe: (callback: (event: GuiEvent) => void) =>
    subscribeGuiEvent<GuiEvent>("codex-gui-event", callback),
};
