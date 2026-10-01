import type { DiagnosticFields, ConnectionDiagnostic } from './diagnostics';

export function candidateMetadata(candidate: RTCIceCandidateInit): DiagnosticFields {
  const parts = (candidate.candidate ?? '').trim().split(/\s+/);
  const type = parts[parts.indexOf('typ') + 1];
  const host = parts[4]?.toLowerCase() ?? '';
  const octets = host.split('.').map(Number);
  let addressKind: DiagnosticFields['addressKind'] = 'unknown';
  if (host.endsWith('.local')) addressKind = 'mdns';
  else if (host.includes(':')) addressKind = ipv6Kind(host);
  else if (octets.length === 4 && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) {
    addressKind = ipv4Kind(octets);
  }
  return { candidateType: candidateType(type), ipv6: host.includes(':'), addressKind,
    protocol: ['udp', 'tcp'].includes(parts[2]?.toLowerCase()) ? parts[2].toLowerCase() as 'udp' | 'tcp' : 'unknown' };
}

function ipv6Kind(host: string): DiagnosticFields['addressKind'] {
  if (host === '::1') return 'loopback';
  if (/^fe[89ab]/.test(host)) return 'link-local';
  if (/^f[cd]/.test(host)) return 'private';
  if (host === '::') return 'unknown';
  return 'public';
}

function ipv4Kind([a, b]: number[]): DiagnosticFields['addressKind'] {
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 198 && (b === 18 || b === 19)) return 'fake-ip';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)) return 'private';
  return a > 0 && a < 224 ? 'public' : 'unknown';
}

export function candidateType(value: unknown): NonNullable<DiagnosticFields['candidateType']> {
  return value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay' ? value : 'unknown';
}

export function diagnosticError(error: unknown): NonNullable<DiagnosticFields['reason']> {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined;
  switch (name) {
    case 'InvalidStateError': return 'invalid-state';
    case 'SyntaxError': case 'TypeError': return 'invalid-description';
    case 'OperationError': return 'operation-failed';
    case 'NotAllowedError': return 'permission';
    case 'NotSupportedError': return 'unsupported';
    case 'NetworkError': return 'network';
    default: return 'unknown';
  }
}

/** One unsupported address must not discard the rest of a trickle-ICE batch. */
export async function addIceCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit,
  diagnostic?: ConnectionDiagnostic): Promise<boolean> {
  try { await pc.addIceCandidate(candidate); return true; }
  catch (error) {
    diagnostic?.('candidate-rejected', { transport: 'rtc', direction: 'remote',
      ...candidateMetadata(candidate), reason: diagnosticError(error) });
    return false;
  }
}
