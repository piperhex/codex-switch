const RENEW_BEFORE_MS = 60_000;
const RETRY_MS = 5000;
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Renewal never extends authorization locally; only an authenticated coordinator can renew the lease. */
export class SessionRenewal {
  private timer?: ReturnType<typeof setTimeout>;
  private expiresAt = 0;
  private renewed = 0;
  private generation = 0;
  private pending = false;

  constructor(private readonly renew: () => Promise<void>) {}

  update(expiresAt: number) {
    this.expiresAt = expiresAt;
    this.schedule();
  }

  private schedule(retrying = false) {
    clearTimeout(this.timer);
    if (this.pending || this.expiresAt === this.renewed || this.expiresAt <= Date.now()) return;
    const delay = retrying ? RETRY_MS : Math.max(0, this.expiresAt - Date.now() - RENEW_BEFORE_MS);
    this.timer = setTimeout(() => { void this.run(); }, Math.min(delay, MAX_TIMER_MS));
  }

  private async run() {
    if (this.expiresAt <= Date.now()) return;
    if (this.expiresAt - Date.now() > RENEW_BEFORE_MS) { this.schedule(); return; }
    const generation = this.generation;
    const expiresAt = this.expiresAt;
    this.pending = true;
    let retrying = false;
    try {
      await this.renew();
      if (generation === this.generation) this.renewed = expiresAt;
    } catch { retrying = true; }
    finally {
      this.pending = false;
      this.schedule(retrying && generation === this.generation);
    }
  }

  clear() {
    this.generation += 1;
    clearTimeout(this.timer);
    this.expiresAt = 0;
    this.renewed = 0;
  }
}
