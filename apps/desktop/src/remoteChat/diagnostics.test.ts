import { afterEach, expect, it, vi } from 'vitest';
import { connectionDiagnostic } from '../../../../shared/remote-chat/diagnostics';
import { sanitizeDiagnostic } from '../../../../shared/remote-chat/diagnosticSchema';
import { RtcObserver } from '../../../../shared/remote-chat/rtcObserver';
import { iceSummary } from '../../../../shared/remote-chat/rtcDiagnostics';
import { HotLink } from '../../../../shared/remote-chat/hotLink';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('redacts injected addresses, credentials and errors and bounds reporting without throwing', () => {
  vi.useFakeTimers(); vi.spyOn(console, 'debug').mockImplementation(() => {});
  const report = vi.fn(() => { throw new Error('offline'); });
  const diagnostic = connectionDiagnostic('session', false, report);
  const unsafe = { reason: 'password', address: '192.168.1.2', sdp: 'private', credential: 'private',
    requestsSent: Infinity, requestsReceived: -1, responsesReceived: 2, state: 'failed' };
  // Runtime/native input need not conform to TypeScript's declared types.
  expect(sanitizeDiagnostic(unsafe as never)).toEqual({ state: 'failed', responsesReceived: 2 });
  for (let i = 0; i < 1000; i++) diagnostic('ice-summary', unsafe as never);
  expect(report).toHaveBeenCalledTimes(180);
  expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|password|192\.168/);
  vi.advanceTimersByTime(60_000); diagnostic('ice-state', { state: 'checking' });
  expect(report).toHaveBeenCalledWith('diagnostic-throttled', expect.objectContaining({ suppressed: 820 }));
});

it('reports failed ICE probes with zero responses without exposing pair addresses', () => {
  const diagnostic = vi.fn();
  const report = new Map([['pair', { id: 'pair', type: 'candidate-pair', state: 'failed',
    requestsSent: 622, requestsReceived: 0, responsesReceived: 0, address: 'private' }]]);
  iceSummary(report as unknown as RTCStatsReport, diagnostic);
  expect(diagnostic).toHaveBeenCalledWith('ice-summary', expect.objectContaining({
    candidatePairs: 1, failedPairs: 1, requestsSent: 622, requestsReceived: 0, responsesReceived: 0,
  }));
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private');
});

it('samples without overlapping stats requests and disposes listeners and timers', async () => {
  vi.useFakeTimers();
  let finish!: (report: RTCStatsReport) => void;
  const diagnostic = vi.fn();
  const pc = { addEventListener: vi.fn(), removeEventListener: vi.fn(), connectionState: 'connecting',
    getStats: vi.fn(() => new Promise<RTCStatsReport>(resolve => { finish = resolve; })) };
  const observer = new RtcObserver(pc as unknown as RTCPeerConnection, diagnostic);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(pc.getStats).toHaveBeenCalledOnce();
  observer.close(); finish(new Map() as RTCStatsReport);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(diagnostic).not.toHaveBeenCalled();
  expect(pc.removeEventListener).toHaveBeenCalledTimes(pc.addEventListener.mock.calls.length);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not present unsupported probe counters as evidence of zero responses', () => {
  const diagnostic = vi.fn();
  const report = new Map([['pair', { id: 'pair', type: 'candidate-pair', state: 'in-progress' }]]);
  iceSummary(report as unknown as RTCStatsReport, diagnostic);
  const fields = diagnostic.mock.calls[0][1];
  expect(fields.candidatePairs).toBe(1);
  expect(fields).not.toHaveProperty('responsesReceived');
  expect(fields).not.toHaveProperty('requestsSent');
});

it('uploads only when supported and keeps relay available when a diagnostic send fails', () => {
  vi.useFakeTimers(); vi.spyOn(console, 'debug').mockImplementation(() => {});
  let enabled = false;
  const signal = vi.fn().mockImplementationOnce(() => { throw new Error('diagnostic unavailable'); });
  const error = vi.fn();
  const link = new HotLink({ sessionId: 'session', desktop: false, secret: new Uint8Array(32), iceServers: [],
    createPeer: () => ({ offer: async () => {}, accept: async () => {}, close() {} }),
    diagnosticsEnabled: () => enabled, signal, relayBuffered: () => 0, message: vi.fn(), mode: vi.fn(), error });
  try {
    link.reportDiagnostic('ice-state', { state: 'checking' });
    expect(signal).not.toHaveBeenCalled();
    enabled = true;
    expect(() => link.reportDiagnostic('ice-state', { state: 'checking' })).not.toThrow();
    link.reportDiagnostic('ice-state', { state: 'connected' });
    expect(signal).toHaveBeenCalledTimes(2);
    expect(signal).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'diagnostic',
      sessionId: 'session', payload: expect.objectContaining({ event: 'ice-state', state: 'connected' }) }));
    expect(error).not.toHaveBeenCalled();
  } finally { link.close(); }
  expect(vi.getTimerCount()).toBe(0);
});
