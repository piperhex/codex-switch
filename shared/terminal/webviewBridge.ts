import { connectTerminal } from './connection';
import type { TerminalApi, TerminalEvent, TerminalInfo, TerminalSize } from './types';

const MAX_BUFFER_BYTES = 512 * 1024;
const MAX_INPUT_CHARACTERS = 32 * 1024;
type Message = ({ type: 'ready' | 'resize' } & TerminalSize) | { type: 'input'; data: string };

export function parseTerminalMessage(raw: string): Message | null {
  if (raw.length > MAX_INPUT_CHARACTERS * 6) return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'input' && typeof value.data === 'string' && value.data.length <= MAX_INPUT_CHARACTERS) {
    return { type: 'input', data: value.data };
  }
  if ((value.type === 'ready' || value.type === 'resize') && Number.isInteger(value.cols)
    && Number.isInteger(value.rows) && Number(value.cols) >= 1 && Number(value.cols) <= 500
    && Number(value.rows) >= 1 && Number(value.rows) <= 500) {
    return { type: value.type, cols: Number(value.cols), rows: Number(value.rows) };
  }
  return null;
}

/** Keep the remote shell and bounded scrollback when Android detaches a hidden modal's WebView. */
export function createTerminalBridge(options: {
  api: TerminalApi; cwd: string; emit: (event: TerminalEvent) => void; status: (message: string) => void;
  session?: TerminalInfo;
}) {
  let connection: ReturnType<typeof connectTerminal> | undefined;
  let attached = false;
  let disposed = false;
  const output: number[][] = [];
  let bytes = 0;
  let exit: TerminalEvent | undefined;
  let connectionStatus: TerminalEvent | undefined;
  const event = (value: TerminalEvent) => {
    if (value.type === 'reset') { output.length = 0; bytes = 0; }
    if (value.type === 'output') {
      output.push(value.data.slice(-MAX_BUFFER_BYTES)); bytes += output.at(-1)!.length;
      while (bytes > MAX_BUFFER_BYTES && output.length > 1) bytes -= output.shift()!.length;
    }
    if (value.type === 'exit') { exit = value; options.status('终端已结束，可以关闭后重新打开。'); }
    if (value.type === 'error') options.status(value.message);
    if (value.type === 'connection') {
      connectionStatus = value;
      options.status(value.connected ? '' : '连接中断，恢复后可继续使用。');
    }
    if (attached) options.emit(value);
  };
  const receive = (raw: string) => {
    const value = parseTerminalMessage(raw);
    if (disposed || !value) return;
    if (value.type === 'ready') {
      attached = true;
      for (const data of output) options.emit({ type: 'output', data });
      if (exit) options.emit(exit);
      if (connectionStatus && !exit) options.emit(connectionStatus);
      if (!connection) connection = connectTerminal({ ...options, size: value,
        onEvent: event, onReady: () => options.status(''), onError: options.status });
      else connection.resize(value);
    } else if (attached && value.type === 'input') connection?.input(value.data);
    else if (attached && value.type === 'resize') connection?.resize(value);
  };
  return { receive, detach: () => { attached = false; },
    dispose: () => { disposed = true; attached = false; connection?.dispose(); output.length = 0; } };
}
