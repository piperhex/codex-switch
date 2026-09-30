import type { ConnectionDiagnostic } from './diagnostics';

interface Stat {
  id: string; type: string; selectedCandidatePairId?: string; selected?: boolean; nominated?: boolean;
  state?: string; localCandidateId?: string; remoteCandidateId?: string; candidateType?: string;
  address?: string; currentRoundTripTime?: number;
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
    localType: local?.candidateType, remoteType: remote?.candidateType,
    ipv6: Boolean(remote?.address?.includes(':')),
    rttMs: typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : undefined });
}
