import type { AggregateApi, LocalProxyStatus, Provider } from "../types";

export interface ProviderDataSnapshot {
  providers: Provider[];
  aggregateApis: AggregateApi[];
  localProxy: LocalProxyStatus;
}

interface ProviderDataDependencies {
  loadProviders: () => Promise<Provider[]>;
  loadAggregateApis: () => Promise<AggregateApi[]>;
  loadLocalProxyStatus: () => Promise<LocalProxyStatus>;
  onSnapshot: (snapshot: ProviderDataSnapshot) => void;
  onLocalProxyStatus: (status: LocalProxyStatus) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

/** Serializes refreshes and waits for a fresh snapshot after changes received during a read. */
export class ProviderDataController {
  private active = false;
  private generation = 0;
  private requested = false;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly dependencies: ProviderDataDependencies) {}

  activate = () => {
    this.active = true;
    this.generation += 1;
  };

  dispose = () => {
    this.active = false;
    this.generation += 1;
    this.requested = false;
  };

  acceptLocalProxyStatus = (status: LocalProxyStatus) => {
    if (!this.active) return;
    // A mutation response is newer than any read already in progress, even if a later read fails.
    this.generation += 1;
    this.dependencies.onLocalProxyStatus(status);
  };

  refresh = (): Promise<void> => {
    if (!this.active) return Promise.resolve();
    this.generation += 1;
    this.requested = true;
    this.inFlight ??= this.drain();
    return this.inFlight;
  };

  private async drain(): Promise<void> {
    try {
      while (this.active && this.requested) {
        this.requested = false;
        await this.readSnapshot(this.generation);
      }
    } finally {
      this.inFlight = null;
    }
  }

  private async readSnapshot(generation: number): Promise<void> {
    try {
      // One failed endpoint must not release the flight while the other reads still run.
      const results = await Promise.allSettled([
        this.dependencies.loadProviders(),
        this.dependencies.loadAggregateApis(),
        this.dependencies.loadLocalProxyStatus(),
      ]);
      const snapshot = {
        providers: settledValue(results[0]),
        aggregateApis: settledValue(results[1]),
        localProxy: settledValue(results[2]),
      };
      if (this.isCurrent(generation)) this.dependencies.onSnapshot(snapshot);
    } catch (error) {
      if (this.isCurrent(generation)) this.dependencies.onError(error);
    } finally {
      if (this.isCurrent(generation)) this.dependencies.onSettled();
    }
  }

  private isCurrent(generation: number): boolean {
    return this.active && generation === this.generation;
  }
}
