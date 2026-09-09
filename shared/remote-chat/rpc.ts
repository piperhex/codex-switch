import { REQUEST_TIMEOUT_MS, type RpcMessage, type RpcRequest } from './protocol';

interface Pending {
  request: RpcRequest;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ChatRpc {
  private sequence = 0;
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly options: {
    send: (message: RpcMessage) => Promise<void>;
    event: (event: unknown) => void;
    prefix: string;
  }) {}

  request<T>(method: RpcRequest['method'], body?: unknown): Promise<T> {
    if (this.pending.size >= 32) return Promise.reject(new Error('请求较多，请稍后重试。'));
    const id = `${this.options.prefix}:${++this.sequence}`;
    const request: RpcRequest = { kind: 'request', id, method, body };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('电脑暂未确认结果，请刷新对话后再试，避免重复发送。'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { request, resolve: (value) => resolve(value as T), reject, timer });
      void this.options.send(request).catch((error: unknown) => this.fail(id, error));
    });
  }

  receive(message: RpcMessage) {
    if (message.kind === 'event') { this.options.event(message.event); return; }
    if (message.kind !== 'response') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.data);
  }

  retry() {
    // Same ids survive a path switch; the PC caches completed and in-flight operations.
    for (const { request } of this.pending.values()) {
      void this.options.send(request).catch((error: unknown) => this.fail(request.id, error));
    }
  }

  private fail(id: string, error: unknown) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error instanceof Error ? error : new Error('连接已中断。'));
  }

  close() {
    for (const id of this.pending.keys()) this.fail(id, new Error('连接已中断，请重新连接电脑。'));
  }
}
