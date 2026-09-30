import { expect, it, vi } from 'vitest';
import { selectedIcePair } from '../../../../shared/remote-chat/rtcDiagnostics';

it('reports the chosen candidate types and RTT without exposing network addresses', () => {
  const stats = new Map([
    ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote',
      currentRoundTripTime: 0.018 }],
    ['local', { id: 'local', type: 'local-candidate', candidateType: 'host', address: '192.168.1.1' }],
    ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'srflx', address: '2001:db8::8' }],
  ]);
  const diagnostic = vi.fn(); selectedIcePair(stats as unknown as RTCStatsReport, diagnostic);
  expect(diagnostic).toHaveBeenCalledWith('path-state', { transport: 'rtc', state: 'connected',
    localType: 'host', remoteType: 'srflx', ipv6: true, rttMs: 18 });
  expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/192\.168|2001:db8/);
});
