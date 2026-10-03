const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15_000, 15_000];
const STABLE_CONNECTION_MS = 30_000;

/** Retry a failed desktop without retaining timers after the viewer closes. */
export class DesktopRecovery {
  private failures = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  constructor(private readonly reconnect: () => void, private readonly status: (text: string) => void) {}

  connected() {
    clearTimeout(this.retryTimer); clearTimeout(this.stableTimer);
    this.retryTimer = undefined;
    this.stableTimer = setTimeout(() => { this.failures = 0; }, STABLE_CONNECTION_MS);
  }

  failed(message: string) {
    clearTimeout(this.stableTimer);
    if (this.stopped || this.retryTimer) return;
    const delay = RETRY_DELAYS[this.failures++];
    if (delay === undefined) { this.status(message); return; }
    this.status('连接已断开，正在重连…');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.stopped) this.reconnect();
    }, delay);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer); clearTimeout(this.stableTimer);
  }
}
