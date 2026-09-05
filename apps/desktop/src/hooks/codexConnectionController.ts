import type {
  CodexConnectResult,
  CodexConnectionState,
  CodexConnectionStatus,
} from "../api/codexConnectionTypes";

export type CodexConnectionOperation = "connect" | "restart" | null;
export type ParentClientOperation = "start" | "restart" | null;

export interface CodexConnectionSnapshot {
  state: CodexConnectionState | "checking";
  operation: CodexConnectionOperation;
  restartRequired: boolean;
}

interface ConnectionDependencies {
  loadStatus: () => Promise<CodexConnectionStatus>;
  connect: () => Promise<CodexConnectResult>;
  restart: () => Promise<void>;
  isBlocked: () => boolean;
  isVisible: () => boolean;
  onOperationChange: (operation: ParentClientOperation) => void;
  onError: (operation: Exclude<CodexConnectionOperation, null>) => void;
}

/** Keeps background status reads separate from user-authorized connection actions. */
export class CodexConnectionController {
  private snapshot: CodexConnectionSnapshot = {
    state: "checking", operation: null, restartRequired: false,
  };
  private readonly listeners = new Set<() => void>();
  private active = false;
  private generation = 0;
  private confirmationGeneration = 0;
  private polling: Promise<CodexConnectionStatus> | null = null;
  private refreshAfterPoll = false;
  private parentOperationGeneration: number | null = null;

  constructor(private readonly dependencies: ConnectionDependencies) {}

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  activate = () => {
    this.active = true;
    this.generation += 1;
  };

  dispose = () => {
    this.active = false;
    this.generation += 1;
    this.confirmationGeneration += 1;
    this.refreshAfterPoll = false;
    this.snapshot = { ...this.snapshot, restartRequired: false };
  };

  availabilityChanged = () => {
    // Our own parent busy flag must not invalidate the action that set it.
    if (this.snapshot.operation) return;
    this.generation += 1;
    if (this.polling) {
      this.refreshAfterPoll = true;
      return;
    }
    void this.refresh();
  };

  refresh = async (): Promise<void> => {
    if (!this.canPoll()) return;
    const generation = this.generation;
    try {
      this.polling = this.dependencies.loadStatus();
      const status = await this.polling;
      if (this.isCurrent(generation) && this.canPublishPoll()) this.applyStatus(status.state);
    } catch {
      // Keep manual retry available without leaving a stale connected indicator.
      if (this.isCurrent(generation) && this.canPublishPoll()) {
        this.update({ state: "disconnected", restartRequired: false });
      }
    } finally {
      this.polling = null;
      if (this.refreshAfterPoll) {
        this.refreshAfterPoll = false;
        void this.refresh();
      }
    }
  };

  connect = async (): Promise<void> => {
    if (this.snapshot.state !== "disconnected") return;
    const confirmation = this.confirmationGeneration;
    await this.perform("connect", async (generation) => {
      if (confirmation !== this.confirmationGeneration) return;
      const result = await this.dependencies.connect();
      if (!this.isCurrent(generation)) return;
      this.update({
        state: result.state,
        restartRequired: result.state === "disconnected" && result.restartRequired
          && confirmation === this.confirmationGeneration,
      });
    });
  };

  confirmRestart = async (): Promise<void> => {
    if (!this.snapshot.restartRequired) return;
    const confirmation = this.confirmationGeneration;
    await this.perform("restart", async (generation) => {
      if (confirmation !== this.confirmationGeneration) return;
      const result = await this.dependencies.connect();
      if (!this.isCurrent(generation)) return;
      this.update({ state: result.state, restartRequired: false });
      if (result.state !== "disconnected" || !result.restartRequired
        || confirmation !== this.confirmationGeneration) return;
      await this.dependencies.restart();
      if (!this.isCurrent(generation)) return;
      const status = await this.dependencies.loadStatus();
      if (!this.isCurrent(generation)) return;
      this.applyStatus(status.state);
      if (status.state === "disconnected") this.dependencies.onError("restart");
    });
  };

  cancelRestart = () => {
    this.confirmationGeneration += 1;
    this.update({ restartRequired: false });
  };

  private async perform(
    operation: Exclude<CodexConnectionOperation, null>,
    action: (generation: number) => Promise<void>,
  ): Promise<void> {
    if (!this.active || this.snapshot.operation || this.dependencies.isBlocked()) return;
    const generation = ++this.generation;
    this.update({ operation });
    this.parentOperationGeneration = generation;
    this.dependencies.onOperationChange(operation === "connect" ? "start" : "restart");
    try {
      // Inspect and reconnect share a native guard. Take UI ownership first,
      // then let the previous inspection finish before sending the user action.
      const pendingPoll = this.polling;
      if (pendingPoll) await pendingPoll.catch(() => undefined);
      if (this.isCurrent(generation)) await action(generation);
    } catch {
      if (this.isCurrent(generation)) {
        this.update({ restartRequired: false });
        this.dependencies.onError(operation);
      }
    } finally {
      this.finishOperation(generation);
    }
  }

  private canPoll(): boolean {
    return this.active && !this.polling && this.canPublishPoll();
  }

  private canPublishPoll(): boolean {
    return !this.snapshot.operation && !this.dependencies.isBlocked() && this.dependencies.isVisible();
  }

  private isCurrent(generation: number): boolean {
    return this.active && this.generation === generation;
  }

  private applyStatus(state: CodexConnectionState) {
    this.update({ state, restartRequired: state === "disconnected" && this.snapshot.restartRequired });
  }

  private finishOperation(generation: number) {
    if (this.parentOperationGeneration !== generation) return;
    if (this.active) this.update({ operation: null });
    else this.snapshot = { ...this.snapshot, operation: null };
    // A submitted native action outlives the view; keep other actions blocked until it settles.
    this.parentOperationGeneration = null;
    this.dependencies.onOperationChange(null);
  }

  private update(patch: Partial<CodexConnectionSnapshot>) {
    if (!this.active) return;
    const next = { ...this.snapshot, ...patch };
    if (next.state === this.snapshot.state && next.operation === this.snapshot.operation
      && next.restartRequired === this.snapshot.restartRequired) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}
