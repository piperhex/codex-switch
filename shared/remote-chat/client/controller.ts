import type { ChatConnection, ConnectionEvents } from './connection';
import type { RemoteComposerCatalog } from '../composerCatalog';
import type { ProjectFilesRequest, ProjectFilesResponse } from '../projectFiles';
import { applyChatEvent } from './events';
import { mergeHistory } from './history';
import { HISTORY_CHANGED } from '../historySync';
import type { HistoryPage } from '../historyPage';
import { HistoryReader } from './historyReader';
import { ImageCache } from './imageCache';
import { validateChatImages } from '../attachments';
import { compactUnavailableReason } from './composerCommands';
import type { ConnectionMode } from '../protocol';
import { COMPOSER_EVENT, composerPatch, type ComposerModelsResponse,
  type ComposerSettings, type ComposerSnapshot } from '../composer';
import { resolveModelSelection } from '../../../apps/desktop/src/pages/codexGui/modelSelection';
import { SIDEBAR_EVENT, type SidebarSnapshot } from '../sidebar';
import { emptyQueue, QUEUE_EVENT, type QueueAction, type QueueSnapshot } from '../queue';
import { QueueConnection } from './queueConnection';
import { initialChatState, type ApprovalReply, type ChatProject, type ChatState, type GuiEvent,
  type ListResponse, type Request, type SendInput, type SkillsResponse, type Thread } from './types';

const SYNCHRONIZATION_RETRY_MS = 3000;

export class ChatController {
  private state = initialChatState();
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: GuiEvent) => void>();
  private readonly connection: Pick<ChatConnection, 'request' | 'start' | 'stop'>;
  private readonly queueConnection = new QueueConnection((body) => this.connection.request('request', body));
  private listGeneration = 0;
  private readGeneration = 0;
  private refreshThreadId: string | null = null;
  private synchronization = 0;
  private skillGeneration = 0;
  private active = false;
  private syncTimer?: ReturnType<typeof setTimeout>;
  private readonly images = new ImageCache(<T>(body: Parameters<ConstructorParameters<typeof ImageCache>[0]>[0]) =>
    this.connection.request<T>('request', body));
  private readonly histories = new Map<string, Thread>();
  private readonly historyReader = new HistoryReader((body) => this.connection.request('request', body));
  private readonly historyPages = new Map<string, HistoryPage>();
  private historyTimer?: ReturnType<typeof setTimeout>;
  private historyDirty = false;
  private olderQueued = false;
  private composerRevision = -1;
  private remoteSettings = this.state.settings;
  private pendingSettings: Partial<ComposerSettings> = {};
  private savingSettings = false;
  private viewing = true;
  private loadedThreadId: string | null = null;
  private readonly reading = new Set<string>();

  constructor(createConnection: (events: ConnectionEvents) => Pick<ChatConnection, 'request' | 'start' | 'stop'>) {
    this.connection = createConnection({
      mode: (mode) => this.changeMode(mode), error: (error) => this.update({ error }),
      ready: () => { void this.synchronize(); },
      event: (event) => this.receive(event as GuiEvent),
    });
  }

  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  subscribeEvents = (listener: (event: GuiEvent) => void) => {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  };
  private emit() { for (const listener of this.listeners) listener(); }
  private update(patch: Partial<ChatState>) { this.state = { ...this.state, ...patch }; this.emit(); }
  private request<T>(body: Request) { return this.connection.request<T>('request', body); }
  private failure(error: unknown) {
    this.update({ error: error instanceof Error ? error.message : '操作未完成，请稍后重试。' });
  }

  private changeMode(mode: ConnectionMode) {
    this.historyReader.reset();
    this.queueConnection.reset();
    if (mode === 'offline') {
      this.skillGeneration += 1;
      this.composerRevision = -1;
      this.update({ sidebar: { ...this.state.sidebar, revision: -1 } });
      this.update({ queue: { ...this.state.queue, revision: -1 } });
    }
    this.synchronization += 1;
    this.listGeneration += 1;
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.olderQueued = false;
    clearTimeout(this.syncTimer);
    clearTimeout(this.historyTimer);
    this.historyTimer = undefined;
    this.update({ mode, ready: false, loading: false, historyLoading: false, historyLoadingMore: false,
      compacting: undefined });
  }

  private receive(event: GuiEvent) {
    if (!event?.params || typeof event.method !== 'string') return;
    for (const listener of this.eventListeners) listener(event);
    if (event?.method === HISTORY_CHANGED) {
      if (event.params.threadId === this.state.selected?.id) this.scheduleHistory();
      if (event.params.reason?.startsWith('thread/')
        || !this.state.threads.some((thread) => thread.id === event.params.threadId)) void this.list();
      return;
    }
    if (event?.method === COMPOSER_EVENT) { this.applyComposer(event.params as unknown as ComposerSnapshot); return; }
    if (event?.method === SIDEBAR_EVENT) { this.applySidebar(event.params as unknown as SidebarSnapshot); return; }
    if (event?.method === QUEUE_EVENT) { this.applyQueue(event.params as unknown as QueueSnapshot); return; }
    this.state = applyChatEvent(this.state, event);
    this.emit();
    this.markViewed();
    if (event?.method === 'turn/completed' && event.params.threadId === this.state.selected?.id) {
      this.scheduleHistory();
    }
    if (['thread/name/updated', 'thread/archived', 'thread/unarchived', 'thread/deleted'].includes(event?.method)) {
      void this.list();
      if (event.params.threadId === this.state.selected?.id) this.scheduleHistory();
    }
    if (event?.method === 'connection/closed' || event?.method === 'codex/disconnected') {
      this.skillGeneration += 1;
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
    this.skillGeneration += 1;
    this.historyReader.reset();
    this.queueConnection.reset();
    this.olderQueued = false;
    clearTimeout(this.syncTimer);
    clearTimeout(this.historyTimer);
    this.historyTimer = undefined;
    this.synchronization += 1;
    this.listGeneration += 1;
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.update({ ready: false, historyLoading: false, historyLoadingMore: false, compacting: undefined });
    this.connection.stop();
  }

  private async synchronize() {
    clearTimeout(this.syncTimer);
    const generation = ++this.synchronization;
    try {
      const approvals = await this.connection.request<GuiEvent[]>('connect');
      if (!this.active || generation !== this.synchronization) return;
      this.update({ approvals, error: '' });
      await Promise.all([this.list(), this.loadModels(generation), this.refreshSelected(), this.loadQueue(generation)]);
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

  private applyQueue(queue: QueueSnapshot) {
    if (!queue || !Number.isSafeInteger(queue.revision) || queue.revision < this.state.queue.revision
      || !queue.threads) return;
    this.update({ queue });
  }

  private async loadQueue(generation: number) {
    const queue = await this.queueConnection.read();
    if (generation !== this.synchronization) return;
    if (queue) this.applyQueue(queue);
    else this.update({ queue: emptyQueue() });
  }

  async queueAction(operation: QueueAction, id?: string) {
    const threadId = this.state.selected?.id;
    if (!threadId || !this.state.ready || this.state.queueBusy) return;
    const generation = this.synchronization;
    this.update({ queueBusy: true, error: '' });
    try {
      const queue = await this.connection.request<QueueSnapshot>('request', { operation, threadId, id });
      if (generation === this.synchronization) this.applyQueue(queue);
      await this.refreshSelected();
    } catch (error) { this.failure(error); }
    finally { this.update({ queueBusy: false }); }
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
    this.olderQueued = false;
    this.loadedThreadId = null;
    this.update({ selected: this.histories.get(thread.id) ?? thread, draftProject: null,
      selectedArchived: this.state.archived, error: '',
      historyHasMore: this.historyPages.get(thread.id)?.hasMore ?? false });
    await this.refreshSelected();
  }

  async loadOlder() {
    if (!this.state.historyHasMore || !this.state.ready) return;
    if (this.refreshThreadId === this.state.selected?.id) {
      if (!this.state.historyLoadingMore) {
        this.olderQueued = true;
        this.update({ historyLoadingMore: true });
      }
      return;
    }
    await this.refreshSelected(true);
  }

  async refreshSelected(older = false) {
    const selected = this.state.selected;
    if (!selected || this.refreshThreadId === selected.id) return;
    this.refreshThreadId = selected.id;
    this.historyDirty = false;
    const generation = ++this.readGeneration;
    this.update({ historyLoading: true, historyLoadingMore: older });
    try {
      const result = await this.historyReader.read(selected,
        { start: this.historyPages.get(selected.id)?.start, older });
      if (generation === this.readGeneration && this.state.selected?.id === selected.id) {
        this.loadedThreadId = selected.id;
        if (result.page) this.historyPages.set(selected.id, result.page);
        this.update({ selected: mergeHistory(result.thread, this.state.selected, selected), error: '',
          historyHasMore: result.page.hasMore });
        this.rememberHistory();
        this.markViewed();
      }
    } catch (error) { if (generation === this.readGeneration) this.failure(error); }
    finally {
      if (generation === this.readGeneration) {
        this.refreshThreadId = null;
        const olderQueued = this.olderQueued;
        this.olderQueued = false;
        this.update({ historyLoading: false, historyLoadingMore: false });
        if (olderQueued) void this.loadOlder();
        else if (this.historyDirty) this.scheduleHistory();
      }
    }
  }

  private rememberHistory() {
    const thread = this.state.selected;
    if (!thread) return;
    this.histories.delete(thread.id);
    this.histories.set(thread.id, thread);
    if (this.histories.size > 8) {
      const oldest = this.histories.keys().next().value!;
      this.histories.delete(oldest);
      this.historyPages.delete(oldest);
    }
  }

  back(project: ChatProject | null = null) {
    if (this.state.sending) return;
    this.rememberHistory();
    this.olderQueued = false;
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.loadedThreadId = null;
    this.update({ selected: null, draftProject: project ? { cwd: project.cwd, label: project.label } : null,
      selectedArchived: false, error: '', historyHasMore: false, historyLoading: false, historyLoadingMore: false });
    void this.list();
  }

  async send(input: SendInput) {
    const images = input.images ?? [];
    if (this.state.selectedArchived) { this.update({ error: '请先恢复聊天，再发送消息。' }); return false; }
    if (this.state.sending || this.state.settingsBusy || (this.state.compacting
      && this.state.compacting === this.state.selected?.id)
      || (!input.text.trim() && !images.length && !input.skills?.length && !input.attachments?.length)) return false;
    try { validateChatImages(images); }
    catch (error) { this.failure(error); return false; }
    if (!this.state.ready) { this.update({ error: '正在连接电脑，请稍候再发送。' }); return false; }
    const generation = this.synchronization;
    this.update({ sending: true, error: '' });
    try {
      let thread = this.state.selected;
      const created = !thread;
      if (!thread) {
        const result = await this.request<{ thread: Thread }>({ operation: 'start', model: input.model,
          access: input.access, cwd: this.state.draftProject?.cwd });
        thread = result.thread;
        this.update({ selected: thread, draftProject: null, selectedArchived: false,
          threads: [thread, ...this.state.threads.filter((entry) => entry.id !== result.thread.id)],
          archived: false, search: '', cursor: null });
      }
      this.ensureCurrent(generation);
      if (!created) {
        const queue = await this.queueConnection.enqueue(thread, { ...input, images });
        if (queue && generation === this.synchronization) this.applyQueue(queue);
      } else {
        await this.request({ operation: 'send', threadId: thread.id, ...input, images });
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

  loadSkills = async (cwd: string) => {
    const generation = this.skillGeneration;
    const result = await this.request<SkillsResponse>({ operation: 'skills', cwd: cwd || undefined });
    // Switching between relay and direct transport still returns the same computer's catalog.
    if (!this.active || generation !== this.skillGeneration) throw new Error('连接已中断，请重新打开技能菜单。');
    return result;
  };

  loadComposerCatalog = async (cwd: string) => {
    const generation = this.skillGeneration;
    const result = await this.connection.request<RemoteComposerCatalog>('request', {
      operation: 'skills', cwd: cwd || undefined, includePlugins: true,
    });
    if (!this.active || generation !== this.skillGeneration) throw new Error('请连接电脑后重新打开插件。');
    return result;
  };

  loadProjectFiles = (options: ProjectFilesRequest) =>
    this.connection.request<ProjectFilesResponse>('request', { operation: 'projectFiles', ...options });

  compact = async () => {
    const selected = this.state.selected;
    if (!selected || compactUnavailableReason(this.state)) return false;
    const threadId = selected.id;
    const generation = this.synchronization;
    this.update({ compacting: threadId, error: '' });
    try {
      await this.request({ operation: 'resume', threadId,
        access: this.state.settings.access });
      this.ensureCurrent(generation);
      const { thread } = await this.historyReader.read(selected, {});
      this.ensureCurrent(generation);
      if (this.state.selected?.id !== threadId || thread.turns?.some((turn) => turn.status === 'inProgress')
        || this.state.selected.turns?.some((turn) => turn.status === 'inProgress')
        || this.state.approvals.some((event) => event.params.threadId === threadId)) {
        this.update({ compacting: undefined });
        return false;
      }
      await this.request({ operation: 'compact', threadId });
      // The acknowledgement precedes completion; lifecycle events release the guard.
      return true;
    } catch (error) {
      if (generation === this.synchronization) {
        this.update({ compacting: undefined });
        this.failure(error);
      }
      return false;
    }
  };

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
    if (this.state.queue.threads[thread.id]?.length) {
      this.update({ error: '请先处理待发送消息，再归档聊天。' }); return;
    }
    try {
      await this.request({ operation: this.state.selectedArchived ? 'unarchive' : 'archive', threadId: thread.id });
      this.back();
    } catch (error) { this.failure(error); }
  }
}
