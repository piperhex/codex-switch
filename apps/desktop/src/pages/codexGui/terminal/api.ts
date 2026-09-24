import { Channel, invoke } from "@tauri-apps/api/core";

import type { TerminalSize, TerminalInfo, TerminalEvent } from '../../../../../../shared/terminal/types';
export type { TerminalSize, TerminalInfo, TerminalEvent, TerminalApi } from '../../../../../../shared/terminal/types';

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
