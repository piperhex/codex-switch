import type { ConnectionDiagnostic } from './diagnostics';
import { candidateMetadata } from './iceCandidate';
import { iceSummary, selectedIcePair } from './rtcDiagnostics';
import type { ConnectionEndpoints } from './connectionEndpoints';

const SNAPSHOT_INTERVAL_MS = 5000;

/** Single-flight sampling also follows selected pair changes after ICE connects; addresses stay in memory. */
export class RtcObserver {
  private endpoints?: ConnectionEndpoints;
  private closed = false;
  private pending = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly cleanup: (() => void)[] = [];
  private readonly seenCandidates = new Set<string>();
  constructor(private readonly pc: RTCPeerConnection, private readonly diagnostic?: ConnectionDiagnostic) {
    this.bind('iceconnectionstatechange', () => {
      this.diagnostic?.('ice-state', { transport: 'rtc', state: pc.iceConnectionState });
      void this.snapshot();
    });
    this.bind('icegatheringstatechange', () => {
      this.diagnostic?.('ice-gathering', { transport: 'rtc', stage: pc.iceGatheringState === 'new'
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
      this.diagnostic?.('ice-error', { transport: 'rtc', errorCode });
    });
    this.bind('connectionstatechange', () => {
      this.diagnostic?.('path-state', { transport: 'rtc', state: pc.connectionState });
      void this.snapshot();
    });
    this.timer = setInterval(() => { void this.snapshot(pc.connectionState !== 'connected'); }, SNAPSHOT_INTERVAL_MS);
  }

  get connectionEndpoints() {
    return !this.closed && this.pc.connectionState === 'connected' ? this.endpoints : undefined;
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
    this.diagnostic?.('ice-candidate', fields);
  }

  async snapshot(reportDiagnostic = true) {
    if (this.closed || this.pending || !this.pc.getStats) return;
    this.pending = true;
    try {
      const report = await this.pc.getStats();
      if (this.closed) return;
      const diagnostic = reportDiagnostic ? this.diagnostic : undefined;
      if (diagnostic) iceSummary(report, diagnostic);
      this.endpoints = selectedIcePair(report, diagnostic);
    } catch { this.endpoints = undefined; /* Stats may be unavailable after terminal ICE failure. */ }
    finally { this.pending = false; }
  }

  close() {
    this.closed = true; clearInterval(this.timer);
    this.cleanup.forEach(remove => remove()); this.cleanup.length = 0;
  }
}
