import { RemoteDesktopHost } from '../src/remoteDesktop/host';
import { NativeDesktopSession } from '../src/remoteDesktop/nativeSession';
import { object, type RpcRequest, type RpcResponse } from '../../../shared/remote-chat/protocol';
import { DEFAULT_COMPOSER } from '../../../shared/remote-chat/composer';

class ServiceDesktop extends NativeDesktopSession {
  async open() {
    const offer = await super.open(); const policy = offer.permissions;
    return { ...offer, capabilities: { control: policy?.control ?? false, keyboard: policy?.control ?? false,
      clipboard: !!policy && (policy.clipboardRead || policy.clipboardWrite), horizontalScroll: policy?.control ?? false } };
  }
}
const settings = { ...DEFAULT_COMPOSER };
const composer = { settings, models: [], revision: 1 };
export class ServiceOperations {
  readonly desktop = new RemoteDesktopHost((settings, ice, expiresAt, diagnostic) =>
    new ServiceDesktop(settings, ice, expiresAt, diagnostic));
  private readonly requests = new Map<string, { request: string; result: Promise<RpcResponse> }>();
  execute(request: RpcRequest, owner: string): Promise<RpcResponse> {
    if (typeof request.id !== 'string' || request.id.length > 160 || JSON.stringify(request).length > 256 * 1024) {
      return Promise.resolve({ kind: 'response', id: typeof request.id === 'string' ? request.id.slice(0, 160) : '',
        error: '请求过大或内容无效，请重新连接。' });
    }
    const id = JSON.stringify([owner, request.id]);
    const fingerprint = JSON.stringify(request);
    const previous = this.requests.get(id);
    if (previous) {
      if (previous.request !== fingerprint) return Promise.resolve({ kind: 'response', id: request.id, error: '请求无效。' });
      return previous.result;
    }
    const result = this.run(request, owner).then(data => ({ kind: 'response' as const, id: request.id, data }),
      (error: unknown) => ({ kind: 'response' as const, id: request.id,
        error: error instanceof Error ? error.message : '桌面暂时无法访问，请稍后重试。' }));
    if (this.requests.size >= 64) this.requests.delete(this.requests.keys().next().value!);
    this.requests.set(id, { request: fingerprint, result });
    return result;
  }
  private async run(request: RpcRequest, owner: string): Promise<unknown> {
    if (request.method === 'connect') return { protocolVersion: 1, approvals: [], desktopOnly: true };
    const body = object(request.body);
    if (request.method !== 'request') throw new Error('请先登录电脑，再继续聊天。');
    if (body.operation === 'remoteDesktop') return this.desktop.request(body, owner);
    if (body.operation === 'models') return { data: [], nextCursor: null, composer };
    if (body.operation === 'list') return { data: [], nextCursor: null };
    if (body.operation === 'queueRead') return { revision: 0, threads: {} };
    if (body.operation === 'guiAccountsRead') return { accounts: [], providers: [], selection: null };
    throw new Error('请先登录电脑，再继续聊天。');
  }
  release(owner?: string) {
    this.desktop.release(owner);
    for (const key of this.requests.keys()) {
      if (!owner || (JSON.parse(key) as string[])[0] === owner) this.requests.delete(key);
    }
  }
}
