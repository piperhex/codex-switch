import { resolveModelSelection, type ModelSelection } from "./modelSelection";
import type { GuiState } from "./types";

export interface ModelSettingsSnapshot {
  threadId: string | null;
  selection: ModelSelection | null;
  revision: number;
}
export interface ModelSettingsApi {
  read: (threadId: string | null) => Promise<ModelSettingsSnapshot>;
  write: (threadId: string | null, selection: ModelSelection) => Promise<ModelSettingsSnapshot>;
  subscribe: (receive: (snapshot: ModelSettingsSnapshot) => void) => Promise<() => void>;
}
interface Host {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  updateQueue: (threadId: string, selection: ModelSelection) => void;
  report: (error: unknown) => void;
}
const EMPTY_SELECTION: ModelSelection = { model: "", effort: "" };
const SYNC_ERROR = "模型设置暂未同步，请重新连接后重试。";

/** Keeps independent choices, serializes slider saves, and rejects stale reads and events. */
export class ThreadModelSettings {
  private api?: ModelSettingsApi;
  private generation = 0;
  private subscription?: Promise<void>;
  private stopSubscription?: () => void;
  private entries = new Map<string | null, ModelSettingsSnapshot>();
  private edits = new Map<string | null, number>();
  private reading = new Map<string | null, Promise<void>>();
  private writing = new Map<string | null, Promise<void>>();
  private dirty = new Map<string | null, ModelSelection>();
  private deferred = new Map<string | null, ModelSettingsSnapshot>();
  private failed = new Set<string | null>();
  constructor(private host: Host) {}

  selection(threadId: string | null): ModelSelection {
    const selection = this.entries.get(threadId)?.selection ?? EMPTY_SELECTION;
    const models = this.host.getSnapshot().models;
    return models.length ? resolveModelSelection(models, selection) : selection;
  }

  private show(threadId = this.host.getSnapshot().selected, updateQueue = false) {
    const selection = this.selection(threadId);
    const state = this.host.getSnapshot();
    if (state.selected === threadId) this.host.patch({ settings: { ...state.settings, ...selection },
      modelSettingsLoading: Boolean(this.api && !this.stopSubscription)
        || this.reading.has(threadId) || this.writing.has(threadId) || this.dirty.has(threadId)
        || this.failed.has(threadId) });
    if (threadId && updateQueue) this.host.updateQueue(threadId, selection);
  }

  catalogChanged() { this.show(undefined, true); }

  change(patch: Partial<ModelSelection>, threadId = this.host.getSnapshot().selected) {
    const previous = this.selection(threadId);
    const selection = { ...previous, ...patch };
    if (patch.model && patch.model !== previous.model && patch.effort === undefined) selection.effort = "";
    const models = this.host.getSnapshot().models;
    const normalized = models.length ? resolveModelSelection(models, selection) : selection;
    this.entries.set(threadId, { threadId, selection: normalized,
      revision: this.entries.get(threadId)?.revision ?? 0 });
    this.edits.set(threadId, (this.edits.get(threadId) ?? 0) + 1);
    this.failed.delete(threadId);
    if (this.api) { this.dirty.set(threadId, normalized); this.save(threadId); }
    this.show(threadId, true);
  }

  /** A newly allocated thread keeps the draft's latest choice, separate from future drafts. */
  created(threadId: string) { this.change(this.selection(null), threadId); }

  select(threadId: string | null): Promise<void> {
    const pending = this.load(threadId);
    this.show(threadId);
    return pending;
  }

  private receive = (snapshot: ModelSettingsSnapshot) => {
    const { threadId } = snapshot;
    if (this.writing.has(threadId) || this.dirty.has(threadId)) {
      if (snapshot.revision > (this.deferred.get(threadId)?.revision ?? -1)) this.deferred.set(threadId, snapshot);
      return;
    }
    if (snapshot.revision < (this.entries.get(threadId)?.revision ?? -1)) return;
    this.entries.set(threadId, snapshot);
    this.failed.delete(threadId);
    this.show(threadId, true);
  };

  private load(threadId: string | null): Promise<void> {
    if (!this.api) return Promise.resolve();
    const pending = this.reading.get(threadId);
    if (pending) return pending;
    const generation = this.generation;
    const edit = this.edits.get(threadId);
    const revision = this.entries.get(threadId)?.revision;
    const reading = this.api.read(threadId).then((snapshot) => {
      if (generation === this.generation && edit === this.edits.get(threadId)) this.receive(snapshot);
    }).catch(() => {
      if (generation !== this.generation || edit !== this.edits.get(threadId)
        || revision !== this.entries.get(threadId)?.revision) return;
      this.failed.add(threadId); this.host.report(SYNC_ERROR);
    }).finally(() => {
      if (this.reading.get(threadId) !== reading) return;
      this.reading.delete(threadId); this.show(threadId);
    });
    this.reading.set(threadId, reading);
    this.show(threadId);
    return reading;
  }

  private save(threadId: string | null) {
    if (!this.api || this.writing.has(threadId)) return;
    const api = this.api;
    const generation = this.generation;
    const writing = this.saveChanges(api, threadId).catch(() => {
      if (generation !== this.generation) return;
      this.failed.add(threadId); this.host.report(SYNC_ERROR);
    }).finally(() => {
      if (this.writing.get(threadId) !== writing) return;
      this.writing.delete(threadId);
      if (this.dirty.has(threadId) && !this.failed.has(threadId)) this.save(threadId);
      const deferred = this.deferred.get(threadId);
      this.deferred.delete(threadId);
      if (deferred && !this.failed.has(threadId)) this.receive(deferred);
      this.show(threadId);
    });
    this.writing.set(threadId, writing);
  }

  private async saveChanges(api: ModelSettingsApi, threadId: string | null) {
    while (this.dirty.has(threadId)) {
      const selection = this.dirty.get(threadId)!;
      this.dirty.delete(threadId);
      try {
        const snapshot = await api.write(threadId, selection);
        if (!this.dirty.has(threadId)) this.entries.set(threadId, snapshot);
      } catch (error) {
        if (!this.dirty.has(threadId)) this.dirty.set(threadId, selection);
        throw error;
      }
    }
  }

  async refresh() {
    if (!this.api) return;
    const generation = this.generation;
    try { await this.subscribe(); }
    catch { if (generation === this.generation) { this.host.report(SYNC_ERROR); this.show(); } return; }
    if (generation !== this.generation) return;
    const state = this.host.getSnapshot();
    const scopes = new Set([null, state.selected, ...Object.keys(state.queued)]);
    for (const id of scopes) {
      if (this.dirty.has(id)) { this.failed.delete(id); this.save(id); }
    }
    await Promise.all([...scopes].map((id) => this.load(id)));
  }

  private subscribe(): Promise<void> {
    if (!this.api || this.stopSubscription) return Promise.resolve();
    if (this.subscription) return this.subscription;
    const generation = this.generation;
    const subscription = this.api.subscribe((snapshot) => {
      if (generation === this.generation) this.receive(snapshot);
    }).then((unsubscribe) => {
      if (generation !== this.generation) { unsubscribe(); return; }
      this.stopSubscription = unsubscribe;
    }).finally(() => {
      if (this.subscription === subscription) this.subscription = undefined;
    });
    this.subscription = subscription;
    return subscription;
  }

  start(api: ModelSettingsApi) {
    this.api = api;
    const generation = ++this.generation;
    this.show();
    void this.refresh();
    return () => {
      if (generation !== this.generation) return;
      ++this.generation; this.stopSubscription?.(); this.stopSubscription = undefined;
      this.subscription = undefined; this.api = undefined; this.reading.clear();
    };
  }
}
