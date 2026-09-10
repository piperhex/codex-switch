import type { ChatConnection, ConnectionEvents } from './connection';
import { applyChatEvent } from './events';
import { mergeHistory } from './history';
import { HISTORY_CHANGED, historyVersion, applyHistoryDelta, type HistoryDelta } from '../historySync';
import { ImageCache } from './imageCache';
import type { ConnectionMode } from '../protocol';
import { COMPOSER_EVENT, composerPatch, type ComposerModelsResponse,
  type ComposerSettings, type ComposerSnapshot } from '../composer';
import { resolveModelSelection } from '../../../apps/desktop/src/pages/codexGui/modelSelection';
import { SIDEBAR_EVENT, type SidebarSnapshot } from '../sidebar';
import { initialChatState, type ApprovalReply, type ChatState, type GuiEvent,
  type ListResponse, type Request, type Thread } from './types';

const SYNCHRONIZATION_RETRY_MS = 3000;

export class ChatController {
  private state = initialChatState();
  private readonly listeners = new Set<() => void>();
  private readonly connection: ChatConnection;
  private listGeneration = 0;
  private readGeneration = 0;
  private refreshThreadId: string | null = null;
  private synchronization = 0;
  private active = false;
  private syncTimer?: ReturnType<typeof setTimeout>;
  private readonly images = new ImageCache(<T>(body: Parameters<ConstructorParameters<typeof ImageCache>[0]>[0]) =>
    this.connection.request<T>('request', body));
  private readonly histories = new Map<string, Thread>();
  private historyTimer?: ReturnType<typeof setTimeout>;
  private historyDirty = false;
  private composerRevision = -1;
  private remoteSettings = this.state.settings;
  private pendingSettings: Partial<ComposerSettings> = {};
  private savingSettings = false;
  private viewing = true;
  private loadedThreadId: string | null = null;
  private readonly reading = new Set<string>();

  constructor(createConnection: (events: ConnectionEvents) => ChatConnection) {
    this.connection = createConnection({
      mode: (mode) => this.changeMode(mode), error: (error) => this.update({ error }),
      ready: () => { void this.synchronize(); },
      event: (event) => this.receive(event as GuiEvent),
    });
  }

  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit() { for (const listener of this.listeners) listener(); }
  private update(patch: Partial<ChatState>) { this.state = { ...this.state, ...patch }; this.emit(); }
  private request<T>(body: Request) { return this.connection.request<T>('request', body); }
  private failure(error: unknown) {
    this.update({ error: error instanceof Error ? error.message : '操作未完成，请稍后重试。' });
  }

  private changeMode(mode: ConnectionMode) {
    if (mode === 'offline') {
      this.composerRevision = -1;
      this.update({ sidebar: { ...this.state.sidebar, revision: -1 } });
    }
    this.synchronization += 1;
    this.listGeneration += 1;
    this.readGeneration += 1;
    this.refreshThreadId = null;
    clearTimeout(this.syncTimer);
    clearTimeout(this.historyTimer);
    this.historyTimer = undefined;
    this.update({ mode, ready: false, loading: false });
  }

  private receive(event: GuiEvent) {
    if (event?.method === HISTORY_CHANGED) {
      if (event.params.threadId === this.state.selected?.id) this.scheduleHistory();
      if (event.params.reason?.startsWith('thread/')
        || !this.state.threads.some((thread) => thread.id === event.params.threadId)) void this.list();
      return;
    }
    if (event?.method === COMPOSER_EVENT) { this.applyComposer(event.params as unknown as ComposerSnapshot); return; }
    if (event?.method === SIDEBAR_EVENT) { this.applySidebar(event.params as unknown as SidebarSnapshot); return; }
    this.state = applyChatEvent(this.state, event);
    this.emit();
    this.markViewed();
    if (['thread/name/updated', 'thread/archived', 'thread/unarchived', 'thread/deleted'].includes(event?.method)) {
      void this.list();
    }
    if (event?.method === 'connection/closed' || event?.method === 'codex/disconnected') {
      this.update({ ready: false });
      this.scheduleSynchronization();
    }
  }

  private scheduleSynchronization() {
    clearTimeout(this.syncTimer);
    if (!this.active || !['direct', 'relay'].includes(this.state.mode)) return;
    this.syncTimer = setTimeout(() => { void this.synchronize(); }, SYNCHRONIZATION_RETRY_MS);
  }

  private scheduleHistory() {
    this.historyDirty = true;
    if (this.historyTimer || this.refreshThreadId || !this.active) return;
    this.historyTimer = setTimeout(() => {
      this.historyTimer = undefined;
      void this.refreshSelected();
    }, 100);
  }

  start() { this.active = true; this.connection.start(); }
  stop() {
    this.active = false;
    clearTimeout(this.syncTimer);
    clearTimeout(this.historyTimer);
    this.historyTimer = undefined;
    this.synchronization += 1;
    this.listGeneration += 1;
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.update({ ready: false });
    this.connection.stop();
  }

  private async synchronize() {
    clearTimeout(this.syncTimer);
    const generation = ++this.synchronization;
    try {
      const approvals = await this.connection.request<GuiEvent[]>('connect');
      if (!this.active || generation !== this.synchronization) return;
      this.update({ approvals, error: '' });
      await Promise.all([this.list(), this.loadModels(generation), this.refreshSelected()]);
      if (this.active && generation === this.synchronization) {
        this.update({ ready: true });
        void this.flushSettings();
      }
    } catch (error) {
      if (!this.active || generation !== this.synchronization) return;
      this.failure(error);
      this.scheduleSynchronization();
    }
  }

  private async loadModels(generation: number) {
    const result = await this.request<ComposerModelsResponse>({ operation: 'models' });
    if (!this.active || generation !== this.synchronization) return;
    if (result.composer) this.applyComposer(result.composer);
    else {
      const model = result.data.find((entry) => entry.isDefault) ?? result.data[0];
      this.update({ models: result.data, settings: { ...this.state.settings,
        model: model?.model ?? '', effort: model?.defaultReasoningEffort ?? '', ...this.pendingSettings } });
    }
  }

  private applyComposer(snapshot: ComposerSnapshot) {
    if (!snapshot || !Array.isArray(snapshot.models) || !snapshot.settings
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < this.composerRevision) return;
    this.composerRevision = snapshot.revision;
    this.remoteSettings = snapshot.settings;
    this.update({ models: snapshot.models, settings: { ...snapshot.settings, ...this.pendingSettings } });
  }

  private applySidebar(sidebar?: SidebarSnapshot) {
    if (!sidebar || !Number.isSafeInteger(sidebar.revision) || sidebar.revision < this.state.sidebar.revision
      || !sidebar.threads || !sidebar.readState) return;
    this.update({ sidebar });
    this.markViewed();
  }

  setViewing(viewing: boolean) { this.viewing = viewing; this.markViewed(); }

  private markViewed() {
    const thread = this.state.selected;
    if (!this.active || !this.viewing || !thread || this.loadedThreadId !== thread.id) return;
    const receipt = this.state.sidebar.readState[thread.id];
    if (!receipt?.unread) return;
    const seen = thread.turns?.some((turn) => turn.id === receipt.turnId && turn.status !== 'inProgress')
      || (receipt.turnId.startsWith('refresh:') && thread.updatedAt >= Number(receipt.turnId.slice(8)));
    const key = JSON.stringify([thread.id, receipt.turnId]);
    if (!seen || this.reading.has(key)) return;
    this.reading.add(key);
    const generation = this.synchronization;
    void this.connection.request<SidebarSnapshot>('request', {
      operation: 'threadRead', threadId: thread.id, turnId: receipt.turnId,
    }).then((sidebar) => {
      if (generation === this.synchronization) this.applySidebar(sidebar);
    }).catch(() => { /* Reconnection or the next history refresh retries this read receipt. */ })
      .finally(() => { this.reading.delete(key); });
  }

  async setSettings(settings: Partial<ComposerSettings>) {
    const patch = composerPatch(settings);
    if (!Object.keys(patch).length) return;
    if (patch.model && patch.model !== this.state.settings.model) {
      const selection = resolveModelSelection(this.state.models, { model: patch.model, effort: patch.effort ?? '' });
      patch.effort = selection.effort;
    }
    this.pendingSettings = { ...this.pendingSettings, ...patch };
    this.update({ settings: { ...this.state.settings, ...patch }, settingsBusy: true, settingsError: '' });
    // Editing remains available during reconnects and while the PC acknowledges an earlier choice.
    void this.flushSettings();
  }

  private async flushSettings() {
    if (!this.active || !this.state.ready || this.savingSettings || !Object.keys(this.pendingSettings).length) return;
    this.savingSettings = true;
    const settings = { ...this.pendingSettings };
    const generation = this.synchronization;
    let accepted = false;
    try {
      const result = await this.connection.request<ComposerSnapshot>('request', { operation: 'composerSet', settings });
      if (generation !== this.synchronization) return;
      if (!result?.settings || !Number.isSafeInteger(result.revision)) throw new Error('电脑尚未确认设置，请重试。');
      for (const field of ['model', 'effort', 'access'] as const) {
        if (settings[field] !== undefined && this.pendingSettings[field] === settings[field]) {
          delete this.pendingSettings[field];
        }
      }
      if (result.revision < this.composerRevision) {
        this.update({ settings: { ...this.remoteSettings, ...this.pendingSettings } });
      } else this.applyComposer(result);
      this.update({ settingsBusy: Object.keys(this.pendingSettings).length > 0, settingsError: '' });
      accepted = true;
    } catch (error) {
      if (generation === this.synchronization) this.update({ settingsError: error instanceof Error
        ? error.message : '设置尚未保存，请重试。' });
    } finally {
      this.savingSettings = false;
      if (accepted || generation !== this.synchronization) void this.flushSettings();
    }
  }

  async list(options: { search?: string; archived?: boolean; more?: boolean } = {}) {
    const generation = ++this.listGeneration;
    const search = options.search ?? this.state.search;
    const archived = options.archived ?? this.state.archived;
    const cursor = options.more ? this.state.cursor ?? undefined : undefined;
    this.update({ search, archived, loading: true });
    try {
      const result = await this.request<ListResponse<Thread> & { sidebar?: SidebarSnapshot }>({
        operation: 'list', search, archived, cursor,
      });
      if (generation !== this.listGeneration) return;
      this.applySidebar(result.sidebar);
      const threads = options.more ? [...this.state.threads, ...result.data] : result.data;
      this.update({ threads: [...new Map(threads.map((thread) => [thread.id, thread])).values()],
        cursor: result.nextCursor });
    } catch (error) { if (generation === this.listGeneration) this.failure(error); }
    finally { if (generation === this.listGeneration) this.update({ loading: false }); }
  }

  async select(thread: Thread) {
    this.rememberHistory();
    this.loadedThreadId = null;
    this.update({ selected: this.histories.get(thread.id) ?? thread,
      selectedArchived: this.state.archived, error: '' });
    await this.refreshSelected();
  }

  async refreshSelected() {
    const selected = this.state.selected;
    if (!selected || this.refreshThreadId === selected.id) return;
    this.refreshThreadId = selected.id;
    this.historyDirty = false;
    const generation = ++this.readGeneration;
    try {
      const result = await this.connection.request<HistoryDelta>('request', {
        operation: 'syncHistory', threadId: selected.id, known: historyVersion(selected),
      });
      if (generation === this.readGeneration && this.state.selected?.id === selected.id) {
        this.loadedThreadId = selected.id;
        this.update({ selected: mergeHistory(applyHistoryDelta(selected, result), this.state.selected, selected) });
        this.rememberHistory();
        this.markViewed();
      }
    } catch (error) { if (generation === this.readGeneration) this.failure(error); }
    finally {
      if (generation === this.readGeneration) {
        this.refreshThreadId = null;
        if (this.historyDirty) this.scheduleHistory();
      }
    }
  }

  private rememberHistory() {
    const thread = this.state.selected;
    if (!thread) return;
    this.histories.delete(thread.id);
    this.histories.set(thread.id, thread);
    if (this.histories.size > 8) this.histories.delete(this.histories.keys().next().value!);
  }

  back() {
    this.rememberHistory();
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.loadedThreadId = null;
    this.update({ selected: null, error: '' });
    void this.list();
  }

  async send(input: { text: string; model?: string; effort?: string; access: ComposerSettings['access'] }) {
    if (this.state.sending || this.state.settingsBusy || !input.text.trim()) return false;
    if (!this.state.ready) { this.update({ error: '正在连接电脑，请稍候再发送。' }); return false; }
    const generation = this.synchronization;
    this.update({ sending: true, error: '' });
    try {
      let thread = this.state.selected;
      const created = !thread;
      if (!thread) {
        const result = await this.request<{ thread: Thread }>({ operation: 'start', model: input.model,
          access: input.access });
        thread = result.thread;
        this.update({ selected: thread, selectedArchived: false,
          threads: [thread, ...this.state.threads.filter((entry) => entry.id !== result.thread.id)],
          archived: false, search: '', cursor: null });
      }
      this.ensureCurrent(generation);
      const running = this.state.selected?.turns?.find((turn) => turn.status === 'inProgress');
      if (running) {
        await this.request({ operation: 'steer', threadId: thread.id, turnId: running.id,
          text: input.text, images: [], skills: [] });
      } else {
        // A new thread is already loaded and may not have a persisted rollout until its first turn.
        if (!created) await this.request({ operation: 'resume', threadId: thread.id, access: input.access });
        this.ensureCurrent(generation);
        await this.request({ operation: 'send', threadId: thread.id, ...input, images: [] });
      }
      await this.refreshSelected();
      return true;
    } catch (error) { this.failure(error); return false; }
    finally { this.update({ sending: false }); }
  }

  private ensureCurrent(generation: number) {
    if (generation !== this.synchronization || !this.state.ready) throw new Error('连接已中断，请连接后再发送。');
  }

  imagePreview = (threadId: string, source: string, original = false) => this.images.load(threadId, source, original);

  async interrupt() {
    const thread = this.state.selected;
    const turn = thread?.turns?.find((entry) => entry.status === 'inProgress');
    if (!thread || !turn) return;
    try { await this.request({ operation: 'interrupt', threadId: thread.id, turnId: turn.id }); }
    catch (error) { this.failure(error); }
  }

  async respond(reply: ApprovalReply) {
    try {
      await this.connection.request('respond', reply);
      this.update({ approvals: this.state.approvals.filter((event) => event.id !== reply.id) });
    } catch (error) { this.failure(error); }
  }

  async archive() {
    const thread = this.state.selected;
    if (!thread) return;
    try {
      await this.request({ operation: this.state.selectedArchived ? 'unarchive' : 'archive', threadId: thread.id });
      this.back();
    } catch (error) { this.failure(error); }
  }
}
