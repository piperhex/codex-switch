export const DIAGNOSTIC_EVENTS = [
  'mode', 'relay-timeout', 'peer-created', 'peer-create-failed', 'peer-state', 'peer-retry',
  'peer-offer-failed', 'peer-signal-failed', 'channel-closed', 'link-failed', 'path-state', 'path-selected',
  'candidate-rejected', 'tcp-discovery', 'tcp-dial', 'ice-state', 'ice-gathering', 'ice-candidate',
  'ice-error', 'ice-summary', 'sdp-state', 'desktop-start', 'desktop-failed', 'desktop-closed',
  'native-state', 'diagnostic-throttled',
] as const;
export const DIAGNOSTIC_ENUMS = {
  scope: ['chat', 'desktop'], transport: ['rtc', 'tcp', 'mesh'],
  state: ['new', 'checking', 'connecting', 'connected', 'completed', 'disconnected', 'failed', 'closed'],
  mode: ['connecting', 'direct', 'relay', 'offline'],
  stage: ['starting', 'ready', 'failed', 'exhausted', 'gathering', 'complete', 'offer', 'answer',
    'engine-start', 'engine-failed', 'discovery', 'stream-connect', 'stream-failed', 'stream-open', 'stopped'],
  localType: ['host', 'srflx', 'prflx', 'relay', 'unknown'],
  remoteType: ['host', 'srflx', 'prflx', 'relay', 'unknown'],
  candidateType: ['host', 'srflx', 'prflx', 'relay', 'unknown'],
  direction: ['local', 'remote'], protocol: ['udp', 'tcp', 'unknown'],
  addressKind: ['public', 'private', 'mdns', 'loopback', 'link-local', 'fake-ip', 'unknown'],
  reason: ['timeout', 'peer-failed', 'unhealthy', 'unavailable', 'candidate-limit', 'candidate-rejected',
    'invalid-state', 'invalid-description', 'operation-failed', 'network', 'permission', 'unsupported', 'unknown'],
} as const;
export const DIAGNOSTIC_NUMBERS = [
  'generation', 'elapsedMs', 'attempt', 'rttMs', 'errorCode', 'localCandidates', 'remoteCandidates',
  'candidatePairs', 'failedPairs', 'succeededPairs', 'requestsSent', 'requestsReceived', 'responsesReceived',
  'bytesSent', 'bytesReceived', 'rejectedCandidates', 'connectedPeers', 'routeCount', 'udpNatType', 'tcpNatType',
  'suppressed', 'stunServers', 'turnServers',
] as const;
export const DIAGNOSTIC_BOOLEANS = ['directHealthy', 'relayHealthy', 'ipv6', 'remoteKnown', 'direct'] as const;
type EnumFields = { [K in keyof typeof DIAGNOSTIC_ENUMS]?: (typeof DIAGNOSTIC_ENUMS)[K][number] };
export type DiagnosticFields = EnumFields & Partial<Record<(typeof DIAGNOSTIC_NUMBERS)[number], number>>
  & Partial<Record<(typeof DIAGNOSTIC_BOOLEANS)[number], boolean>>;
export type DiagnosticEvent = (typeof DIAGNOSTIC_EVENTS)[number];

/** Treat even native statistics as untrusted: never copy arbitrary strings, SDP, addresses or errors. */
export function sanitizeDiagnostic(value: DiagnosticFields): DiagnosticFields {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, allowed] of Object.entries(DIAGNOSTIC_ENUMS)) {
    const item = value[key as keyof DiagnosticFields];
    if (typeof item === 'string' && (allowed as readonly string[]).includes(item)) result[key] = item;
  }
  for (const key of DIAGNOSTIC_NUMBERS) {
    const item = value[key];
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= Number.MAX_SAFE_INTEGER) {
      result[key] = Math.round(item);
    }
  }
  for (const key of DIAGNOSTIC_BOOLEANS) if (typeof value[key] === 'boolean') result[key] = value[key]!;
  return result as DiagnosticFields;
}
