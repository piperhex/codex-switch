import type { ChatConnection, ConnectionEvents } from './connection';
import { applyChatEvent } from './events';
import { mergeHistory } from './history';
import { initialChatState, type ApprovalReply, type ChatState, type GuiEvent,
  type ListResponse, type Model, type Request, type Thread } from './types';

export class ChatController {
  private state = initialChatState();
  private readonly listeners = new Set<() => void>();
  private readonly connection: ChatConnection;
  private listGeneration = 0;
  private readGeneration = 0;
  private refreshThreadId: string | null = null;
  private synchronization = 0;
  private active = false;

  constructor(createConnection: (events: ConnectionEvents) => ChatConnection) {
    this.connection = createConnection({
      mode: (mode) => this.update({ mode }), error: (error) => this.update({ error }),
      ready: () => { void this.synchronize(); },
      event: (event) => { this.state = applyChatEvent(this.state, event as GuiEvent); this.emit(); },
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

  start() { this.active = true; this.connection.start(); }
  stop() {
    this.active = false;
    this.synchronization += 1;
    this.listGeneration += 1;
    this.readGeneration += 1;
    this.connection.stop();
  }

  private async synchronize() {
    const generation = ++this.synchronization;
    try {
      const approvals = await this.connection.request<GuiEvent[]>('connect');
      if (!this.active || generation !== this.synchronization) return;
      this.update({ approvals, error: '' });
      await Promise.all([this.list(), this.loadModels(), this.refreshSelected()]);
    } catch (error) { if (this.active) this.failure(error); }
  }

  private async loadModels() {
    const result = await this.request<ListResponse<Model>>({ operation: 'models' });
    this.update({ models: result.data });
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
    finally { if (this.refreshThreadId === selected.id) this.refreshThreadId = null; }
  }

  back() { this.readGeneration += 1; this.update({ selected: null }); void this.list(); }

  async send(input: { text: string; model?: string; effort?: string; access: 'read-only' | 'workspace-write' }) {
    if (this.state.sending || !input.text.trim()) return false;
    this.update({ sending: true, error: '' });
    try {
      let thread = this.state.selected;
      if (!thread) {
        const result = await this.request<{ thread: Thread }>({ operation: 'start', model: input.model,
          access: input.access });
        thread = result.thread;
        this.update({ selected: thread, threads: [thread, ...this.state.threads],
          archived: false, search: '', cursor: null });
      }
      const running = thread.turns?.find((turn) => turn.status === 'inProgress');
      if (running) {
        await this.request({ operation: 'steer', threadId: thread.id, turnId: running.id,
          text: input.text, images: [], skills: [] });
      } else {
        await this.request({ operation: 'resume', threadId: thread.id, access: input.access });
        await this.request({ operation: 'send', threadId: thread.id, ...input, images: [] });
      }
      await this.refreshSelected();
      return true;
    } catch (error) { this.failure(error); return false; }
    finally { this.update({ sending: false }); }
  }

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
