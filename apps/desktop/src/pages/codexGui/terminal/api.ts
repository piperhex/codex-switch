import { Channel, invoke } from "@tauri-apps/api/core";

export interface TerminalSize { cols: number; rows: number }
export interface TerminalInfo { id: string; cwd: string; shell: string }
export type TerminalEvent = { type: "output"; data: number[] }
  | { type: "exit"; code: number | null } | { type: "error"; message: string };

export const terminalApi = {
  open(cwd: string, size: TerminalSize, onEvent: (event: TerminalEvent) => void) {
    const onEventChannel = new Channel<TerminalEvent>();
    onEventChannel.onmessage = onEvent;
    return invoke<TerminalInfo>("codex_gui_terminal_open", {
      request: { cwd: cwd || null, size }, onEvent: onEventChannel,
    });
  },
  write: (id: string, data: string) => invoke<void>("codex_gui_terminal_command", {
    request: { type: "write", id, data },
  }),
  resize: (id: string, size: TerminalSize) => invoke<void>("codex_gui_terminal_command", {
    request: { type: "resize", id, size },
  }),
  close: (id: string) => invoke<void>("codex_gui_terminal_command", { request: { type: "close", id } }),
};
