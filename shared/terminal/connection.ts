import type { TerminalApi, TerminalEvent, TerminalInfo, TerminalSize } from "./types";

const MAX_PENDING_INPUT = 256 * 1024;
const INPUT_CHUNK_CHARACTERS = 4096;

export interface ConnectionOptions {
  api: TerminalApi;
  cwd: string;
  session?: TerminalInfo;
  size: TerminalSize;
  onEvent: (event: TerminalEvent) => void;
  onReady: (info: TerminalInfo) => void;
  onError: (message: string) => void;
}

/** Serial input and coalesced resizing keep slow shells from accumulating IPC calls. */
export function connectTerminal(options: ConnectionOptions) {
  const api = options.api;
  let id: string | undefined;
  let disposed = false;
  let exited = false;
  let connected = true;
  let detach: (() => void) | undefined;
  let writing = false;
  let resizing = false;
  let pending = "";
  let size: TerminalSize | undefined;
  const report = (message: string) => { if (!disposed) options.onError(message); };
  const receive = (event: TerminalEvent) => {
    if (disposed) return;
    if (event.type === "exit") { exited = true; pending = ""; }
    if (event.type === 'connection') { connected = event.connected; if (!connected) pending = ''; }
    options.onEvent(event);
  };
  const initialSize = { cols: options.size.cols, rows: options.size.rows };
  const opening = (options.session && api.attach
    ? api.attach(options.session, initialSize, receive) : api.open(options.cwd, initialSize, receive)).then(async (info) => {
    id = info.id;
    detach = info.detach;
    if (disposed) { if (detach) detach(); else await api.close(id); return; }
    if (!exited && connected) options.onReady(info);
    void flushInput(); void flushSize();
  }).catch(() => report("终端未能启动，请关闭此标签页后重试。"));

  async function flushInput() {
    if (!id || disposed || exited || writing) return;
    writing = true;
    try {
      while (pending && !disposed && !exited) {
        // Array.from avoids splitting a Unicode surrogate pair between writes.
        const chunk = Array.from(pending).slice(0, INPUT_CHUNK_CHARACTERS).join("");
        pending = pending.slice(chunk.length);
        await api.write(id, chunk);
      }
    } catch { pending = ""; report("输入未能发送，请关闭此终端后重试。"); }
    finally { writing = false; }
  }
  async function flushSize() {
    if (!id || disposed || exited || resizing) return;
    resizing = true;
    try {
      while (size && !disposed && !exited) {
        const next = size; size = undefined;
        await api.resize(id, next);
      }
    } catch { report("终端尺寸未能调整，请关闭此终端后重试。"); }
    finally { resizing = false; }
  }
  return {
    input(data: string) {
      if (disposed || exited || !connected) return;
      if (pending.length + data.length > MAX_PENDING_INPUT) { report("输入内容较多，请分几次粘贴。"); return; }
      pending += data; void flushInput();
    },
    resize(next: TerminalSize) { size = { cols: next.cols, rows: next.rows }; void flushSize(); },
    dispose() {
      disposed = true; pending = "";
      // A tab can close before its shell finishes starting; opening performs the late cleanup.
      if (detach) detach();
      else if (id) void api.close(id).catch(() => console.error("Terminal cleanup failed"));
      else void opening;
    },
  };
}
