import type { ConnectionMode } from './protocol';
import { formatPublicEndpoint, type PublicEndpoint } from './publicEndpoints';

/** Socket/selected ICE addresses for the active path, separate from discovered public candidates. */
export interface ConnectionEndpoints {
  local?: PublicEndpoint;
  remote?: PublicEndpoint;
  /** Public source address confirmed by the peer over the current direct path. */
  localPublic?: PublicEndpoint;
}

function ipLiteral(host: string): boolean {
  if (!host.includes(':')) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(host)
      && host.split('.').every(part => Number(part) <= 255 && (part.length === 1 || !part.startsWith('0')))
      && host !== '0.0.0.0';
  }
  const halves = host.split('::');
  const groups = halves.flatMap(half => half ? half.split(':') : []);
  return halves.length <= 2 && (halves.length === 1 ? groups.length === 8 : groups.length < 8)
    && groups.every(group => /^[\da-f]{1,4}$/i.test(group)) && groups.some(group => Number.parseInt(group, 16) !== 0);
}

/** Hidden browser addresses and wildcard bindings must not be guessed from other candidates. */
export function connectionEndpoint(host: unknown, port: unknown, protocol: unknown): PublicEndpoint | undefined {
  if (typeof host !== 'string') return;
  const address = host.replace(/^\[|\]$/g, '').replace(/^::ffff:(?=\d+\.)/i, '').toLowerCase();
  if (address.length > 45 || !ipLiteral(address) || typeof port !== 'number'
    || !Number.isInteger(port) || port < 1 || port > 65535 || (protocol !== 'udp' && protocol !== 'tcp')) return;
  return { host: address, port, protocol };
}

export function connectionEndpointRows(mode: ConnectionMode, value?: ConnectionEndpoints) {
  if (mode !== 'direct') return [];
  const local = value?.localPublic ?? value?.local;
  return [
    { id: 'local', label: value?.localPublic ? '本机公网 IP 和端口' : '本机 IP 和端口',
      address: local && formatPublicEndpoint(local) },
    { id: 'remote', label: '电脑 IP 和端口', address: value?.remote && formatPublicEndpoint(value.remote) },
  ];
}

const REFRESH_MS = 1000;

/** Read cached transport facts only; sampling never performs I/O or overlaps a stats request. */
export class ConnectionEndpointMonitor {
  private key = '';
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(read: () => ConnectionEndpoints | undefined,
    private readonly changed: (value?: ConnectionEndpoints) => void) {
    this.timer = setInterval(() => this.publish(read()), REFRESH_MS);
  }

  private publish(value?: ConnectionEndpoints) {
    const key = JSON.stringify(value) ?? '';
    if (key === this.key) return;
    this.key = key;
    this.changed(value);
  }

  close() { clearInterval(this.timer); this.publish(); }
}
