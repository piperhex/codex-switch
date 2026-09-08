import { guiApi } from "./api";
import { conversation, reduceEvent } from "./events";
import { initialState, savePreferences } from "./preferences";
import type { ApprovalReply, GuiEvent, GuiState, ListResponse, Model, Settings, Thread, Turn } from "./types";
import type { SkillReference } from "./types";

const STREAM_FRAME_MS = 32;

export class GuiController {
  private state = initialState();
  private listeners = new Set<() => void>();
  private listGeneration = 0;
  private selectionGeneration = 0;
  private unlisten?: () => void;
  private disposed = false;
  private connecting?: Promise<void>;
  private streamEvents: GuiEvent[] = [];
  private streamTimer?: ReturnType<typeof setTimeout>;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private patch = (patch: Partial<GuiState>) => {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  };
  report = (error: unknown) => this.patch({ error: typeof error === "string" ? error : "操作未完成，请重试。" });
  clearError = () => this.patch({ error: "" });

  private flushStream = () => {
    clearTimeout(this.streamTimer);
    this.streamTimer = undefined;
    if (!this.streamEvents.length) return;
    this.patch(this.streamEvents.reduce(reduceEvent, this.state));
    this.streamEvents = [];
  };
  private receive = (event: GuiEvent) => {
    if (event.method.endsWith("Delta") || event.method.endsWith("/delta")) {
      this.streamEvents.push(event);
      this.streamTimer ??= setTimeout(this.flushStream, STREAM_FRAME_MS);
      return;
    }
    this.flushStream();
    this.patch(reduceEvent(this.state, event));
    if (event.method === "turn/completed" || event.method === "thread/name/updated") void this.refresh();
  };

  connect = () => {
    if (this.connecting) return this.connecting;
    this.connecting = this.initialize().finally(() => { this.connecting = undefined; });
    return this.connecting;
  };

  private async initialize() {
    this.patch({ connection: "connecting", error: "" });
    try {
      if (!this.unlisten) {
        const stop = await guiApi.subscribe(this.receive);
        if (this.disposed) { stop(); return; }
        this.unlisten = stop;
      }
      const approvals = await guiApi.connect();
      this.patch({ connection: "ready", approvals, error: "" });
      const results = await Promise.allSettled([this.refresh(), this.loadModels()]);
      results.forEach((result) => { if (result.status === "rejected") this.report(result.reason); });
      if (this.state.selected) await this.select(this.state.selected);
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
    this.patch({ models });
  }

  refresh = async (more = false) => {
    if (more && (!this.state.cursor || this.state.loading)) return;
    const generation = ++this.listGeneration;
    this.patch({ loading: true });
    try {
      const response = await guiApi.request<ListResponse<Thread>>({ operation: "list", archived: this.state.archived,
        search: this.state.search || undefined, cursor: more ? this.state.cursor ?? undefined : undefined });
      if (generation !== this.listGeneration) return;
      const threads = (more ? [...this.state.threads, ...response.data] : response.data)
        .map((thread) => ({ ...thread, cwd: this.state.projectOverrides[thread.id] ?? thread.cwd }));
      const live = this.state.archived || this.state.search ? [] : Object.values(this.state.conversations)
        .filter((value) => value.activeTurn).map((value) => value.thread);
      this.patch({ threads: [...new Map([...live, ...threads].map((thread) => [thread.id, thread])).values()],
        cursor: response.nextCursor });
    } catch (error) { if (generation === this.listGeneration) this.report(error); }
    finally { if (generation === this.listGeneration) this.patch({ loading: false }); }
  };

  filter = (search: string, archived: boolean) => { this.patch({ search, archived }); void this.refresh(); };
  settings = (settings: Partial<Settings>) => {
    this.patch({ settings: { ...this.state.settings, ...settings } });
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
    const generation = ++this.selectionGeneration;
    this.patch({ selected: id, error: "" });
    if (this.state.conversations[id]?.activeTurn) return;
    try {
      const { thread } = await guiApi.request<{ thread: Thread }>({ operation: "read", threadId: id });
      if (generation !== this.selectionGeneration || this.state.conversations[id]?.activeTurn) return;
      this.patch({ conversations: { ...this.state.conversations, [id]: conversation(thread) } });
    } catch (error) { if (generation === this.selectionGeneration) this.report(error); }
  };

  send = async (text: string, images: string[], skills: SkillReference[] = []) => {
    const { selected, settings, conversations } = this.state;
    const projectOverride = selected ? this.state.projectOverrides[selected] : undefined;
    if (this.state.sending || this.state.connection !== "ready") return false;
    if (selected && conversations[selected]?.activeTurn) return false;
    this.patch({ sending: true, error: "" });
    try {
      const response = selected
        ? await guiApi.request<{ thread: Thread }>({ operation: "resume", threadId: selected,
          access: settings.access, cwd: projectOverride })
        : await guiApi.request<{ thread: Thread }>({ operation: "start", cwd: settings.cwd || undefined,
          model: settings.model || undefined, access: settings.access });
      const { thread } = response;
      this.patch({ selected: thread.id,
        conversations: { ...this.state.conversations, [thread.id]: conversation(thread) } });
      this.settings({ cwd: projectOverride ?? thread.cwd });
      // Loaded threads can ignore resume overrides; apply project changes to the next turn explicitly.
      const { turn } = await guiApi.request<{ turn: Turn }>({ operation: "send", threadId: thread.id,
        text, images, skills, model: settings.model || undefined,
        effort: settings.effort || undefined, cwd: projectOverride });
      const current = this.state.conversations[thread.id];
      // Completion can arrive before the request promise resolves. Never resurrect a completed turn.
      if (!current.turns.some((entry) => entry.id === turn.id)) {
        this.patch({ conversations: { ...this.state.conversations, [thread.id]: { ...current,
          turns: [...current.turns, turn], activeTurn: turn.status === "inProgress" ? turn.id : null } } });
      }
      void this.refresh();
      return true;
    } catch (error) { this.report(error); return false; }
    finally { this.patch({ sending: false }); }
  };

  interrupt = async () => {
    const id = this.state.selected;
    const turnId = id ? this.state.conversations[id]?.activeTurn : null;
    if (!id || !turnId) return;
    try { await guiApi.request({ operation: "interrupt", threadId: id, turnId }); }
    catch (error) { this.report(error); }
  };

  manage = async (operation: "rename" | "archive" | "unarchive", id: string, name?: string) => {
    if (this.state.conversations[id]?.activeTurn) return;
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

  respond = async (reply: ApprovalReply) => {
    try {
      await guiApi.respond(reply);
      this.patch({ approvals: this.state.approvals.filter((event) => event.id !== reply.id) });
    } catch (error) { this.report(error); }
  };

  activate = () => { this.disposed = false; };
  dispose = () => {
    this.disposed = true; this.unlisten?.(); this.unlisten = undefined;
    clearTimeout(this.streamTimer); this.streamTimer = undefined; this.streamEvents = []; this.listeners.clear();
  };
}
