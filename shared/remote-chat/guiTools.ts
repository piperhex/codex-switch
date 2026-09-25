import type { TerminalRead, TerminalInfo, TerminalSize } from '../terminal/types';
import type { GitChanges, GitCommitRequest, GitDiff, GitHistory } from './gitTypes';

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
  'guiTerminalList', 'guiTerminalOpen', 'guiTerminalRead', 'guiTerminalWrite', 'guiTerminalResize', 'guiTerminalClose',
  'guiGitChanges', 'guiGitDiff', 'guiGitHistory', 'guiGitCommit',
]);

/** Requests use the selected computer's authenticated chat connection. */
export function createGuiToolsClient(request: <T>(body: object) => Promise<T>) {
  return {
    status: () => request<RemoteCliStatus>({ operation: 'guiCliStatus' }),
    release: () => request<CliRelease>({ operation: 'guiCliRelease' }),
    install: (version: string) => request<RemoteCliStatus>({ operation: 'guiCliInstall', version }),
    reconnect: () => request<void>({ operation: 'guiReconnect' }),
    git: {
      changes: (cwd: string) => request<GitChanges>({ operation: 'guiGitChanges', cwd }),
      diff: (cwd: string, path: string, commit?: string) =>
        request<GitDiff>({ operation: 'guiGitDiff', cwd, path, commit }),
      history: (cwd: string, skip: number) => request<GitHistory>({ operation: 'guiGitHistory', cwd, skip }),
      commit: (input: GitCommitRequest) => request<{ hash: string }>({ ...input, operation: 'guiGitCommit' }),
    },
    terminal: {
      list: (cwd: string) => request<TerminalInfo[]>({ operation: 'guiTerminalList', cwd }),
      open: (cwd: string, size: TerminalSize) =>
        request<TerminalInfo>({ operation: 'guiTerminalOpen', cwd, size }),
      read: (id: string, cursor: number) => request<TerminalRead>({ operation: 'guiTerminalRead', id, cursor }),
      write: (id: string, data: string) => request<void>({ operation: 'guiTerminalWrite', id, data }),
      resize: (id: string, size: TerminalSize) => request<void>({ operation: 'guiTerminalResize', id, size }),
      close: (id: string) => request<void>({ operation: 'guiTerminalClose', id }),
    },
  };
}

export type GuiToolsClient = ReturnType<typeof createGuiToolsClient>;
