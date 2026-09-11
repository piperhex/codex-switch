import { terminalApi, type TerminalEvent, type TerminalInfo, type TerminalSize } from "./api";

const MAX_PENDING_INPUT = 256 * 1024;
const INPUT_CHUNK_CHARACTERS = 4096;

interface ConnectionOptions {
  cwd: string;
  size: TerminalSize;
  onEvent: (event: TerminalEvent) => void;
  onReady: (info: TerminalInfo) => void;
  onError: (message: string) => void;
}

/** Serial input and coalesced resizing keep slow shells from accumulating IPC calls. */
export function connectTerminal(options: ConnectionOptions) {
  let id: string | undefined;
  let disposed = false;
  let exited = false;
  let writing = false;
  let resizing = false;
  let pending = "";
  let size: TerminalSize | undefined;
  const report = (message: string) => { if (!disposed) options.onError(message); };
  const opening = terminalApi.open(options.cwd, options.size, (event) => {
    if (disposed) return;
    if (event.type === "exit") { exited = true; pending = ""; }
    options.onEvent(event);
  }).then(async (info) => {
    id = info.id;
    if (disposed) { await terminalApi.close(id); return; }
    if (!exited) options.onReady(info);
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
        await terminalApi.write(id, chunk);
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
        await terminalApi.resize(id, next);
      }
    } catch { report("终端尺寸未能调整，请关闭此终端后重试。"); }
    finally { resizing = false; }
  }
  return {
    input(data: string) {
      if (disposed || exited) return;
      if (pending.length + data.length > MAX_PENDING_INPUT) { report("输入内容较多，请分几次粘贴。"); return; }
      pending += data; void flushInput();
    },
    resize(next: TerminalSize) { size = next; void flushSize(); },
    dispose() {
      disposed = true; pending = "";
      // A tab can close before its shell finishes starting; opening performs the late cleanup.
      if (id) void terminalApi.close(id).catch(() => console.error("Terminal cleanup failed"));
      else void opening;
    },
  };
}
