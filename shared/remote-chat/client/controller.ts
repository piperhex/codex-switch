import type { ChatConnection, ConnectionEvents } from './connection';
import { applyChatEvent } from './events';
import { mergeHistory } from './history';
import type { ConnectionMode } from '../protocol';
import { initialChatState, type ApprovalReply, type ChatState, type GuiEvent,
  type ListResponse, type Model, type Request, type Thread } from './types';

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
  private readonly previews = new Map<string, Promise<string>>();

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
    this.synchronization += 1;
    this.listGeneration += 1;
    this.readGeneration += 1;
    this.refreshThreadId = null;
    clearTimeout(this.syncTimer);
    this.update({ mode, ready: false, loading: false });
  }

  private receive(event: GuiEvent) {
    this.state = applyChatEvent(this.state, event);
    this.emit();
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

  start() { this.active = true; this.connection.start(); }
  stop() {
    this.active = false;
    clearTimeout(this.syncTimer);
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
      this.update({ approvals, error: '', ready: true });
      await Promise.all([this.list(), this.loadModels(generation), this.refreshSelected()]);
    } catch (error) {
      if (!this.active || generation !== this.synchronization) return;
      this.failure(error);
      this.scheduleSynchronization();
    }
  }

  private async loadModels(generation: number) {
    const result = await this.request<ListResponse<Model>>({ operation: 'models' });
    if (this.active && generation === this.synchronization) this.update({ models: result.data });
  }

  async list(options: { search?: string; archived?: boolean; more?: boolean } = {}) {
    const generation = ++this.listGeneration;
    const search = options.search ?? this.state.search;
    const archived = options.archived ?? this.state.archived;
    const cursor = options.more ? this.state.cursor ?? undefined : undefined;
    this.update({ search, archived, loading: true });
    try {
      const result = await this.request<ListResponse<Thread>>({ operation: 'list', search, archived, cursor });
      if (generation !== this.listGeneration) return;
      const threads = options.more ? [...this.state.threads, ...result.data] : result.data;
      this.update({ threads: [...new Map(threads.map((thread) => [thread.id, thread])).values()],
        cursor: result.nextCursor });
    } catch (error) { if (generation === this.listGeneration) this.failure(error); }
    finally { if (generation === this.listGeneration) this.update({ loading: false }); }
  }

  async select(thread: Thread) {
    this.update({ selected: thread, error: '' });
    await this.refreshSelected();
  }

  async refreshSelected() {
    const selected = this.state.selected;
    if (!selected || this.refreshThreadId === selected.id) return;
    this.refreshThreadId = selected.id;
    const generation = ++this.readGeneration;
    try {
      const result = await this.request<{ thread: Thread }>({ operation: 'read', threadId: selected.id });
      if (generation === this.readGeneration && this.state.selected?.id === selected.id) {
        this.update({ selected: mergeHistory(result.thread, this.state.selected, selected) });
      }
    } catch (error) { if (generation === this.readGeneration) this.failure(error); }
    finally { if (generation === this.readGeneration) this.refreshThreadId = null; }
  }

  back() {
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.update({ selected: null });
    void this.list();
  }

  async send(input: { text: string; model?: string; effort?: string; access: 'read-only' | 'workspace-write' }) {
    if (this.state.sending || !input.text.trim()) return false;
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
        this.update({ selected: thread,
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

  imagePreview = (threadId: string, source: string): Promise<string> => {
    const key = JSON.stringify([threadId, source]);
    const pending = this.previews.get(key);
    if (pending) return pending;
    const request = this.request<{ url: string }>({ operation: 'imagePreview', threadId, source })
      .then(({ url }) => url).finally(() => this.previews.delete(key));
    this.previews.set(key, request);
    return request;
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
    try {
      await this.request({ operation: this.state.archived ? 'unarchive' : 'archive', threadId: thread.id });
      this.back();
    } catch (error) { this.failure(error); }
  }
}
