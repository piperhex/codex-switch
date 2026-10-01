import type { ConnectionDiagnostic } from './diagnostics';
import { candidateMetadata } from './iceCandidate';
import { iceSummary, selectedIcePair } from './rtcDiagnostics';

const SNAPSHOT_INTERVAL_MS = 5000;

/** Bounded, single-flight sampling while ICE is negotiating; no addresses or STUN credentials are logged. */
export class RtcObserver {
  private closed = false;
  private pending = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly cleanup: (() => void)[] = [];
  private readonly seenCandidates = new Set<string>();
  constructor(private readonly pc: RTCPeerConnection, private readonly diagnostic: ConnectionDiagnostic) {
    this.bind('iceconnectionstatechange', () => {
      this.diagnostic('ice-state', { transport: 'rtc', state: pc.iceConnectionState });
      void this.snapshot();
    });
    this.bind('icegatheringstatechange', () => {
      this.diagnostic('ice-gathering', { transport: 'rtc', stage: pc.iceGatheringState === 'new'
        ? 'starting' : pc.iceGatheringState });
      if (pc.iceGatheringState === 'complete') void this.snapshot();
    });
    this.bind('icecandidate', event => {
      const candidate = (event as RTCPeerConnectionIceEvent).candidate;
      if (candidate) this.candidate(candidate, 'local');
    });
    this.bind('icecandidateerror', event => {
      // errorText and url can contain private addresses and TURN usernames.
      const errorCode = (event as RTCPeerConnectionIceErrorEvent).errorCode;
      this.diagnostic('ice-error', { transport: 'rtc', errorCode });
    });
    this.bind('connectionstatechange', () => {
      this.diagnostic('path-state', { transport: 'rtc', state: pc.connectionState });
      void this.snapshot();
    });
    this.timer = setInterval(() => {
      if (pc.connectionState !== 'connected') void this.snapshot();
    }, SNAPSHOT_INTERVAL_MS);
  }

  private bind(name: string, listener: (event: Event) => void) {
    const active = (event: Event) => { if (!this.closed) listener(event); };
    this.pc.addEventListener(name, active);
    this.cleanup.push(() => this.pc.removeEventListener?.(name, active));
  }

  candidate(candidate: RTCIceCandidateInit, direction: 'local' | 'remote') {
    if (this.closed) return;
    const fields = { transport: 'rtc' as const, direction, ...candidateMetadata(candidate) };
    const key = JSON.stringify(fields);
    if (this.seenCandidates.has(key)) return;
    this.seenCandidates.add(key);
    this.diagnostic('ice-candidate', fields);
  }

  async snapshot() {
    if (this.closed || this.pending || !this.pc.getStats) return;
    this.pending = true;
    try {
      const report = await this.pc.getStats();
      if (this.closed) return;
      iceSummary(report, this.diagnostic);
      selectedIcePair(report, this.diagnostic);
    } catch { /* Some platform versions cannot provide stats after a terminal ICE failure. */ }
    finally { this.pending = false; }
  }

  close() {
    this.closed = true; clearInterval(this.timer);
    this.cleanup.forEach(remove => remove()); this.cleanup.length = 0;
  }
}
