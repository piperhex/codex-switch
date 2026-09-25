export interface TerminalSize { cols: number; rows: number }
export interface TerminalInfo { id: string; cwd: string; shell: string; projectCwd?: string }
export interface TerminalAttachment extends TerminalInfo { detach?: () => void }
export type TerminalEvent = { type: 'output'; data: number[] }
  | { type: 'exit'; code: number | null } | { type: 'error'; message: string }
  | { type: 'connection'; connected: boolean } | { type: 'reset' };
export interface TerminalRead {
  found: boolean;
  events: TerminalEvent[];
  cursor: number;
  truncated: boolean;
}
export interface TerminalApi {
  open: (cwd: string, size: TerminalSize, onEvent: (event: TerminalEvent) => void) => Promise<TerminalAttachment>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, size: TerminalSize) => Promise<void>;
  close: (id: string) => Promise<void>;
  attach?: (info: TerminalInfo, size: TerminalSize, onEvent: (event: TerminalEvent) => void) => Promise<TerminalAttachment>;
  detach?: (id: string) => void;
}
