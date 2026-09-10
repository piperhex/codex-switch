import { guiApi } from "./api";
import { GuiMessageEditor } from "./editMessage";
import { GuiGoals } from "./goals";
import { GuiProjects } from "./projectActions";
import { GuiReadState } from "./threadReadState";
import type { AttachmentReference } from "./attachmentTypes";
import { deleteGuiThread } from "./deleteThread";
import { conversation, reduceEvent } from "./events";
import { completeTurnTiming, restoreTurnTiming } from "./turnTiming";
import { MessageQueue } from "./messageQueue";
import { mergeMessageItems } from "./sentMessages";
import { asyncAnswerText, pendingAsyncQuestions, withAsyncAnswer } from "./asyncQuestionState";
import { compactUnavailableReason } from "./composerOptions";
import { rememberTurnDetails } from "./turnDetailsStorage";
import { restoreProcessing } from "./processing";
import { trackProcessingApproval } from "./processingApprovals";
import { initialState, savePreferences } from "./preferences";
import { resolveModelSelection } from "./modelSelection";
import type { ApprovalReply, GuiEvent, GuiState, ListResponse, Model, Settings, Thread, Turn } from "./types";
import type { Item, SkillReference } from "./types";

const STREAM_FRAME_MS = 32;

export class GuiController {
  private state = initialState();
  private listeners = new Set<() => void>();
  private listGeneration = 0;
  private selectionGeneration = 0;
  private deletedThreads = new Set<string>();
  private unlisten?: () => void;
  private disposed = false;
  private connecting?: Promise<void>;
  private accountModels: Model[] | null = null;
  private providerModels: Model[] | null = null;
  private streamEvents: GuiEvent[] = [];
  private streamTimer?: ReturnType<typeof setTimeout>;
  private remoteReads = new Map<string, Promise<void>>();
  private remoteTurnEvents = new Map<string, GuiEvent[]>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private patch = (patch: Partial<GuiState>) => {
    if (this.disposed) return;
    const previousSelection = this.state.selected;
    this.state = { ...this.state, ...patch };
    if (previousSelection !== this.state.selected) savePreferences(this.state);
    this.listeners.forEach((listener) => listener());
  };
  report = (error: unknown) => {
    const message = error instanceof Error ? error.message : error;
    this.patch({ error: typeof message === "string" ? message : "操作未完成，请重试。" });
  };
  clearError = () => this.patch({ error: "" });
  setWorkspaceBusy = (workspaceBusy: boolean) => {
    this.patch({ workspaceBusy });
    if (!workspaceBusy) Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id));
  };
  readonly messageEditor = new GuiMessageEditor({ getSnapshot: this.getSnapshot, patch: this.patch, report: this.report,
    acceptTurn: (threadId, turn) => this.acceptTurn(threadId, turn), refresh: () => this.refresh(),
    flushQueue: () => Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id)) });
  readonly goals = new GuiGoals({ getSnapshot: this.getSnapshot, patch: this.patch, report: this.report });
  readonly projectActions = new GuiProjects({ getSnapshot: this.getSnapshot, patch: this.patch, report: this.report });
  readonly readState = new GuiReadState({ getSnapshot: this.getSnapshot, patch: this.patch });
  readonly queue = new MessageQueue({ getSnapshot: this.getSnapshot, patch: this.patch,
    active: () => !this.disposed, report: this.report,
    acceptTurn: (threadId, turn) => this.acceptTurn(threadId, turn) });

  private acceptTurn(threadId: string, turn: Turn) {
    const current = this.state.conversations[threadId];
    if (!current) return;
    if (current.turns.some((entry) => entry.id === turn.id)) {
      // Events may beat the acknowledgement; their newer content and final status must win.
      this.patch({ conversations: { ...this.state.conversations, [threadId]: { ...current,
        turns: current.turns.map((entry) => entry.id === turn.id
          ? { ...entry, items: mergeMessageItems(turn.items ?? [], entry.items) } : entry) } } });
      return;
    }
    const timedTurn = turn.status === "inProgress" ? restoreTurnTiming(turn) : completeTurnTiming(turn);
    this.patch({ conversations: { ...this.state.conversations, [threadId]: { ...current,
      turns: [...current.turns, timedTurn], activeTurn: turn.status === "inProgress" ? turn.id : null,
      processing: turn.status === "inProgress" ? restoreProcessing(timedTurn) : undefined } } });
    this.readState.receive({ method: turn.status === "inProgress" ? "turn/started" : "turn/completed",
      params: { threadId, turn } });
  }

  private flushStream = () => {
    clearTimeout(this.streamTimer);
    this.streamTimer = undefined;
    if (!this.streamEvents.length) return;
    this.patch(this.streamEvents.reduce(reduceEvent, this.state));
    this.streamEvents = [];
  };
  private receive = (event: GuiEvent) => {
    const threadId = event.params.threadId ?? event.params.thread?.id;
    if (threadId && ["turn/started", "turn/completed"].includes(event.method)) {
      this.remoteTurnEvents.get(threadId)?.push(event);
    }
    if (event.method === "thread/deleted" && threadId) {
      this.forgetThread(threadId);
      void this.refresh();
      return;
    }
    if (threadId && this.deletedThreads.has(threadId)) return;
    if (event.method === "connection/restored") { void this.connect(); return; }
    if (event.method.endsWith("Delta") || event.method.endsWith("/delta")) {
      this.streamEvents.push(event);
      this.streamTimer ??= setTimeout(this.flushStream, STREAM_FRAME_MS);
      return;
    }
    this.flushStream();
    this.patch(reduceEvent(this.state, event));
    this.readState.receive(event);
    if (["turn/diff/updated", "turn/plan/updated"].includes(event.method) && event.params.threadId) {
      const value = this.state.conversations[event.params.threadId];
      const turnId = event.params.turnId ?? value?.activeTurn;
      if (value && turnId) rememberTurnDetails(value, turnId);
    }
    if (event.method === "turn/completed" && event.params.threadId) void this.queue.flush(event.params.threadId);
    if (event.method === "turn/completed" || event.method === "thread/name/updated") void this.refresh();
  };

  connect = (options?: { reuseExisting: boolean }) => {
    if (this.connecting) return this.connecting;
    this.connecting = this.initialize(options).finally(() => { this.connecting = undefined; });
    return this.connecting;
  };

  private async initialize(options?: { reuseExisting: boolean }) {
    this.patch({ connection: "connecting", error: "" });
    try {
      if (!this.unlisten) {
        const stop = await guiApi.subscribe(this.receive);
        if (this.disposed) { stop(); return; }
        this.unlisten = stop;
      }
      const approvals = await (options ? guiApi.connect(options) : guiApi.connect());
      this.patch({ connection: "ready", approvals, error: "" });
      const results = await Promise.allSettled([this.refresh(), this.loadModels()]);
      results.forEach((result) => { if (result.status === "rejected") this.report(result.reason); });
      if (this.state.selected) await this.select(this.state.selected);
      this.patch(this.state.approvals.reduce(trackProcessingApproval, this.state));
      Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id));
    } catch (error) { this.patch({ connection: "offline" }); this.report(error); }
  }

  private async loadModels() {
    let cursor: string | undefined;
    const models: Model[] = [];
    do {
      const response = await guiApi.request<ListResponse<Model>>({ operation: "models", cursor });
      models.push(...response.data);
      cursor = response.nextCursor || undefined;
    } while (cursor && !this.disposed);
    this.accountModels = models;
    this.applyModels();
  }

  setProviderModels = (models: Model[] | null) => {
    this.providerModels = models;
    this.applyModels();
  };

  private applyModels() {
    if (this.disposed) return;
    const models = this.providerModels ?? this.accountModels;
    if (!models) { this.patch({ models: [] }); return; }
    this.patch({ models });
    const { model, effort } = this.state.settings;
    const selection = resolveModelSelection(models, { model, effort });
    if (selection.model !== model || selection.effort !== effort) this.settings(selection);
  }

  refresh = async (more = false) => {
    if (more && (!this.state.cursor || this.state.loading)) return;
    const generation = ++this.listGeneration;
    this.patch({ loading: true });
    try {
      const response = await guiApi.request<ListResponse<Thread>>({ operation: "list", archived: this.state.archived,
        search: this.state.search || undefined, cursor: more ? this.state.cursor ?? undefined : undefined });
      if (generation !== this.listGeneration) return;
      this.readState.observeThreads(response.data);
      const threads = more ? [...this.state.threads, ...response.data] : response.data;
      const live = this.state.archived || this.state.search ? [] : Object.values(this.state.conversations)
        .filter((value) => value.activeTurn).map((value) => value.thread);
      const grouped = [...new Map([...live, ...threads].map((thread) => [thread.id, thread])).values()]
        .map((thread) => ({ ...thread, cwd: this.state.projectOverrides[thread.id] ?? thread.cwd,
          // The list can lag behind the first user-message notification.
          preview: thread.preview || this.state.conversations[thread.id]?.thread.preview || "" }));
      this.patch({ threads: grouped,
        cursor: response.nextCursor });
    } catch (error) { if (generation === this.listGeneration) this.report(error); }
    finally { if (generation === this.listGeneration) this.patch({ loading: false }); }
  };

  filter = (search: string, archived: boolean) => { this.patch({ search, archived }); void this.refresh(); };
  settings = (settings: Partial<Settings>) => {
    this.patch({ settings: { ...this.state.settings, ...settings } });
    if (this.state.selected && (settings.model !== undefined || settings.effort !== undefined
      || settings.access !== undefined)) {
      const { model, effort, access } = this.state.settings;
      this.queue.updateSettings(this.state.selected, { model, effort, access });
    }
    if (settings.cwd) this.patch({ projects: [...new Set([settings.cwd, ...this.state.projects])].slice(0, 20) });
    savePreferences(this.state);
  };
  setProject = (cwd: string) => {
    const id = this.state.selected;
    if (this.state.sending || (id && this.state.conversations[id]?.activeTurn)) return;
    if (id) this.patch({ projectOverrides: { ...this.state.projectOverrides, [id]: cwd } });
    this.settings({ cwd });
  };
  pin = (id: string) => {
    const pins = this.state.pins.includes(id) ? this.state.pins.filter((pin) => pin !== id) : [...this.state.pins, id];
    this.patch({ pins });
    savePreferences(this.state);
  };
  newConversation = () => {
    ++this.selectionGeneration;
    this.patch({ selected: null, error: "", archived: false });
    if (this.state.connection === "ready") void this.refresh();
  };

  select = async (id: string) => {
    if (this.state.deleting === id) return;
    this.deletedThreads.delete(id);
    const generation = ++this.selectionGeneration;
    this.patch({ selected: id, error: "" });
    if (this.state.conversations[id]?.activeTurn) { this.readState.markRead(id); return; }
    try {
      const { thread } = await guiApi.request<{ thread: Thread }>({ operation: "read", threadId: id });
      if (generation !== this.selectionGeneration || this.state.conversations[id]?.activeTurn) return;
      this.patch({ conversations: { ...this.state.conversations,
        [id]: conversation(thread, this.state.conversations[id]) } });
      this.readState.markRead(id);
      this.patch(this.state.approvals.reduce(trackProcessingApproval, this.state));
      void this.goals.load(id);
      if (!this.state.archived) void this.queue.flush(id);
    } catch (error) { if (generation === this.selectionGeneration) this.report(error); }
  };

  /** Load the phone's conversation without changing the conversation selected on the PC. */
  loadRemoteThread = (threadId: string): Promise<void> => {
    const pending = this.remoteReads.get(threadId);
    if (pending) return pending;
    const reading = this.readRemoteThread(threadId).finally(() => {
      this.remoteReads.delete(threadId); this.remoteTurnEvents.delete(threadId);
    });
    this.remoteReads.set(threadId, reading);
    return reading;
  };

  private async readRemoteThread(threadId: string) {
    const before = this.state.conversations[threadId];
    const events: GuiEvent[] = [];
    this.remoteTurnEvents.set(threadId, events);
    const { thread } = await guiApi.request<{ thread: Thread }>({ operation: "read", threadId });
    // Lifecycle events received during the read are newer than its history response.
    if (this.state.conversations[threadId] === before) {
      const loaded = { ...this.state,
        conversations: { ...this.state.conversations, [threadId]: conversation(thread, before) } };
      this.patch(events.reduce(reduceEvent, loaded));
    }
  }

  send = async (text: string, images: string[], skills: SkillReference[] = [], attachments: AttachmentReference[] = []) => {
    const { selected, settings, conversations } = this.state;
    const projectOverride = selected ? this.state.projectOverrides[selected] : undefined;
    if (this.state.workspaceBusy || this.state.sending || this.state.deleting || this.state.compacting === selected
      || this.state.connection !== "ready" || this.state.archived
      || (!text.trim() && !images.length && !skills.length && !attachments.length)) return false;
    if (selected && (conversations[selected]?.activeTurn || this.state.queued[selected]?.length)) {
      const accepted = this.queue.enqueue(selected, { text, images, skills, ...(attachments.length ? { attachments } : {}) });
      if (accepted) void this.queue.flush(selected);
      return accepted;
    }
    const startedAtMs = Date.now();
    this.patch({ sending: true, pendingRequest: { threadId: selected, startedAtMs }, error: "" });
    try {
      const response = selected
        ? await guiApi.request<{ thread: Thread }>({ operation: "resume", threadId: selected,
          access: settings.access, cwd: projectOverride })
        : await guiApi.request<{ thread: Thread }>({ operation: "start", cwd: settings.cwd || undefined,
          model: settings.model || undefined, access: settings.access });
      const { thread } = response;
      this.patch({ selected: thread.id, pendingRequest: { threadId: thread.id, startedAtMs },
        conversations: { ...this.state.conversations,
          [thread.id]: conversation(thread, this.state.conversations[thread.id]) } });
      this.settings({ cwd: projectOverride ?? thread.cwd });
      // Loaded threads can ignore resume overrides; apply project and access settings to each new turn.
      const { turn } = await guiApi.request<{ turn: Turn }>({ operation: "send", threadId: thread.id,
        text, images, skills, ...(attachments.length ? { attachments } : {}), model: settings.model || undefined,
        effort: settings.effort || undefined, cwd: projectOverride, access: settings.access });
      // Completion can arrive before the request promise resolves. Never resurrect a completed turn.
      this.acceptTurn(thread.id, turn);
      void this.refresh();
      return true;
    } catch (error) { this.report(error); return false; }
    finally {
      this.patch({ sending: false, pendingRequest: undefined });
      Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id));
    }
  };

  answerAsyncQuestion = async (item: Item, answers: string[]): Promise<boolean> => {
    const state = this.state;
    const threadId = state.selected;
    const current = threadId ? state.conversations[threadId] : undefined;
    const text = asyncAnswerText(item, answers);
    if (!threadId || !current || !text || state.connection !== "ready" || state.archived
      || state.sending || state.workspaceBusy || state.deleting || state.compacting === threadId
      || !pendingAsyncQuestions(current).some((question) => question.id === item.id)) return false;
    if (!current.activeTurn) return this.send(text, []);
    const turnId = current.activeTurn;
    const userMessageIndex = current.turns.find((turn) => turn.id === turnId)
      ?.items.filter((entry) => entry.type === "userMessage").length ?? 0;
    this.patch({ sending: true, error: "" });
    try {
      await guiApi.request({ operation: "steer", threadId, turnId, text, images: [], skills: [] });
      const latest = this.state.conversations[threadId];
      if (latest) this.patch({ conversations: { ...this.state.conversations, [threadId]: { ...latest,
        turns: latest.turns.map((turn) => turn.id === turnId
          ? withAsyncAnswer(turn, text, userMessageIndex) : turn) } } });
      return true;
    } catch (error) { this.report(error); return false; }
    finally {
      this.patch({ sending: false });
      Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id));
    }
  };

  compact = async () => {
    const id = this.state.selected;
    if (!id || compactUnavailableReason(this.state)) return false;
    this.patch({ compacting: id, error: "" });
    try {
      // Reading history does not load the thread into the app-server's active session.
      const { thread } = await guiApi.request<{ thread: Thread }>({ operation: "resume", threadId: id,
        access: this.state.settings.access });
      const current = conversation(thread, this.state.conversations[id]);
      if (current.activeTurn || this.state.conversations[id]?.activeTurn) {
        this.patch({ compacting: undefined });
        return false;
      }
      this.patch({ conversations: { ...this.state.conversations, [id]: current } });
      await guiApi.request({ operation: "compact", threadId: id });
      // The acknowledgement precedes completion; lifecycle events release the guard.
      return true;
    } catch (error) {
      this.patch({ compacting: undefined });
      this.report(error);
      return false;
    }
  };

  interrupt = async () => {
    const id = this.state.selected;
    const turnId = id ? this.state.conversations[id]?.activeTurn : null;
    if (!id || !turnId) return;
    if (this.state.goals?.[id]?.status === "active"
      && !await this.goals.set({ threadId: id, status: "paused" })) return;
    try { await guiApi.request({ operation: "interrupt", threadId: id, turnId }); }
    catch (error) { this.report(error); }
  };

  manage = async (operation: "rename" | "archive" | "unarchive", id: string, name?: string) => {
    if (this.state.conversations[id]?.activeTurn || this.state.deleting === id || this.state.compacting === id) return;
    if (operation === "archive" && this.state.queued[id]?.length) {
      this.report("请先发送或删除待发送消息，再归档对话。");
      return;
    }
    try {
      await guiApi.request(operation === "rename"
        ? { operation, threadId: id, name: name ?? "" } : { operation, threadId: id });
      if (operation === "rename" && this.state.conversations[id]) {
        const value = this.state.conversations[id];
        this.patch({ conversations: { ...this.state.conversations,
          [id]: { ...value, thread: { ...value.thread, name } } } });
      }
      if (operation === "archive" && this.state.selected === id) this.newConversation();
      if (operation === "unarchive") { this.patch({ archived: false }); await this.select(id); }
      await this.refresh();
    } catch (error) { this.report(error); }
  };

  deleteThread = async (id: string) => {
    if (this.state.deleting || this.state.sending || this.state.compacting === id || this.state.connection !== "ready"
      || this.state.conversations[id]?.activeTurn || this.state.queued[id]?.length
      || this.state.threads.some((thread) => thread.id === id && thread.status?.type === "active")
      || this.state.approvals.some((event) => event.params.threadId === id)) {
      this.report("请等待回复结束，并处理待发送消息后再删除对话。");
      return false;
    }
    if (this.state.selected === id) ++this.selectionGeneration;
    this.patch({ deleting: id, error: "" });
    try {
      await deleteGuiThread(id);
      this.forgetThread(id);
      await this.refresh();
      return true;
    } catch (error) { this.report(error); return false; }
    finally { this.patch({ deleting: undefined }); }
  };

  private forgetThread(id: string) {
    if (this.state.selected === id) ++this.selectionGeneration;
    this.flushStream();
    this.deletedThreads.add(id);
    ++this.listGeneration;
    const conversations = { ...this.state.conversations };
    const queued = { ...this.state.queued };
    const projectOverrides = { ...this.state.projectOverrides };
    const threadReadState = { ...this.state.threadReadState };
    delete threadReadState[id];
    delete conversations[id]; delete queued[id]; delete projectOverrides[id];
    this.patch({ conversations, queued, projectOverrides, threadReadState,
      threads: this.state.threads.filter((thread) => thread.id !== id),
      pins: this.state.pins.filter((pin) => pin !== id),
      approvals: this.state.approvals.filter((event) => event.params.threadId !== id),
      selected: this.state.selected === id ? null : this.state.selected });
    savePreferences(this.state);
  }

  respond = async (reply: ApprovalReply) => {
    try {
      await guiApi.respond(reply);
      this.patch(reduceEvent(this.state, { method: "serverRequest/resolved", params: { requestId: reply.id } }));
    } catch (error) { this.report(error); }
  };

  activate = () => { this.disposed = false; };
  suspend = () => {
    this.unlisten?.(); this.unlisten = undefined;
    this.flushStream();
    this.patch({ ...reduceEvent(this.state, { method: "connection/closed", params: {} }), error: "" });
  };
  dispose = () => {
    this.disposed = true; this.unlisten?.(); this.unlisten = undefined;
    clearTimeout(this.streamTimer); this.streamTimer = undefined; this.streamEvents = []; this.listeners.clear();
  };
}
