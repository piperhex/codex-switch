import { keyPair } from '../cipher';
import { ChatLink } from '../link';
import { ChatRpc } from '../rpc';
import {
  chatSocketUrl, parseMessage, type ConnectionMode, type IceServer, type RpcRequest, type Signal,
} from '../protocol';

export interface ConnectionEvents {
  mode: (mode: ConnectionMode) => void;
  ready: () => void;
  event: (event: unknown) => void;
  error: (message: string) => void;
}

interface ConnectionOptions extends ConnectionEvents {
  deviceId: string;
  authorize: () => Promise<{ baseUrl: string; accessToken: string }>;
  randomBytes: (length: number) => Uint8Array;
  createPeer: (options: import('../protocol').PeerOptions) => import('../protocol').Peer;
}

export class ChatConnection {
  private socket?: WebSocket;
  private link?: ChatLink;
  private rpc?: ChatRpc;
  private timer?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private generation = 0;
  private active = false;

  constructor(private readonly options: ConnectionOptions) {}

  start() {
    if (this.active) return;
    this.active = true;
    void this.connect();
  }

  private async connect() {
    const generation = ++this.generation;
    this.options.mode('connecting');
    try {
      const session = await this.options.authorize();
      if (!this.active || generation !== this.generation) return;
      const keys = keyPair(this.options.randomBytes);
      const socket = new WebSocket(chatSocketUrl(session.baseUrl));
      this.socket = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', role: 'mobile',
        accessToken: session.accessToken, deviceId: this.options.deviceId, publicKey: keys.publicKey }));
      socket.onmessage = ({ data }: { data: unknown }) => {
        if (generation !== this.generation || typeof data !== 'string') return;
        void this.receive(data, keys).catch(() => socket.close());
      };
      socket.onclose = (event) => {
        keys.secret.fill(0);
        if (generation !== this.generation) return;
        if (event.code === 4004) this.options.error('电脑上的聊天暂未就绪，请保持 Codex Switch 运行。');
        this.disconnected();
      };
      socket.onerror = () => socket.close();
    } catch {
      if (generation !== this.generation) return;
      this.options.error('暂时无法连接，请检查登录状态和网络。');
      this.disconnected();
    }
  }

  private async receive(data: string, keys: ReturnType<typeof keyPair>) {
    const message = parseMessage(data);
    if (message.type === 'paired' && typeof message.sessionId === 'string') {
      this.paired({ id: message.sessionId, iceServers: message.iceServers as IceServer[], keys });
      return;
    }
    if (message.type === 'signal') await this.link?.acceptSignal(message.payload as Signal);
    if (message.type === 'relay-ready') this.link?.enableRelay();
    if (message.type === 'relay' && typeof message.payload === 'string') this.link?.receive(message.payload);
    if (message.type === 'peer-close') this.socket?.close();
  }

  private paired(input: { id: string; iceServers: IceServer[]; keys: ReturnType<typeof keyPair> }) {
    if (this.link) throw new Error('Already paired');
    this.rpc = new ChatRpc({ prefix: input.keys.publicKey.slice(0, 24),
      send: (message) => this.link!.send(message), event: this.options.event });
    this.link = new ChatLink({
      sessionId: input.id, desktop: false, secret: input.keys.secret, iceServers: input.iceServers,
      createPeer: this.options.createPeer,
      signal: (frame) => this.socket?.send(JSON.stringify(frame)),
      relayBuffered: () => this.socket?.bufferedAmount ?? 0,
      message: (message) => this.rpc?.receive(message), error: this.options.error,
      mode: (mode) => {
        this.options.mode(mode);
        if (mode === 'offline' && this.active) this.socket?.close();
        if (mode !== 'direct' && mode !== 'relay') return;
        this.attempt = 0;
        this.rpc?.retry();
        this.options.ready();
      },
    });
    void this.link.offer();
  }

  request<T>(method: RpcRequest['method'], body?: unknown): Promise<T> {
    if (!this.rpc) return Promise.reject(new Error('请先连接电脑。'));
    return this.rpc.request<T>(method, body);
  }

  private disconnected() {
    this.link?.close();
    this.link = undefined;
    this.rpc?.close();
    this.rpc = undefined;
    this.options.mode('offline');
    if (!this.active) return;
    const delay = Math.min(30_000, 1500 * 2 ** Math.min(this.attempt++, 5));
    this.timer = setTimeout(() => { void this.connect(); }, delay);
  }

  stop() {
    this.active = false;
    this.generation += 1;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = undefined;
    this.disconnected();
  }
}
