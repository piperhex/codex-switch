import { connectionEndpoint, type ConnectionEndpoints } from './connectionEndpoints';
import { publicHost, type PublicEndpoint } from './publicEndpoints';
import type { Channel } from './protocol';

interface RouteSnapshot { channel?: Channel; key: string; endpoints?: ConnectionEndpoints }

/** Peer-confirmed mappings belong to one route and never come from unrelated STUN candidates. */
export class PeerEndpointObservation {
  private route?: RouteSnapshot;
  private latestProbe = 0;
  private localPublic?: PublicEndpoint;

  capture(channel?: Channel): RouteSnapshot {
    const endpoints = channel?.readyState === 'open' ? channel.connectionEndpoints : undefined;
    const key = JSON.stringify(endpoints) ?? '';
    if (!this.route || this.route.channel !== channel || this.route.key !== key) {
      this.clear();
      this.route = { channel, key, endpoints };
    }
    return this.route;
  }

  confirm(options: { channel?: Channel; route?: RouteSnapshot; id: number; endpoint: unknown }) {
    if (!options.route || this.capture(options.channel) !== options.route || options.id <= this.latestProbe) return;
    this.latestProbe = options.id;
    this.localPublic = undefined;
    if (!options.endpoint || typeof options.endpoint !== 'object') return;
    const { host, port, protocol } = options.endpoint as Record<string, unknown>;
    const endpoint = connectionEndpoint(host, port, protocol);
    const expectedProtocol = options.route.endpoints?.local?.protocol ?? options.route.endpoints?.remote?.protocol;
    if (!endpoint || !publicHost(endpoint.host) || (expectedProtocol && endpoint.protocol !== expectedProtocol)) return;
    this.localPublic = endpoint;
  }

  read(channel?: Channel): ConnectionEndpoints | undefined {
    const { endpoints } = this.capture(channel);
    return this.localPublic ? { ...endpoints, localPublic: this.localPublic } : endpoints;
  }

  clear() { this.route = undefined; this.localPublic = undefined; this.latestProbe = 0; }
}
