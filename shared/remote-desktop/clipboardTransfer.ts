import { CLIPBOARD_CHUNK_BYTES, MAX_CLIPBOARD_WIRE_BYTES, decodeClipboardBytes, encodeClipboardBytes,
  validateClipboardContent, type ClipboardContent, type ClipboardMessage, type ClipboardProgress,
  type ClipboardReply, type ClipboardRequest } from './clipboard';

const REQUEST_TIMEOUT = 15_000;
type Result = NonNullable<ClipboardReply['result']>;

/** One bounded transfer per viewer. Chunks share the ordered control channel with keyboard releases. */
export class DesktopClipboard {
  private nextId = 0;
  private busy = false;
  private stopped = false;
  private pending = new Map<number, { resolve: (value: Result) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly send: (message: ClipboardMessage) => boolean) {}

  receive(message: ClipboardReply) {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.requestId);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result ?? {});
  }
  private request(transferId: string, request: ClipboardRequest): Promise<Result> {
    if (this.stopped) return Promise.reject(new Error('桌面连接已结束，请重新连接。'));
    const requestId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId); reject(new Error('剪贴板传输超时，请重试。'));
      }, REQUEST_TIMEOUT);
      this.pending.set(requestId, { resolve, reject, timer });
      if (!this.send({ kind: 'clipboard', requestId, transferId, request })) {
        clearTimeout(timer); this.pending.delete(requestId); reject(new Error('请等待桌面连接后重试。'));
      }
    });
  }
  private async transfer<T>(run: (id: string) => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('剪贴板正在传输，请稍候。');
    this.busy = true;
    const id = `clipboard-${Date.now()}-${++this.nextId}`;
    try { return await run(id); }
    finally {
      // Cleanup is best effort; the host also discards abandoned transfers after its lease expires.
      await this.request(id, { action: 'clear' }).catch(() => undefined);
      this.busy = false;
    }
  }
  read(shortcut?: 'copy' | 'cut', progress?: ClipboardProgress) {
    return this.transfer(async id => {
      const { length } = await this.request(id, { action: 'read', shortcut });
      if (!Number.isInteger(length) || !length || length > MAX_CLIPBOARD_WIRE_BYTES) {
        throw new Error('剪贴板内容过大，请分批复制。');
      }
      const bytes = new Uint8Array(length);
      for (let offset = 0; offset < length;) {
        const { data } = await this.request(id, { action: 'chunk', offset });
        const chunk = decodeClipboardBytes(data ?? '');
        if (!chunk.length || chunk.length > CLIPBOARD_CHUNK_BYTES || offset + chunk.length > length) {
          throw new Error('剪贴板内容无效，请重新复制。');
        }
        bytes.set(chunk, offset); offset += chunk.length; progress?.(offset, length);
      }
      return validateClipboardContent(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    });
  }
  write(content: ClipboardContent, paste = true, progress?: ClipboardProgress) {
    return this.transfer(async id => {
      const bytes = new TextEncoder().encode(JSON.stringify(content));
      if (bytes.length > MAX_CLIPBOARD_WIRE_BYTES) throw new Error('剪贴板内容过大，请分批复制。');
      await this.request(id, { action: 'begin', length: bytes.length });
      for (let offset = 0; offset < bytes.length; offset += CLIPBOARD_CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + CLIPBOARD_CHUNK_BYTES);
        await this.request(id, { action: 'append', offset, data: encodeClipboardBytes(chunk) });
        progress?.(offset + chunk.length, bytes.length);
      }
      await this.request(id, { action: 'commit', paste });
    });
  }
  stop() {
    this.stopped = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer); pending.reject(new Error('桌面连接已结束，请重新连接。'));
    }
    this.pending.clear();
  }
}
