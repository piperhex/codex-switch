import type { Peer, PeerFactory, PeerOptions, Signal } from './protocol';
import { MultipathChannel } from './multipathChannel';
import { TcpPeer } from './tcp/peer';
import type { TcpNetwork } from './tcp/types';

/** Enabled only when the coordinator confirms support on both endpoints; old peers retain plain RTC. */
export class MultipathPeer implements Peer {
  private readonly rtc?: Peer;
  private readonly channel: MultipathChannel;
  private readonly tcp?: TcpPeer;
  private rtcFailed = false;
  private tcpExhausted = false;
  private closed = false;
  private readonly options: PeerOptions;

  constructor(options: PeerOptions, dependencies: {
    rtc: PeerFactory; network: TcpNetwork; random: (length: number) => Uint8Array;
  }) {
    if (!options.tcp || !options.sessionId) throw new Error('Missing direct path configuration');
    this.options = options;
    this.channel = new MultipathChannel({ ...options, stateChanged: state => {
      options.stateChanged?.(state);
      this.reportExhaustion();
    } });
    options.channel(this.channel);
    try {
      this.rtc = dependencies.rtc({ ...options, channel: channel => this.channel.add(channel, 0),
        stateChanged: state => {
          this.rtcFailed = state === 'failed' || state === 'closed';
          options.diagnostic?.('path-state', { transport: 'rtc', state });
          this.reportExhaustion();
        }, disconnected: () => undefined });
    } catch { this.rtcFailed = true; }
    try {
      this.tcp = new TcpPeer({ config: options.tcp, sessionId: options.sessionId, desktop: Boolean(options.desktop),
        random: dependencies.random, signal: options.signal, channel: channel => this.channel.add(channel, 1),
        diagnostic: options.diagnostic, exhausted: () => { this.tcpExhausted = true; this.reportExhaustion(); } },
      dependencies.network);
    } catch { this.tcpExhausted = true; dependencies.network.close(); }
    if (!this.rtc && !this.tcp) { this.channel.close(); throw new Error('Direct paths unavailable'); }
  }

  async offer() {
    try { await this.rtc?.offer(); } catch { this.rtcFailed = true; this.reportExhaustion(); }
  }
  async accept(signal: Exclude<Signal, { kind: 'key' }>) {
    try {
      if (signal.kind === 'tcp') this.tcp?.accept(signal);
      else await this.rtc?.accept(signal);
    } catch {
      if (signal.kind !== 'tcp') { this.rtcFailed = true; this.reportExhaustion(); }
      else this.options.diagnostic?.('candidate-rejected', { transport: 'tcp' });
    }
  }
  private reportExhaustion() {
    if (this.closed || !this.rtcFailed || !this.tcpExhausted || this.channel.readyState === 'open') return;
    this.options.stateChanged?.('failed');
    this.options.disconnected();
  }
  close() { this.closed = true; this.channel.close(); this.rtc?.close(); this.tcp?.close(); }
}
