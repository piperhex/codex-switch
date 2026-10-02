import type { PeerFactory } from './protocol';
import { MAX_PUBLIC_ENDPOINTS, signalPublicEndpoints, type ConnectionPublicEndpoints } from './publicEndpoints';

/** UI-only connection facts stay out of diagnostic logs and reset with each peer generation. */
export class PublicEndpointObserver {
  private revision = 0;
  private snapshot: ConnectionPublicEndpoints = { local: [], remote: [] };

  constructor(private readonly changed: (value: ConnectionPublicEndpoints) => void) {}

  reset() {
    this.revision++;
    if (!this.snapshot.local.length && !this.snapshot.remote.length) return;
    this.snapshot = { local: [], remote: [] };
    this.changed(this.snapshot);
  }

  private observe(side: keyof ConnectionPublicEndpoints, signal: unknown) {
    const addresses = [...this.snapshot[side]];
    for (const address of signalPublicEndpoints(signal)) {
      if (addresses.length >= MAX_PUBLIC_ENDPOINTS) break;
      if (!addresses.some(item => item.host === address.host && item.port === address.port
        && item.protocol === address.protocol)) addresses.push(address);
    }
    if (addresses.length === this.snapshot[side].length) return;
    this.snapshot = { ...this.snapshot, [side]: addresses };
    this.changed(this.snapshot);
  }

  wrap(factory: PeerFactory): PeerFactory {
    return options => {
      this.reset();
      const revision = this.revision;
      let closed = false;
      const observe = (side: keyof ConnectionPublicEndpoints, signal: unknown) => {
        if (!closed && revision === this.revision) this.observe(side, signal);
      };
      const peer = factory({ ...options, signal: signal => {
        observe('local', signal);
        options.signal(signal);
      } });
      return {
        offer: () => peer.offer(),
        accept: signal => { observe('remote', signal); return peer.accept(signal); },
        // Legacy relay fallback closes the peer; keep facts until the session ends or discovery restarts.
        close: () => { closed = true; peer.close(); },
      };
    };
  }
}
