import { guiApi } from "./api";
import { conversation } from "./events";
import type { GuiState, MessageInput, QueuedMessage, Thread, Turn } from "./types";

const MAX_QUEUED_MESSAGES = 100;
interface QueueHost {
  active: () => boolean;
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  report: (error: unknown) => void;
  acceptTurn: (threadId: string, turn: Turn) => void;
}

export class MessageQueue {
  private pending = new Set<string>();
  constructor(private host: QueueHost) {}
  private list = (threadId: string) => this.host.getSnapshot().queued[threadId] ?? [];
  private update = (threadId: string, messages: QueuedMessage[]) => {
    this.host.patch({ queued: { ...this.host.getSnapshot().queued, [threadId]: messages } });
  };
  enqueue = (threadId: string, input: MessageInput): boolean => {
    const state = this.host.getSnapshot();
    if (this.list(threadId).length >= MAX_QUEUED_MESSAGES) {
      this.host.report("待发送消息已满，请等待发送后再添加。");
      return false;
    }
    this.update(threadId, [...this.list(threadId), { ...input, id: crypto.randomUUID(),
      model: state.settings.model, effort: state.settings.effort, access: state.settings.access }]);
    return true;
  };
  remove = (threadId: string, id: string) => {
    this.update(threadId, this.list(threadId).filter((item) => item.id !== id || item.busy));
    void this.flush(threadId);
  };
  edit = (threadId: string, id: string, change: { editing: boolean; text?: string }) => {
    this.update(threadId, this.list(threadId).map((item) =>
      item.id === id && !item.busy ? { ...item, ...change } : item));
    if (!change.editing) void this.flush(threadId);
  };
  private markBusy = (threadId: string, ids: Set<string>, busy: boolean) => {
    this.update(threadId, this.list(threadId).map((item) => ids.has(item.id) ? { ...item, busy } : item));
  };
  private resume = async (threadId: string, message: QueuedMessage): Promise<boolean> => {
    const { thread } = await guiApi.request<{ thread: Thread }>({
      operation: "resume", threadId, access: message.access });
    const state = this.host.getSnapshot();
    if (!this.host.active() || state.connection !== "ready" || state.conversations[threadId]?.activeTurn) return false;
    const current = conversation(thread, state.conversations[threadId]);
    this.host.patch({ conversations: { ...state.conversations, [threadId]: current } });
    return !current.activeTurn;
  };
  flush = async (threadId: string): Promise<void> => {
    const state = this.host.getSnapshot();
    const messages = this.list(threadId);
    if (!this.host.active() || state.connection !== "ready" || state.sending || this.pending.has(threadId)
      || state.conversations[threadId]?.activeTurn || !messages.length || messages.some((item) => item.editing)) return;
    this.pending.add(threadId);
    const ids = new Set(messages.map((item) => item.id));
    this.markBusy(threadId, ids, true);
    let sent = false;
    try {
      if (!await this.resume(threadId, messages[0])) return;
      const { turn } = await guiApi.request<{ turn: Turn }>({ operation: "sendBatch", threadId,
        messages: messages.map(({ text, images, skills }) => ({ text, images, skills })),
        model: messages[0].model || undefined, effort: messages[0].effort || undefined });
      this.update(threadId, this.list(threadId).filter((item) => !ids.has(item.id)));
      this.host.acceptTurn(threadId, turn);
      sent = true;
    } catch (error) { this.host.report(error); }
    finally { this.pending.delete(threadId); this.markBusy(threadId, ids, false); }
    if (sent) void this.flush(threadId);
  };
  steer = async (threadId: string, id: string) => {
    const state = this.host.getSnapshot();
    const turnId = state.conversations[threadId]?.activeTurn;
    const item = this.list(threadId).find((entry) => entry.id === id);
    if (!this.host.active() || state.connection !== "ready" || !turnId || !item || item.busy || item.editing
      || this.pending.has(threadId)) return;
    this.pending.add(threadId);
    const ids = new Set([id]);
    this.markBusy(threadId, ids, true);
    try {
      await guiApi.request({ operation: "steer", threadId, turnId,
        text: item.text, images: item.images, skills: item.skills });
      this.update(threadId, this.list(threadId).filter((entry) => entry.id !== id));
    } catch (error) { this.host.report(error); }
    finally { this.pending.delete(threadId); this.markBusy(threadId, ids, false); }
    void this.flush(threadId);
  };
}
