import { CHAT_POLICY_MESSAGE, setChatConnectionMode, setChatPolicy } from '../policy';
import { keyPair } from '../cipher';
import { ChatLink } from '../link';
import { ChatRpc } from '../rpc';
import { browserChatSocket, type ChatSocket } from './socket';
import { hasUpload, uploadProgress, type UploadProgress } from '../uploadProgress';
import { authorizationError, CONNECTION_ERRORS, socketConnectionError } from '../connectionErrors';
import {
  chatSocketUrl, parseMessage, type ConnectionMode, type IceServer, type RpcRequest, type Signal,
} from '../protocol';

export interface ConnectionEvents {
  upload?: (progress: UploadProgress) => void;
  mode: (mode: ConnectionMode) => void;
  ready: () => void;
  event: (event: unknown) => void;
  error: (message: string) => void;
  retryAt?: (timestamp: number | null) => void;
}

interface ConnectionOptions extends ConnectionEvents {
  createSocket?: (url: string) => ChatSocket;
  deviceId: string;
  authorize: () => Promise<{ baseUrl: string; accessToken: string }>;
  randomBytes: (length: number) => Uint8Array;
  createPeer: (options: import('../protocol').PeerOptions) => import('../protocol').Peer;
}

const CONNECTION_TIMEOUT_MS = 30_000;
const SOCKET_CLOSE_GRACE_MS = 250;

export class ChatConnection {
  private socket?: ChatSocket;
  private link?: ChatLink;
  private rpc?: ChatRpc;
  private timer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private socketErrorTimer?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private generation = 0;
  private active = false;
  private resume?: { sessionId: string; resumeToken: string };
  private sessionReady = false;
  private socketAuthenticated = false;
  private leaseTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: ConnectionOptions) {}

  start() {
    if (this.active) return;
    this.active = true;
    setChatConnectionMode('connecting');
    void this.connect();
  }

  private async connect() {
    this.options.retryAt?.(null);
    const generation = ++this.generation;
    this.socketAuthenticated = false;
    if (!this.link) this.options.mode('connecting');
    this.connectTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.fail(CONNECTION_ERRORS.timeout, true);
    }, CONNECTION_TIMEOUT_MS);
    try {
      const session = await this.options.authorize();
      if (!this.active || generation !== this.generation) return;
      const keys = keyPair(this.options.randomBytes);
      const url = chatSocketUrl(session.baseUrl);
      const socket = (this.options.createSocket ?? browserChatSocket)(url);
      this.socket = socket;
      this.bindSocket({ socket, keys, generation, accessToken: session.accessToken });
    } catch (error) {
      if (generation !== this.generation) return;
      const status = (error as { status?: number } | null)?.status;
      this.fail(authorizationError(error), status !== 401 && status !== 403);
    }
  }

  private bindSocket({ socket, keys, generation, accessToken }: {
    socket: ChatSocket; keys: ReturnType<typeof keyPair>; generation: number; accessToken: string;
  }) {
    socket.onopen = () => {
      if (generation !== this.generation) { socket.close(); return; }
      socket.send(JSON.stringify({ type: 'authenticate', role: 'mobile',
        accessToken, deviceId: this.options.deviceId, publicKey: keys.publicKey,
        transportVersion: 2, resume: this.resume }));
    };
    socket.onmessage = ({ data }: { data: unknown }) => {
      if (generation !== this.generation || typeof data !== 'string') return;
      void this.receive(data, keys).catch(() => {
        if (generation === this.generation) this.fail(CONNECTION_ERRORS.invalid);
      });
    };
    socket.onclose = (event) => {
      keys.secret.fill(0);
      if (generation === this.generation) {
        this.fail(socketConnectionError(event.code), ![4000, 4001].includes(event.code));
      }
    };
    socket.onerror = () => {
      if (generation !== this.generation || this.socketErrorTimer) return;
      // Give close a chance to report the server's reason; some native sockets never emit it.
      this.socketErrorTimer = setTimeout(() => {
        if (generation === this.generation) this.fail(CONNECTION_ERRORS.network, true);
      }, SOCKET_CLOSE_GRACE_MS);
    };
  }

  private fail(message: string, recover = false) {
    if (recover && this.link?.resumable && this.resume) {
      this.link.setRelayAvailable(false);
      this.retrySocket();
      return;
    }
    this.options.error(message);
    this.disconnected();
  }

  private retrySocket() {
    this.generation += 1;
    clearTimeout(this.connectTimer);
    clearTimeout(this.socketErrorTimer);
    this.socketErrorTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.schedule();
  }

  private lease(expiresAt: unknown) {
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) throw new Error('Invalid lease');
    clearTimeout(this.leaseTimer);
    this.leaseTimer = setTimeout(() => this.fail(CONNECTION_ERRORS.expired), Math.max(0, expiresAt - Date.now()));
  }

  private async receive(data: string, keys: ReturnType<typeof keyPair>) {
    const message = parseMessage(data);
    if (message.type === CHAT_POLICY_MESSAGE) { setChatPolicy(message.policy); return; }
    if (message.type === 'paired' && typeof message.sessionId === 'string') {
      this.socketAuthenticated = true;
      if (message.transportVersion === 2 && typeof message.resumeToken === 'string') {
        this.resume = { sessionId: message.sessionId, resumeToken: message.resumeToken };
        this.lease(message.expiresAt);
      }
      this.paired({ id: message.sessionId, iceServers: message.iceServers as IceServer[], keys,
        transportVersion: Number(message.transportVersion) });
      return;
    }
    if (this.resume && message.sessionId !== this.resume.sessionId) return;
    if (message.type === 'resumed' && this.resume) {
      this.socketAuthenticated = true;
      this.lease(message.expiresAt);
      clearTimeout(this.connectTimer);
      this.attempt = 0;
      this.link?.setRelayAvailable(true);
      return;
    }
    if (message.type === 'peer-offline') this.link?.setRelayAvailable(false);
    if (message.type === 'signal') await this.link?.acceptSignal(message.payload as Signal);
    if (message.type === 'relay-ready') this.link?.enableRelay();
    if (message.type === 'relay' && typeof message.payload === 'string') this.link?.receive(message.payload);
    if (message.type === 'peer-close') this.fail(CONNECTION_ERRORS.interrupted);
  }

  private paired(input: {
    id: string; iceServers: IceServer[]; keys: ReturnType<typeof keyPair>; transportVersion: number;
  }) {
    if (this.link) throw new Error('Already paired');
    this.rpc = new ChatRpc({ prefix: input.keys.publicKey.slice(0, 24),
      send: (message, progress) => this.link!.send(message, progress), event: this.options.event });
    this.link = new ChatLink({
      sessionId: input.id, desktop: false, secret: input.keys.secret, iceServers: input.iceServers,
      transportVersion: input.transportVersion, reconnectRelay: () => this.fail(CONNECTION_ERRORS.network, true),
      createPeer: this.options.createPeer,
      signal: (frame) => {
        if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Disconnected');
        this.socket.send(JSON.stringify(frame));
      },
      relayBuffered: () => this.socket?.bufferedAmount ?? 0,
      message: (message) => this.rpc?.receive(message), error: this.options.error,
      mode: (mode) => {
        if (!this.active) return;
        setChatConnectionMode(mode);
        this.options.mode(mode);
        if (mode === 'offline') { if (this.link) this.disconnected(); return; }
        if (mode !== 'direct' && mode !== 'relay') return;
        if (this.socketAuthenticated) {
          clearTimeout(this.connectTimer);
          this.attempt = 0;
        }
        if (input.transportVersion !== 2) this.rpc?.retry();
        if (input.transportVersion !== 2 || !this.sessionReady) this.options.ready();
        this.sessionReady = true;
      },
    });
    void this.link.offer();
  }

  request<T>(method: RpcRequest['method'], body?: unknown): Promise<T> {
    if (!this.rpc) return Promise.reject(new Error('请先连接电脑。'));
    let lastPercent = -1;
    return this.rpc.request<T>(method, body, method === 'request' && hasUpload(body) ? (fraction) => {
      const progress = uploadProgress(fraction);
      if (progress.percent === lastPercent) return;
      lastPercent = progress.percent;
      this.options.upload?.(progress);
    } : undefined);
  }

  private disconnected() {
    this.generation += 1;
    clearTimeout(this.timer);
    clearTimeout(this.connectTimer);
    clearTimeout(this.socketErrorTimer);
    this.socketErrorTimer = undefined;
    const socket = this.socket;
    if (this.resume && socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: 'peer-close', sessionId: this.resume.sessionId })); }
      catch { /* Logout still clears local keys and timers when the coordinator cannot be reached. */ }
    }
    this.socket = undefined;
    socket?.close();
    clearTimeout(this.leaseTimer);
    this.resume = undefined;
    this.sessionReady = false;
    const link = this.link;
    this.link = undefined;
    link?.close();
    this.rpc?.close();
    this.rpc = undefined;
    this.options.mode('offline');
    setChatConnectionMode('offline');
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.options.retryAt?.(null);
    if (!this.active) return;
    const delay = Math.min(30_000, 1500 * 2 ** Math.min(this.attempt++, 5));
    this.options.retryAt?.(Date.now() + delay);
    this.timer = setTimeout(() => { void this.connect(); }, delay);
  }

  stop() {
    this.active = false;
    this.disconnected();
  }
}
