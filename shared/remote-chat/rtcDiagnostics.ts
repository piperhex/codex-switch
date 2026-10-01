import type { ConnectionDiagnostic, DiagnosticFields } from './diagnostics';
import { candidateType } from './iceCandidate';

const PROBE_COUNTERS = ['requestsSent', 'requestsReceived', 'responsesReceived', 'bytesSent', 'bytesReceived'] as const;

interface Stat {
  id: string; type: string; selectedCandidatePairId?: string; selected?: boolean; nominated?: boolean;
  state?: string; localCandidateId?: string; remoteCandidateId?: string; candidateType?: string;
  address?: string; currentRoundTripTime?: number;
  requestsSent?: number; requestsReceived?: number; responsesReceived?: number;
  bytesSent?: number; bytesReceived?: number;
}

/** Log candidate kinds and measured RTT; addresses, SDP and credentials never leave the peer. */
export function selectedIcePair(report: RTCStatsReport, diagnostic?: ConnectionDiagnostic) {
  const stats = new Map<string, Stat>();
  report.forEach(value => { const stat = value as Stat; stats.set(stat.id, stat); });
  const transport = [...stats.values()].find(stat => stat.type === 'transport' && stat.selectedCandidatePairId);
  const pair = transport ? stats.get(transport.selectedCandidatePairId!)
    : [...stats.values()].find(stat => stat.type === 'candidate-pair'
      && stat.state === 'succeeded' && (stat.selected || stat.nominated));
  if (!pair) return;
  const local = stats.get(pair.localCandidateId ?? ''), remote = stats.get(pair.remoteCandidateId ?? '');
  diagnostic?.('path-state', { transport: 'rtc', state: 'connected',
    localType: candidateType(local?.candidateType), remoteType: candidateType(remote?.candidateType),
    ipv6: Boolean(remote?.address?.includes(':')),
    rttMs: typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : undefined });
}

/** Failed pairs are as useful as successful ones: zero responses distinguishes probing from connectivity. */
export function iceSummary(report: RTCStatsReport, diagnostic: ConnectionDiagnostic) {
  const fields = { localCandidates: 0, remoteCandidates: 0, candidatePairs: 0, failedPairs: 0, succeededPairs: 0 };
  const counters: DiagnosticFields = {};
  report.forEach(value => {
    const stat = value as Stat;
    if (stat.type === 'local-candidate') fields.localCandidates++;
    if (stat.type === 'remote-candidate') fields.remoteCandidates++;
    if (stat.type !== 'candidate-pair') return;
    fields.candidatePairs++;
    if (stat.state === 'failed') fields.failedPairs++;
    if (stat.state === 'succeeded') fields.succeededPairs++;
    for (const key of PROBE_COUNTERS) {
      const number = stat[key];
      if (typeof number === 'number' && Number.isFinite(number) && number >= 0) {
        counters[key] = (counters[key] ?? 0) + number;
      }
    }
  });
  diagnostic('ice-summary', { transport: 'rtc', ...fields, ...counters });
}
