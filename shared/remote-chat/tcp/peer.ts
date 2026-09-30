import { x25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { TcpChannel } from './channel';
import { discover } from './binding';
import { TcpCandidates, MAX_TCP_CANDIDATES } from './candidates';
import { validTcpAddress, type TcpAddress, type TcpListener, type TcpNetwork,
  type TcpPeerOptions, type TcpSignal, type TcpSocket } from './types';

const MAX_SOCKETS = 8;
const DISCOVERY_LIFETIME_MS = 15_000;
const DIAL_RETRY_MS = 300;
const MAX_DIAL_ATTEMPTS = 5;

/** TCP simultaneous open complements UDP ICE; NATs are allowed to reject either attempt. */
export class TcpPeer {
  private readonly secret: Uint8Array;
  private readonly publicKey: string;
  private readonly listeners = new Map<boolean, TcpListener>();
  private readonly pending = new Set<TcpSocket>();
  private readonly discovery = new Set<TcpSocket>();
  private readonly channels = new Set<TcpChannel>();
  private readonly addresses = new TcpCandidates();
  private readonly attempts = new Map<string, number>();
  private readonly dialing = new Set<string>();
  private readonly retries = new Set<ReturnType<typeof setTimeout>>();
  private localHosts: string[] = [];
  private remote?: TcpSignal;
  private closed = false;
  private discoveryStopped = false;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(private readonly options: TcpPeerOptions, private readonly network: TcpNetwork) {
    this.secret = options.random(32);
    this.publicKey = bytesToHex(x25519.getPublicKey(this.secret));
    this.timer = setTimeout(() => this.stopDiscovery(), DISCOVERY_LIFETIME_MS);
    this.publish();
    void this.collectLocalAddresses();
    for (const ipv6 of [false, true]) void this.prepare(ipv6).catch(() => {
      options.diagnostic?.('tcp-discovery', { transport: 'tcp', stage: 'failed', ipv6 });
    });
  }

  private async collectLocalAddresses() {
    try { this.localHosts = await this.network.localAddresses?.() ?? []; }
    catch { this.options.diagnostic?.('tcp-discovery', { transport: 'tcp', stage: 'failed' }); }
    if (this.closed || this.discoveryStopped) return;
    for (const [ipv6, listener] of this.listeners) this.publishLocal(ipv6, listener.port);
  }

  private publishLocal(ipv6: boolean, port: number) {
    this.localHosts.filter(host => host.includes(':') === ipv6).forEach(host => this.addresses.add({ host, port }, 'local'));
    this.publish();
  }

  private async prepare(ipv6: boolean) {
    const listener = await this.network.listen(ipv6, socket => this.acceptSocket(socket));
    if (this.closed || this.discoveryStopped) { listener.close(); return; }
    this.listeners.set(ipv6, listener);
    this.publishLocal(ipv6, listener.port);
    this.dial();
    const servers = this.options.config.servers.filter(server => server.host.includes(':') ? ipv6
      : !/^\d+(\.\d+){3}$/.test(server.host) || !ipv6).slice(0, 2);
    await Promise.allSettled(servers.map(async server => {
      const socket = await this.network.connect({ ...server, localPort: listener.port, ipv6 });
      if (this.closed || this.discoveryStopped) { socket.close(); return; }
      this.discovery.add(socket);
      this.addresses.add({ host: socket.localAddress, port: listener.port }, 'local');
      this.publish();
      const mapped = await discover(socket, this.options.random);
      if (this.closed || this.discoveryStopped) return;
      this.addresses.add(mapped, 'mapped');
      this.options.diagnostic?.('tcp-discovery', { transport: 'tcp', stage: 'ready', ipv6 });
      this.publish();
      this.dial();
    }).map(operation => operation.catch(() => {
      this.options.diagnostic?.('tcp-discovery', { transport: 'tcp', stage: 'failed', ipv6 });
    })));
    this.dial();
  }

  private publish() {
    if (!this.closed) this.options.signal({ kind: 'tcp', publicKey: this.publicKey, addresses: this.addresses.values() });
  }

  accept(signal: TcpSignal) {
    if (this.closed) return;
    if (!/^[a-f0-9]{64}$/.test(signal.publicKey) || !Array.isArray(signal.addresses)
      || signal.addresses.length > MAX_TCP_CANDIDATES || !signal.addresses.every(validTcpAddress)
      || (this.remote && this.remote.publicKey !== signal.publicKey)) throw new Error('Invalid TCP candidates');
    this.remote = signal;
    for (const socket of this.pending) {
      this.pending.delete(socket);
      this.attach(socket);
    }
    this.dial();
  }

  private dial() {
    if (!this.remote || this.closed || this.discoveryStopped) return;
    for (const address of this.remote.addresses) {
      const ipv6 = address.host.includes(':'), listener = this.listeners.get(ipv6);
      const id = `${address.host}:${address.port}`;
      if (!listener || this.dialing.has(id) || (this.attempts.get(id) ?? 0) >= MAX_DIAL_ATTEMPTS) continue;
      this.dialAddress({ ...address, ipv6, localPort: listener.port }, id);
    }
  }

  private dialAddress(address: TcpAddress & { ipv6: boolean; localPort: number }, id: string) {
    const attempt = (this.attempts.get(id) ?? 0) + 1;
    this.attempts.set(id, attempt);
    this.dialing.add(id);
    this.options.diagnostic?.('tcp-dial', { transport: 'tcp', stage: 'starting', ipv6: address.ipv6, attempt });
    void this.network.connect(address).then(socket => {
      if (this.closed || this.discoveryStopped) { socket.close(); return; }
      // A connected socket can still fail authentication. Keep one attempt active until it closes.
      socket.onClose(() => this.retry(id, attempt, address.ipv6));
      this.acceptSocket(socket);
    }).catch(() => this.retry(id, attempt, address.ipv6));
  }

  private retry(id: string, attempt: number, ipv6: boolean) {
    if (!this.dialing.delete(id) || this.closed || this.discoveryStopped) return;
    this.options.diagnostic?.('tcp-dial', { transport: 'tcp', stage: 'failed', ipv6, attempt });
    if (attempt >= MAX_DIAL_ATTEMPTS) return;
    const timer = setTimeout(() => { this.retries.delete(timer); this.dial(); }, DIAL_RETRY_MS * attempt);
    this.retries.add(timer);
  }

  private acceptSocket(socket: TcpSocket) {
    if (this.closed || this.discoveryStopped || this.pending.size + this.channels.size >= MAX_SOCKETS) {
      socket.close(); return;
    }
    if (this.remote) this.attach(socket);
    else {
      this.pending.add(socket);
      socket.onClose(() => this.pending.delete(socket));
    }
  }

  private attach(socket: TcpSocket) {
    if (!this.remote || this.closed) { socket.close(); return; }
    try {
      const key = x25519.getSharedSecret(this.secret, hexToBytes(this.remote.publicKey));
      const channel = new TcpChannel({ ...this.options, socket, key });
      this.channels.add(channel);
      channel.onClose(() => this.channels.delete(channel));
      this.options.channel(channel);
    } catch { socket.close(); }
  }

  private stopDiscovery() {
    this.discoveryStopped = true;
    this.retries.forEach(timer => clearTimeout(timer));
    this.retries.clear();
    this.discovery.forEach(socket => socket.close());
    this.discovery.clear();
    this.pending.forEach(socket => socket.close());
    this.pending.clear();
    this.listeners.forEach(listener => listener.close());
    this.listeners.clear();
    if (!this.closed) this.options.exhausted?.();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.stopDiscovery();
    this.channels.forEach(channel => channel.close());
    this.channels.clear();
    this.network.close();
    this.secret.fill(0);
  }
}
