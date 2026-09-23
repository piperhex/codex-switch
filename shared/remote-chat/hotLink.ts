import { SessionCipher } from './cipher';
import { deliveryFrame } from './delivery';
import { LinkDelivery } from './linkDelivery';
import type { TransferProgress } from './uploadProgress';
import { HotPeer } from './hotPeer';
import { DirectPackets, directPackets } from './directPackets';
import { connectionDiagnostic } from './diagnostics';
import { getChatPolicy } from './policy';
import type { LinkOptions } from './linkOptions';
import { MAX_BUFFER_BYTES, type Channel, type ConnectionMode, type RpcMessage, type Signal } from './protocol';

type Path = 'direct' | 'relay';
const TICK_MS = 250;
const PROBE_MS = 1000;
const DIRECT_TIMEOUT_SECONDS = 3;
const MILLISECONDS_PER_SECOND = 1000;
const MAX_PENDING_PROBES = 128;
const DIRECT_STABLE_MS = 3000;
const OUTAGE_TIMEOUT_MS = 60_000;

/** Both paths stay open. Authenticated acknowledgements cover every fragment, including events. */
export class HotLink {
  private readonly diagnostic;
  private readonly peer: HotPeer;
  private readonly delivery: LinkDelivery;
  private readonly timer: ReturnType<typeof setInterval>;
  private cipher?: SessionCipher;
  private channel?: Channel;
  private readonly directPackets = new DirectPackets({
    send: (payload) => {
      if (this.channel?.readyState !== 'open') throw new Error('Direct path unavailable');
      this.channel.send(payload);
    },
    failed: () => this.fallback(),
  });
  private relay = true;
  private quotaBlocked = false;
  private closed = false;
  private mode: ConnectionMode = 'connecting';
  private selected?: Path;
  private directSince = 0;
  private outageSince = Date.now();
  private lastProbe = 0;
  private probeId = 0;
  private relaySince = Date.now();
  private readonly lastPong = { direct: 0, relay: 0 };
  private readonly probes = new Map<number, { path: Path; at: number }>();

  constructor(private readonly options: LinkOptions) {
    this.diagnostic = connectionDiagnostic(options.sessionId, options.desktop);
    this.delivery = new LinkDelivery({
      send: (frame) => this.selected ? this.transmit(this.selected, frame) : false,
      message: options.message, mode: () => this.mode,
    });
    if (options.publicKey) this.setKey(options.publicKey);
    this.peer = new HotPeer({ ...options,
      diagnostic: this.diagnostic,
      signal: (payload) => this.signal({ type: 'signal', payload }),
      channel: (channel) => this.attach(channel), disconnected: () => this.fallback(),
    });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  get resumable() { return !this.closed && Boolean(this.cipher); }
  get connectionMode() { return this.mode; }
  offer() { return this.peer.offer(); }

  private setKey(key: string) {
    if (this.cipher) throw new Error('Session key cannot change');
    this.cipher = new SessionCipher({ ...this.options, publicKey: key });
  }

  async acceptSignal(signal: Signal) {
    if (this.closed) return;
    if (signal.kind === 'key') { this.setKey(signal.key); return; }
    await this.peer.accept(signal);
  }

  private signal(message: object): boolean {
    if (this.closed || !this.relay) return false;
    try { this.options.signal({ ...message, sessionId: this.options.sessionId }); return true; }
    catch { this.setRelayAvailable(false); return false; }
  }

  private attach(channel: Channel) {
    if (this.closed) { channel.close(); return; }
    const previous = this.channel;
    this.directPackets.clear();
    this.channel = channel;
    previous?.close();
    this.lastPong.direct = 0;
    this.directSince = 0;
    channel.onOpen(() => { if (this.channel === channel) this.probe('direct'); });
    channel.onClose(() => { if (this.channel === channel) this.fallback(); });
    channel.onMessage((payload) => { if (this.channel === channel) this.receive(payload, 'direct'); });
    if (channel.readyState === 'open') this.probe('direct');
  }

  private transmit(path: Path, frame: object): boolean {
    if (!this.cipher || this.closed) return false;
    const buffered = path === 'relay' ? this.options.relayBuffered()
      : (this.channel?.bufferedAmount ?? MAX_BUFFER_BYTES) + this.directPackets.bufferedAmount;
    if (buffered === undefined || buffered >= MAX_BUFFER_BYTES) return false;
    if (path === 'direct' && this.channel?.readyState !== 'open') return false;
    if (path === 'relay' && (!this.relay || this.quotaBlocked)) return false;
    const payload = this.cipher.encrypt(JSON.stringify(frame));
    try {
      if (path === 'relay') return this.signal({ type: 'relay', payload });
      this.directPackets.send(payload, 'kind' in frame && frame.kind === 'data');
      return true;
    } catch { this.lastPong[path] = 0; return false; }
  }

  private probe(path: Path) {
    const id = ++this.probeId;
    this.probes.set(id, { path, at: Date.now() });
    // A very large configured timeout must not retain unanswered probes indefinitely.
    if (this.probes.size > MAX_PENDING_PROBES) this.probes.delete(this.probes.keys().next().value!);
    const frame = { kind: 'ping', id, packetBatching: true, parallelResponses: true };
    if (!this.transmit(path, frame)) this.probes.delete(id);
  }

  receive(payload: string, path: Path = 'relay') {
    if (this.closed || !this.cipher) return;
    try {
      const packets = path === 'direct' ? directPackets(payload) : [payload];
      for (const packet of packets) this.receivePacket(packet, path);
    } catch { this.fail('连接校验失败，请重新连接电脑。'); }
  }

  private receivePacket(payload: string, path: Path) {
    if (this.closed || !this.cipher) return;
    const text = this.cipher.decrypt(payload);
    if (text === null) return;
    const frame = deliveryFrame(text);
    if (frame.kind === 'close') { this.close(false); return; }
    if (frame.kind === 'ping') {
      if (!Number.isSafeInteger(frame.id)) throw new Error('Invalid probe');
      if (frame.parallelResponses === true) this.delivery.enableResponses();
      if (path === 'direct' && frame.packetBatching === true) this.directPackets.enable();
      this.transmit(path, { kind: 'pong', id: frame.id, packetBatching: true, parallelResponses: true });
    } else if (frame.kind === 'pong') {
      if (frame.parallelResponses === true) this.delivery.enableResponses();
      if (path === 'direct' && frame.packetBatching === true) this.directPackets.enable();
      this.pong(frame.id, path);
    } else {
      this.delivery.accept(frame, (ack) => { this.transmit(path, ack); }, path);
    }
  }

  private pong(id: unknown, path: Path) {
    const probe = this.probes.get(Number(id));
    if (!probe || probe.path !== path || this.timedOut(path, probe.at)) return;
    this.probes.delete(Number(id));
    if (path === 'direct' && !this.healthy('direct')) this.directSince = Date.now();
    this.lastPong[path] = Date.now();
    this.choose();
  }

  private healthy(path: Path) {
    const open = path === 'relay' ? this.relay && !this.quotaBlocked : this.channel?.readyState === 'open';
    return Boolean(open && this.lastPong[path] && !this.timedOut(path, this.lastPong[path]));
  }

  private timedOut(path: Path, since: number, now = Date.now()) {
    const seconds = path === 'direct' ? DIRECT_TIMEOUT_SECONDS : getChatPolicy().relayHeartbeatTimeoutSeconds;
    return (now - since) / MILLISECONDS_PER_SECOND >= seconds;
  }

  private choose() {
    if (this.closed) return;
    const direct = this.healthy('direct');
    const relay = this.healthy('relay');
    const stable = Date.now() - this.directSince >= DIRECT_STABLE_MS;
    let path: Path | undefined;
    if (direct && (stable || this.selected === 'direct' || !relay)) path = 'direct';
    else if (relay) path = 'relay';
    const changed = path !== this.selected;
    if (changed) this.directPackets.clear();
    this.selected = path;
    if (path) this.outageSince = Date.now();
    const mode = path ?? 'connecting';
    if (mode !== this.mode) {
      this.diagnostic('mode', { mode, directHealthy: direct, relayHealthy: relay });
      this.mode = mode;
      this.options.mode(mode);
    }
    if (changed && path) this.delivery.flush(true);
  }

  private tick() {
    if (this.closed) return;
    try {
      const now = Date.now();
      if (now - this.lastProbe >= PROBE_MS) {
        this.lastProbe = now;
        for (const [id, probe] of this.probes) {
          if (this.timedOut(probe.path, probe.at, now)) this.probes.delete(id);
        }
        this.probe('direct');
        this.probe('relay');
      }
      this.choose();
      this.delivery.flush();
      this.peer.recover(this.healthy('direct'), this.relay);
      // Relay probes traverse the coordinator and the remote UI; brief stalls must not reset that socket.
      const relaySilence = now - Math.max(this.relaySince, this.lastPong.relay);
      if (this.relay && !this.quotaBlocked
        && this.timedOut('relay', Math.max(this.relaySince, this.lastPong.relay), now)) {
        this.diagnostic('relay-timeout', { elapsedMs: relaySilence });
        this.setRelayAvailable(false);
        this.options.reconnectRelay?.();
      }
      if (!this.selected && now - this.outageSince > OUTAGE_TIMEOUT_MS) this.fail('连接已中断，请重新连接电脑。');
    } catch { this.fail('连接暂时中断，请重新连接电脑。'); }
  }

  fallback() { this.lastPong.direct = 0; this.directSince = 0; this.choose(); }
  enableRelay() { this.setRelayAvailable(true); }

  setRelayQuotaBlocked(blocked: boolean) {
    if (this.closed || this.quotaBlocked === blocked) return;
    this.quotaBlocked = blocked;
    this.lastPong.relay = 0;
    this.relaySince = Date.now();
    if (!blocked) this.probe('relay');
    this.choose();
  }

  setRelayAvailable(available: boolean) {
    if (this.closed) return;
    this.relay = available;
    this.lastPong.relay = 0;
    this.relaySince = Date.now();
    if (available) this.probe('relay');
    this.choose();
  }

  send(message: RpcMessage, progress?: TransferProgress): Promise<void> {
    return this.delivery.send(message, progress);
  }

  private fail(message: string) {
    this.diagnostic('link-failed');
    this.options.error(message);
    this.close();
  }

  close(notify = true) {
    if (this.closed) return;
    if (notify) { this.transmit('direct', { kind: 'close' }); this.transmit('relay', { kind: 'close' }); }
    this.closed = true;
    this.directPackets.clear();
    clearInterval(this.timer);
    this.peer.close();
    this.channel?.close();
    this.cipher?.destroy();
    this.delivery.clear();
    this.probes.clear();
    this.options.mode('offline');
  }
}
