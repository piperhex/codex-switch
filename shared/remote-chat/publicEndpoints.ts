import { candidateMetadata } from './iceCandidate';

export interface PublicEndpoint { host: string; port: number; protocol: 'udp' | 'tcp' }
export interface ConnectionPublicEndpoints { local: PublicEndpoint[]; remote: PublicEndpoint[] }
export const MAX_PUBLIC_ENDPOINTS = 8;

function publicHost(host: string): boolean {
  if (host.includes(':')) {
    const halves = host.split('::');
    const groups = halves.flatMap(half => half ? half.split(':') : []);
    return halves.length <= 2 && (halves.length === 1 ? groups.length === 8 : groups.length < 8)
      && groups.every(group => /^[\da-f]{1,4}$/i.test(group)) && /^[23][\da-f]{3}:/i.test(host);
  }
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  if (host.split('.').some(part => Number(part) > 255 || (part.length > 1 && part.startsWith('0')))) return false;
  return candidateMetadata({ candidate: `candidate:0 1 udp 1 ${host} 1 typ host` }).addressKind === 'public';
}

function endpoint(host: unknown, port: unknown, protocol: unknown): PublicEndpoint[] {
  if (typeof host !== 'string' || host.length > 45 || !publicHost(host)
    || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535
    || (protocol !== 'udp' && protocol !== 'tcp')) return [];
  return [{ host: host.toLowerCase(), port, protocol }];
}

function iceEndpoint(candidate: string): PublicEndpoint[] {
  const parts = candidate.trim().replace(/^a=/, '').split(/\s+/);
  if (!parts[0]?.startsWith('candidate:') || parts[6] !== 'typ'
    || !['host', 'srflx', 'prflx'].includes(parts[7]) || !/^\d+$/.test(parts[5])) return [];
  const protocol = parts[2]?.toLowerCase();
  // Active TCP candidates advertise a placeholder port, while TURN candidates belong to the relay.
  if (protocol === 'tcp' && parts.includes('tcptype') && parts[parts.indexOf('tcptype') + 1] === 'active') return [];
  return endpoint(parts[4], Number(parts[5]), protocol);
}

/** Read only addresses already discovered by the active connection; never initiate a separate probe. */
export function signalPublicEndpoints(value: unknown): PublicEndpoint[] {
  if (!value || typeof value !== 'object') return [];
  const signal = value as Record<string, unknown>;
  if (signal.kind === 'ice' && typeof signal.candidate === 'string') return iceEndpoint(signal.candidate);
  if (signal.kind === 'sdp' && typeof signal.sdp === 'string') {
    return signal.sdp.split(/\r?\n/).flatMap(iceEndpoint).slice(0, MAX_PUBLIC_ENDPOINTS);
  }
  if (signal.kind !== 'tcp' || !Array.isArray(signal.addresses)) return [];
  return signal.addresses.slice(0, MAX_PUBLIC_ENDPOINTS).flatMap((address: unknown) => {
    if (!address || typeof address !== 'object') return [];
    const { host, port } = address as Record<string, unknown>;
    return endpoint(host, port, 'tcp');
  });
}

export function formatPublicEndpoint(value: PublicEndpoint): string {
  const host = value.host.includes(':') ? `[${value.host}]` : value.host;
  return `${host}:${value.port} · ${value.protocol.toUpperCase()}`;
}

export function publicEndpointRows(value?: ConnectionPublicEndpoints) {
  return [
    { id: 'local', label: '本机公网 IP 和端口', addresses: value?.local.map(formatPublicEndpoint) ?? [] },
    { id: 'remote', label: '电脑公网 IP 和端口', addresses: value?.remote.map(formatPublicEndpoint) ?? [] },
  ];
}
