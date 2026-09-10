import { guiApi } from '../pages/codexGui/api';
import type { ApprovalReply, Request } from '../pages/codexGui/types';
import { object, type RpcRequest, type RpcResponse } from '../../../../shared/remote-chat/protocol';
import { chunks } from '../../../../shared/remote-chat/framing';
import { guiComposer } from '../pages/codexGui/composerBridge';

const OPERATIONS = new Set([
  'models', 'list', 'read', 'start', 'resume', 'send', 'steer', 'interrupt', 'rename', 'archive', 'unarchive',
  'compact', 'imagePreview', 'goalGet', 'goalSet', 'goalClear',
]);
const CACHE_TTL_MS = 5 * 60_000;
interface Cached { fingerprint: string; result: Promise<RpcResponse>; expires: number; completed: boolean }

function operationError(error: unknown) {
  // Tauri rejects with the safe string produced by the Rust command boundary.
  if (typeof error === 'string' && error.trim()) return error;
  return error instanceof Error ? error.message : '电脑暂时无法处理请求，请稍后重试。';
}

function response(request: RpcRequest, data: unknown): RpcResponse {
  const result: RpcResponse = { kind: 'response', id: request.id, data };
  // Fail just this request if an image/history exceeds the transport limit, preserving the connection.
  chunks(result, request.id).next();
  return result;
}

export class ChatOperations {
  private readonly cache = new Map<string, Cached>();

  execute(request: RpcRequest): Promise<RpcResponse> {
    if (typeof request.id !== 'string' || request.id.length > 160) return Promise.reject(new Error('Invalid request'));
    const fingerprint = JSON.stringify([request.method, request.body]);
    const cached = this.cache.get(request.id);
    if (cached) {
      if (cached.fingerprint !== fingerprint) return Promise.reject(new Error('Request id reused'));
      return cached.result;
    }
    this.prune();
    if (this.cache.size >= 512) return Promise.reject(new Error('请求较多，请稍后重试。'));
    const result = this.run(request).then((data) => response(request, data))
      .catch((error: unknown): RpcResponse => ({ kind: 'response', id: request.id, error: operationError(error) }));
    const entry: Cached = { fingerprint, result, expires: Date.now() + CACHE_TTL_MS, completed: false };
    this.cache.set(request.id, entry);
    void result.then(() => { entry.completed = true; });
    return result;
  }

  private async run(request: RpcRequest): Promise<unknown> {
    if (request.method === 'connect') return guiApi.connect({ reuseExisting: true });
    const body = object(request.body);
    if (request.method === 'request' && body.operation === 'composerSet') return guiComposer.update(body.settings);
    if (request.method === 'request' && body.operation === 'models') {
      const composer = await guiComposer.read();
      return { data: composer.models, nextCursor: null, composer };
    }
    if (request.method === 'respond') {
      if (typeof body.id !== 'string' && typeof body.id !== 'number') throw new Error('审批请求已失效，请刷新对话。');
      return guiApi.respond(body as ApprovalReply);
    }
    if (request.method !== 'request' || !OPERATIONS.has(String(body.operation))) {
      throw new Error('当前手机端暂不支持此操作。');
    }
    // The existing typed Rust boundary validates directories, thread ids, inputs and approval replies.
    return guiApi.request(body as unknown as Request);
  }

  private prune() {
    for (const [id, entry] of this.cache) if (entry.completed && entry.expires <= Date.now()) this.cache.delete(id);
  }
}
