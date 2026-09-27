import type { Peer, PeerFactory, PeerOptions, Signal } from './protocol';
import { MultipathChannel } from './multipathChannel';
import { TcpPeer } from './tcp/peer';
import type { TcpNetwork } from './tcp/types';

/** Enabled only when the coordinator confirms support on both endpoints; old peers retain plain RTC. */
export class MultipathPeer implements Peer {
  private readonly rtc?: Peer;
  private readonly channel: MultipathChannel;
  private readonly tcp?: TcpPeer;

  constructor(options: PeerOptions, dependencies: {
    rtc: PeerFactory; network: TcpNetwork; random: (length: number) => Uint8Array;
  }) {
    if (!options.tcp || !options.sessionId) throw new Error('Missing direct path configuration');
    this.channel = new MultipathChannel(options);
    options.channel(this.channel);
    try {
      this.rtc = dependencies.rtc({ ...options, channel: channel => this.channel.add(channel, 0),
        stateChanged: () => undefined, disconnected: () => undefined });
    } catch { /* TCP may still connect when native WebRTC initialization fails. */ }
    try {
      this.tcp = new TcpPeer({ config: options.tcp, sessionId: options.sessionId, desktop: Boolean(options.desktop),
        random: dependencies.random, signal: options.signal, channel: channel => this.channel.add(channel, 1) },
      dependencies.network);
    } catch { dependencies.network.close(); }
    if (!this.rtc && !this.tcp) { this.channel.close(); throw new Error('Direct paths unavailable'); }
  }

  async offer() {
    try { await this.rtc?.offer(); } catch { /* Aggregate health decides when to retry both paths. */ }
  }
  async accept(signal: Exclude<Signal, { kind: 'key' }>) {
    try {
      if (signal.kind === 'tcp') this.tcp?.accept(signal);
      else await this.rtc?.accept(signal);
    } catch { /* One failed negotiation must not destroy a healthy alternative path. */ }
  }
  close() { this.channel.close(); this.rtc?.close(); this.tcp?.close(); }
}
