import { keyPair } from '../cipher';
import { ChatLink } from '../link';
import { ChatRpc } from '../rpc';
import { authorizationError, CONNECTION_ERRORS, socketConnectionError } from '../connectionErrors';
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

const CONNECTION_TIMEOUT_MS = 30_000;
const SOCKET_CLOSE_GRACE_MS = 250;

export class ChatConnection {
  private socket?: WebSocket;
  private link?: ChatLink;
  private rpc?: ChatRpc;
  private timer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private socketErrorTimer?: ReturnType<typeof setTimeout>;
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
    this.connectTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.fail(CONNECTION_ERRORS.timeout);
    }, CONNECTION_TIMEOUT_MS);
    try {
      const session = await this.options.authorize();
      if (!this.active || generation !== this.generation) return;
      const keys = keyPair(this.options.randomBytes);
      const socket = new WebSocket(chatSocketUrl(session.baseUrl));
      this.socket = socket;
      this.bindSocket({ socket, keys, generation, accessToken: session.accessToken });
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(authorizationError(error));
    }
  }

  private bindSocket({ socket, keys, generation, accessToken }: {
    socket: WebSocket; keys: ReturnType<typeof keyPair>; generation: number; accessToken: string;
  }) {
    socket.onopen = () => {
      if (generation !== this.generation) { socket.close(); return; }
      socket.send(JSON.stringify({ type: 'authenticate', role: 'mobile',
        accessToken, deviceId: this.options.deviceId, publicKey: keys.publicKey }));
    };
    socket.onmessage = ({ data }: { data: unknown }) => {
      if (generation !== this.generation || typeof data !== 'string') return;
      void this.receive(data, keys).catch(() => {
        if (generation === this.generation) this.fail(CONNECTION_ERRORS.invalid);
      });
    };
    socket.onclose = (event) => {
      keys.secret.fill(0);
      if (generation === this.generation) this.fail(socketConnectionError(event.code));
    };
    socket.onerror = () => {
      if (generation !== this.generation || this.socketErrorTimer) return;
      // Give close a chance to report the server's reason; some native sockets never emit it.
      this.socketErrorTimer = setTimeout(() => {
        if (generation === this.generation) this.fail(CONNECTION_ERRORS.network);
      }, SOCKET_CLOSE_GRACE_MS);
    };
  }

  private fail(message: string) {
    this.options.error(message);
    this.disconnected();
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
    if (message.type === 'peer-close') this.fail(CONNECTION_ERRORS.interrupted);
  }

  private paired(input: { id: string; iceServers: IceServer[]; keys: ReturnType<typeof keyPair> }) {
    if (this.link) throw new Error('Already paired');
    const generation = this.generation;
    this.rpc = new ChatRpc({ prefix: input.keys.publicKey.slice(0, 24),
      send: (message) => this.link!.send(message), event: this.options.event });
    this.link = new ChatLink({
      sessionId: input.id, desktop: false, secret: input.keys.secret, iceServers: input.iceServers,
      createPeer: this.options.createPeer,
      signal: (frame) => this.socket?.send(JSON.stringify(frame)),
      relayBuffered: () => this.socket?.bufferedAmount ?? 0,
      message: (message) => this.rpc?.receive(message), error: this.options.error,
      mode: (mode) => {
        if (generation !== this.generation) return;
        this.options.mode(mode);
        if (mode === 'offline') { this.disconnected(); return; }
        if (mode !== 'direct' && mode !== 'relay') return;
        clearTimeout(this.connectTimer);
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
    this.generation += 1;
    clearTimeout(this.timer);
    clearTimeout(this.connectTimer);
    clearTimeout(this.socketErrorTimer);
    this.socketErrorTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
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
    this.disconnected();
  }
}
