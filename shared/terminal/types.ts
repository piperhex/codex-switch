export interface TerminalSize { cols: number; rows: number }
export interface TerminalInfo { id: string; cwd: string; shell: string }
export type TerminalEvent = { type: 'output'; data: number[] }
  | { type: 'exit'; code: number | null } | { type: 'error'; message: string };
export interface TerminalApi {
  open: (cwd: string, size: TerminalSize, onEvent: (event: TerminalEvent) => void) => Promise<TerminalInfo>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, size: TerminalSize) => Promise<void>;
  close: (id: string) => Promise<void>;
}
