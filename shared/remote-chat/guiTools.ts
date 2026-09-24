import type { TerminalEvent, TerminalInfo, TerminalSize } from '../terminal/types';

export interface CliRelease { version: string; size: number }
export interface CliProgress { downloaded: number; total: number; phase: 'downloading' | 'installing' }
export interface RemoteCliStatus {
  version: string | null;
  installing: boolean;
  progress: CliProgress | null;
  error: string;
}
export const GUI_TOOL_OPERATIONS = new Set([
  'guiCliStatus', 'guiCliRelease', 'guiCliInstall', 'guiReconnect',
  'guiTerminalOpen', 'guiTerminalRead', 'guiTerminalWrite', 'guiTerminalResize', 'guiTerminalClose',
]);

/** Requests use the selected computer's authenticated chat connection. */
export function createGuiToolsClient(request: <T>(body: object) => Promise<T>) {
  return {
    status: () => request<RemoteCliStatus>({ operation: 'guiCliStatus' }),
    release: () => request<CliRelease>({ operation: 'guiCliRelease' }),
    install: (version: string) => request<RemoteCliStatus>({ operation: 'guiCliInstall', version }),
    reconnect: () => request<void>({ operation: 'guiReconnect' }),
    terminal: {
      open: (cwd: string, size: TerminalSize) =>
        request<TerminalInfo>({ operation: 'guiTerminalOpen', cwd, size }),
      read: (id: string) => request<TerminalEvent[]>({ operation: 'guiTerminalRead', id }),
      write: (id: string, data: string) => request<void>({ operation: 'guiTerminalWrite', id, data }),
      resize: (id: string, size: TerminalSize) => request<void>({ operation: 'guiTerminalResize', id, size }),
      close: (id: string) => request<void>({ operation: 'guiTerminalClose', id }),
    },
  };
}

export type GuiToolsClient = ReturnType<typeof createGuiToolsClient>;
