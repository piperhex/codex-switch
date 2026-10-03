import type { DesktopStats } from './protocol';

const RETRY_DELAYS_MS = [5000, 15_000, 30_000, 60_000];
const STABLE_DIRECT_MS = 30_000;

/** One viewer keeps its backoff across media reconnects; a brief promotion is not recovery. */
export class DesktopDirectRetry {
  private failures = 0;
  private directSince?: number;

  get delay() { return RETRY_DELAYS_MS[this.failures]; }

  update(connection?: DesktopStats['connection']) {
    if (!connection) return;
    const now = Date.now();
    if (connection === 'direct') {
      this.directSince ??= now;
      if (now - this.directSince >= STABLE_DIRECT_MS) this.failures = 0;
      return;
    }
    if (this.directSince === undefined) return;
    if (now - this.directSince < STABLE_DIRECT_MS) this.failed();
    else this.failures = 0;
    this.directSince = undefined;
  }

  failed() {
    this.failures = Math.min(this.failures + 1, RETRY_DELAYS_MS.length - 1);
    this.directSince = undefined;
  }

  end() { this.directSince = undefined; }
}
