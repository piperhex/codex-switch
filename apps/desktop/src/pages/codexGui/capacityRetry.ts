import { isModelCapacityError } from "./requestError";
import { SECOND_MS } from "./turnTiming";
import type { GuiEvent, GuiState } from "./types";

export interface CapacityRetryState {
  threadId: string;
  turnId: string;
  seconds: number;
}

interface RetryHost {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  send: () => Promise<boolean>;
}

const FIRST_RETRY_SECONDS = 1;
const RETRY_INCREMENT_SECONDS = 2;

/** Only live terminal failures can start a retry; reading history must never send a message. */
export class CapacityRetry {
  private timer?: ReturnType<typeof setTimeout>;
  private threadId?: string;
  private lastCompleted?: string;
  private attempts = 0;
  private deadline = 0;
  private dispatching = false;
  private enabled = false;
  private generation = 0;

  constructor(private host: RetryHost) {}

  cancel = () => {
    ++this.generation;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.threadId = undefined;
    this.attempts = 0;
    if (this.host.getSnapshot().capacityRetry) this.host.patch({ capacityRetry: undefined });
  };

  setActive(active: boolean) {
    this.enabled = active;
    if (!active) this.cancel();
  }

  stop() {
    const state = this.host.getSnapshot();
    const turnId = state.selected ? state.conversations[state.selected]?.activeTurn : null;
    if (turnId) this.lastCompleted = `${state.selected}:${turnId}`;
    this.cancel();
  }

  /** Cancel a retry still waiting for resume, before it can submit a new turn. */
  sendGuard() {
    const generation = this.generation;
    return this.dispatching ? () => generation === this.generation : () => true;
  }

  sync(previous: GuiState, next: GuiState) {
    if (!this.threadId) return;
    const conversation = next.conversations[this.threadId];
    const manualSend = !previous.sending && next.sending && !this.dispatching;
    const otherTurn = conversation?.activeTurn
      && conversation.activeTurn !== previous.conversations[this.threadId]?.activeTurn && !this.dispatching;
    if (next.selected !== this.threadId || next.connection !== "ready" || next.archived
      || !conversation || next.workspaceBusy || next.deleting || next.compacting === this.threadId
      || next.queued[this.threadId]?.length || manualSend || otherTurn) this.cancel();
  }

  receive(event: GuiEvent) {
    if (event.method !== "turn/completed") return;
    const { threadId, turn: incoming } = event.params;
    const state = this.host.getSnapshot();
    if (!this.enabled || !threadId || !incoming || state.selected !== threadId) return;
    const current = state.conversations[threadId];
    const turn = current?.turns.at(-1);
    const key = `${threadId}:${incoming.id}`;
    if (!turn || turn.status === "inProgress" || turn.id !== incoming.id || key === this.lastCompleted) return;
    this.lastCompleted = key;
    if (turn.status !== "failed" || !isModelCapacityError(turn.error)
      || current.activeTurn || state.connection !== "ready" || state.archived
      || state.workspaceBusy || state.deleting || state.compacting === threadId || state.queued[threadId]?.length) {
      this.cancel();
      return;
    }
    this.threadId = threadId;
    const seconds = FIRST_RETRY_SECONDS + RETRY_INCREMENT_SECONDS * this.attempts++;
    this.deadline = Date.now() + seconds * SECOND_MS;
    this.host.patch({ capacityRetry: { threadId, turnId: turn.id, seconds } });
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(this.tick, SECOND_MS);
  }

  private tick = () => {
    this.timer = undefined;
    const state = this.host.getSnapshot();
    const retry = state.capacityRetry;
    if (!retry || !this.threadId) return;
    const seconds = Math.max(0, Math.ceil((this.deadline - Date.now()) / SECOND_MS));
    if (seconds !== retry.seconds) this.host.patch({ capacityRetry: { ...retry, seconds } });
    // A completion notification can arrive before the preceding send acknowledgement.
    if (seconds || state.sending || state.modelSettingsLoading || this.dispatching) {
      this.schedule();
      return;
    }
    void this.retry();
  };

  private async retry() {
    this.dispatching = true;
    this.host.patch({ capacityRetry: undefined });
    try {
      if (!await this.host.send()) this.cancel();
    } finally { this.dispatching = false; }
  }
}
