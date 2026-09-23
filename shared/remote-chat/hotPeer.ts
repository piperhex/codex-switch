import type { Channel, IceServer, Peer, PeerConnectionState, PeerFactory, Signal } from './protocol';
import { getChatPolicy, type ChatPolicy } from './policy';
import type { ConnectionDiagnostic } from './diagnostics';

const MILLISECONDS_PER_SECOND = 1000;
export type RecoverySignal = Exclude<Signal, { kind: 'key' }> & { generation?: number };

/** Only the initiating client starts a new ICE generation, avoiding simultaneous offers. */
export class HotPeer {
  private peer?: Peer;
  private generation = 0;
  private lastAttempt = 0;
  private connectionState: PeerConnectionState = 'new';
  private established = false;
  private unhealthySince?: number;
  private closed = false;
  constructor(private readonly options: {
    desktop: boolean; iceServers: IceServer[]; createPeer: PeerFactory;
    signal: (signal: RecoverySignal) => void; channel: (channel: Channel) => void; disconnected: () => void;
    diagnostic?: ConnectionDiagnostic;
  }) { this.create(); }

  private create() {
    const generation = this.generation;
    this.peer?.close();
    this.lastAttempt = Date.now();
    this.connectionState = 'new';
    this.established = false;
    this.unhealthySince = undefined;
    try {
      this.peer = this.options.createPeer({
        iceServers: this.options.iceServers,
        signal: (signal) => {
          if (signal.kind === 'key') return;
          if (this.isCurrent(generation)) this.options.signal({ ...signal, generation });
        },
        channel: (channel) => this.attach(channel, generation),
        stateChanged: (state) => {
          if (!this.isCurrent(generation)) return;
          this.connectionState = state;
          this.options.diagnostic?.('peer-state', { generation, state });
        },
        disconnected: () => {
          if (this.isCurrent(generation)) this.options.disconnected();
        },
      });
      this.options.diagnostic?.('peer-created', { generation });
    } catch {
      this.peer = undefined;
      this.options.diagnostic?.('peer-create-failed', { generation });
    }
  }

  private isCurrent(generation: number) { return !this.closed && generation === this.generation; }

  private attach(channel: Channel, generation: number) {
    if (!this.isCurrent(generation)) { channel.close(); return; }
    channel.onClose(() => this.failed(generation, 'channel-closed'));
    this.options.channel(channel);
  }

  private failed(generation: number, event: 'channel-closed' | 'peer-offer-failed' | 'peer-signal-failed') {
    if (!this.isCurrent(generation)) return;
    this.connectionState = 'failed';
    this.options.diagnostic?.(event, { generation });
    this.options.disconnected();
  }

  async offer() {
    if (this.closed) return;
    const generation = this.generation;
    try { await this.peer?.offer(); } catch { this.failed(generation, 'peer-offer-failed'); }
  }

  async accept(signal: RecoverySignal) {
    const generation = signal.generation ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid ICE generation');
    if (generation < this.generation || this.closed) return;
    if (generation > this.generation) {
      if (!this.options.desktop) return;
      this.generation = generation;
      this.create();
    }
    try { await this.peer?.accept(signal); } catch { this.failed(generation, 'peer-signal-failed'); }
  }

  recover(healthy: boolean, signaling: boolean) {
    if (this.options.desktop || this.closed) return;
    if (healthy) { this.established = true; this.unhealthySince = undefined; return; }
    const now = Date.now();
    this.unhealthySince ??= now;
    const policy = getChatPolicy();
    // Read the live policy on every tick, including attempts started before a settings update.
    if (!signaling || (now - this.lastAttempt) / MILLISECONDS_PER_SECOND < policy.p2pRetryIntervalSeconds
      || !this.retryReady(now, policy)) return;
    this.generation += 1;
    this.options.diagnostic?.('peer-retry', { generation: this.generation,
      state: this.connectionState, elapsedMs: now - this.lastAttempt });
    this.create();
    void this.offer();
  }

  private retryReady(now: number, policy: ChatPolicy) {
    if (!this.peer || this.connectionState === 'failed' || this.connectionState === 'closed') return true;
    // Compare elapsed seconds instead of creating a timer that could overflow for large settings.
    if (!this.established) {
      return (now - this.lastAttempt) / MILLISECONDS_PER_SECOND >= policy.p2pNegotiationTimeoutSeconds;
    }
    // A brief lost probe selects relay immediately, but must not tear down a recoverable peer.
    return this.unhealthySince !== undefined
      && (now - this.unhealthySince) / MILLISECONDS_PER_SECOND >= policy.p2pDisconnectGraceSeconds;
  }

  close() { this.closed = true; this.peer?.close(); }
}
