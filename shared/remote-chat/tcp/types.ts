import type { Channel } from '../protocol';

export interface TcpAddress { host: string; port: number }
export interface TcpPunchConfig { servers: TcpAddress[] }
export interface TcpSignal { kind: 'tcp'; publicKey: string; addresses: TcpAddress[] }
export interface TcpSocket {
  localAddress: string;
  localPort: number;
  bufferedAmount: number;
  write(data: Uint8Array): void;
  close(): void;
  onData(callback: (data: Uint8Array) => void): void;
  onClose(callback: () => void): void;
}
export interface TcpListener { port: number; close(): void }
export interface TcpNetwork {
  localAddresses?(): Promise<string[]>;
  listen(ipv6: boolean, accept: (socket: TcpSocket) => void): Promise<TcpListener>;
  connect(address: TcpAddress & { localPort: number; ipv6: boolean }): Promise<TcpSocket>;
  close(): void;
}
export interface TcpPeerOptions {
  sessionId: string;
  desktop: boolean;
  config: TcpPunchConfig;
  random: (length: number) => Uint8Array;
  signal: (signal: TcpSignal) => void;
  channel: (channel: Channel) => void;
  diagnostic?: import('../diagnostics').ConnectionDiagnostic;
  exhausted?: () => void;
}

const IP_V4 = /^(\d{1,3}\.){3}\d{1,3}$/;

function validIpv6(host: string) {
  const halves = host.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap(half => half ? half.split(':') : []);
  if (!groups.every(group => /^[\da-f]{1,4}$/i.test(group))) return false;
  if (halves.length === 1 ? groups.length !== 8 : groups.length >= 8) return false;
  const first = Number.parseInt(groups[0] ?? '0', 16);
  // Only global and unique-local unicast; no scoped, mapped, unspecified or multicast addresses.
  return !host.startsWith(':') && ((first & 0xe000) === 0x2000 || (first & 0xfe00) === 0xfc00);
}
/** Candidate destinations are IP literals on unprivileged ports, never URLs or hostnames. */
export function validTcpAddress(value: unknown): value is TcpAddress {
  if (!value || typeof value !== 'object') return false;
  const { host, port } = value as Partial<TcpAddress>;
  if (typeof host !== 'string' || host.length > 45 || !Number.isInteger(port)
    || Number(port) < 1024 || Number(port) > 65535) return false;
  if (IP_V4.test(host)) {
    if (host.split('.').some(part => part.length > 1 && part.startsWith('0'))) return false;
    const parts = host.split('.').map(Number);
    return parts.every(part => part <= 255) && parts[0] > 0 && parts[0] !== 127
      && parts[0] < 224 && !(parts[0] === 169 && parts[1] === 254);
  }
  return validIpv6(host);
}
