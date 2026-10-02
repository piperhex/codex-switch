import type { ConnectionDiagnostic, DiagnosticFields } from './diagnostics';
import { candidateType } from './iceCandidate';
import { connectionEndpoint } from './connectionEndpoints';

const PROBE_COUNTERS = ['requestsSent', 'requestsReceived', 'responsesReceived', 'bytesSent', 'bytesReceived'] as const;

interface Stat {
  id: string; type: string; selectedCandidatePairId?: string; selected?: boolean; nominated?: boolean;
  state?: string; localCandidateId?: string; remoteCandidateId?: string; candidateType?: string;
  address?: string; ip?: string; port?: number; protocol?: string; currentRoundTripTime?: number;
  requestsSent?: number; requestsReceived?: number; responsesReceived?: number;
  bytesSent?: number; bytesReceived?: number;
}

/** Return UI-only selected addresses; diagnostics still contain only candidate kinds and RTT. */
export function selectedIcePair(report: RTCStatsReport, diagnostic?: ConnectionDiagnostic) {
  const stats = new Map<string, Stat>();
  report.forEach(value => { const stat = value as Stat; stats.set(stat.id, stat); });
  const transport = [...stats.values()].find(stat => stat.type === 'transport' && stat.selectedCandidatePairId);
  const pairs = [...stats.values()].filter(stat => stat.type === 'candidate-pair' && stat.state === 'succeeded');
  const pair = transport ? stats.get(transport.selectedCandidatePairId!)
    : pairs.find(stat => stat.selected) ?? pairs.find(stat => stat.nominated);
  if (!pair) return;
  const local = stats.get(pair.localCandidateId ?? ''), remote = stats.get(pair.remoteCandidateId ?? '');
  diagnostic?.('path-state', { transport: 'rtc', state: 'connected',
    localType: candidateType(local?.candidateType), remoteType: candidateType(remote?.candidateType),
    ipv6: Boolean(remote?.address?.includes(':')),
    rttMs: typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : undefined });
  if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') return;
  return { local: connectionEndpoint(local?.address ?? local?.ip, local?.port, local?.protocol),
    remote: connectionEndpoint(remote?.address ?? remote?.ip, remote?.port, remote?.protocol) };
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
