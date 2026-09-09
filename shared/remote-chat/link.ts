import { SessionCipher } from './cipher';
import { Assembler, chunks } from './framing';
import {
  DIRECT_TIMEOUT_MS, MAX_BUFFER_BYTES, type Channel, type ConnectionMode, type IceServer,
  type Peer, type PeerFactory, type RpcMessage, type Signal,
} from './protocol';

interface LinkOptions {
  sessionId: string;
  desktop: boolean;
  secret: Uint8Array;
  publicKey?: string;
  iceServers: IceServer[];
  createPeer: PeerFactory;
  signal: (message: object) => void;
  relayBuffered: () => number;
  message: (message: RpcMessage) => void;
  mode: (mode: ConnectionMode) => void;
  error: (message: string) => void;
}

/** One logical encrypted connection across ICE direct transport and the admin fallback relay. */
export class ChatLink {
  private peer?: Peer;
  private channel?: Channel;
  private cipher?: SessionCipher;
  private readonly assembler = new Assembler();
  private mode: ConnectionMode = 'connecting';
  private relay = false;
  private closed = false;
  private serial = 0;
  private queued = 0;
  private outgoing: Promise<void> = Promise.resolve();
  private readonly startedAt = Date.now();
  private readonly fallbackTimer: ReturnType<typeof setTimeout>;

  constructor(private readonly options: LinkOptions) {
    if (options.publicKey) this.setKey(options.publicKey);
    this.fallbackTimer = setTimeout(() => this.fallback(), DIRECT_TIMEOUT_MS + 150);
    try {
      this.peer = options.createPeer({
        iceServers: options.iceServers,
        signal: (payload) => this.signal({ type: 'signal', payload }),
        channel: (channel) => this.attach(channel),
        disconnected: () => this.fallback(),
      });
    } catch { /* Platforms without ICE support still attempt the timed fallback path. */ }
  }

  async offer() {
    try { await this.peer?.offer(); } catch { this.fallback(); }
  }

  private signal(message: object) {
    if (!this.closed) this.options.signal({ ...message, sessionId: this.options.sessionId });
  }

  private setKey(publicKey: string) {
    if (this.cipher) throw new Error('Session key cannot change');
    this.cipher = new SessionCipher({ ...this.options, publicKey });
    this.ready();
  }

  async acceptSignal(signal: Signal) {
    if (this.closed) return;
    if (signal.kind === 'key') { this.setKey(signal.key); return; }
    try { await this.peer?.accept(signal); } catch { this.fallback(); }
  }

  private attach(channel: Channel) {
    if (this.closed || this.channel) { channel.close(); return; }
    this.channel = channel;
    channel.onOpen(() => this.ready());
    channel.onClose(() => this.fallback());
    channel.onMessage((payload) => this.receive(payload));
    this.ready();
  }

  private ready() {
    if (this.closed || !this.cipher) return;
    if (this.relay) this.changeMode('relay');
    else if (this.channel?.readyState === 'open') {
      clearTimeout(this.fallbackTimer);
      this.changeMode('direct');
    }
  }

  private changeMode(mode: ConnectionMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.options.mode(mode);
  }

  fallback() {
    if (this.closed || this.relay) return;
    if (this.mode === 'direct') {
      this.changeMode('connecting');
      this.signal({ type: 'relay-request', reason: 'disconnected' });
    } else if (Date.now() - this.startedAt >= DIRECT_TIMEOUT_MS && this.channel?.readyState !== 'open') {
      // Early ICE failures keep the initial timer so both endpoints give direct discovery its full budget.
      this.signal({ type: 'relay-request', reason: 'timeout' });
    }
  }

  enableRelay() {
    if (this.closed) return;
    this.relay = true;
    clearTimeout(this.fallbackTimer);
    this.peer?.close();
    this.peer = undefined;
    this.ready();
  }

  receive(payload: string) {
    if (this.closed || !this.cipher) return;
    try {
      const text = this.cipher.decrypt(payload);
      if (text === null) return;
      const message = this.assembler.accept(text);
      if (message) this.options.message(message);
    } catch {
      this.options.error('连接校验失败，请重新连接电脑。');
      this.close();
    }
  }

  send(message: RpcMessage): Promise<void> {
    if (this.closed || this.queued >= 512) return Promise.reject(new Error('连接繁忙，请重新连接。'));
    this.queued += 1;
    const id = String(++this.serial);
    const result = this.outgoing.then(async () => {
      for (const part of chunks(message, id)) {
        await this.waitForCapacity();
        if (!this.cipher) throw new Error('正在连接电脑。');
        const payload = this.cipher.encrypt(part);
        if (this.relay) this.signal({ type: 'relay', payload });
        else this.channel!.send(payload);
        // Pace large histories and image payloads; do not monopolize the UI or the gateway.
        await new Promise<void>((resolve) => setTimeout(resolve, 8));
      }
    }).finally(() => { this.queued -= 1; });
    this.outgoing = result.catch(() => undefined);
    return result;
  }

  private async waitForCapacity() {
    const started = Date.now();
    while (!this.closed) {
      const ready = this.mode === 'relay' || (this.mode === 'direct' && this.channel?.readyState === 'open');
      const buffered = this.relay ? this.options.relayBuffered() : (this.channel?.bufferedAmount ?? 0);
      if (ready && buffered < MAX_BUFFER_BYTES) return;
      if (Date.now() - started > 15_000) throw new Error('连接暂时中断，请重新连接。');
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('电脑已断开连接。');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.fallbackTimer);
    this.peer?.close();
    this.channel?.close();
    this.cipher?.destroy();
    this.assembler.clear();
    this.changeMode('offline');
  }
}
