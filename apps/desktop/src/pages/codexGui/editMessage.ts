import { guiApi } from "./api";
import { conversation } from "./events";
import { visibleContinuationItems } from "./continuation";
import { editedMessageDraft } from "./editedMessageDraft";
import type { Conversation, GuiState, Item, MessageInput, Thread, Turn } from "./types";

export interface MessageEdit { threadId: string; turnId: string; itemId: string; text: string }
export type EditMessage = (edit: MessageEdit) => Promise<boolean>;

export function lastUserMessage(value?: Conversation): { turnId: string; item: Item } | undefined {
  if (!value) return;
  for (let index = value.turns.length - 1; index >= 0; index--) {
    const turn = value.turns[index];
    const items = value.turns[index - 1]?.status === "interrupted"
      ? visibleContinuationItems(turn.items) : turn.items;
    const item = items.filter((entry) => entry.type === "userMessage").at(-1);
    if (item) return { turnId: turn.id, item };
  }
}

export function canEditMessage(state: GuiState): boolean {
  const id = state.selected;
  return Boolean(id && state.connection === "ready" && !state.archived && !state.sending && !state.deleting
    && !state.workspaceBusy
    && state.compacting !== id && !state.conversations[id]?.activeTurn && !state.queued[id]?.length
    && !state.approvals.some((event) => event.params.threadId === id));
}

interface EditHost {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  report: (error: unknown) => void;
  acceptTurn: (threadId: string, turn: Turn) => void;
  refresh: () => Promise<void>;
  flushQueue: () => void;
}

export class GuiMessageEditor {
  readonly recoveredDrafts = new Map<string, MessageInput>();
  constructor(private host: EditHost) {}
  submit: EditMessage = async (edit) => {
    const state = this.host.getSnapshot();
    const last = lastUserMessage(state.conversations[edit.threadId]);
    if (!canEditMessage(state) || state.selected !== edit.threadId || !edit.text.trim()
      || last?.turnId !== edit.turnId || last.item.id !== edit.itemId || last.item.localEcho) return false;
    const { model, effort, access } = state.settings;
    this.host.patch({ sending: true, error: "" });
    try {
      const { thread, turn, error } = await guiApi.request<{ thread: Thread; turn?: Turn; error?: string }>({
        operation: "editMessage",
        ...edit, model: model || undefined, effort: effort || undefined, access,
        cwd: state.projectOverrides[edit.threadId] });
      const latest = this.host.getSnapshot();
      const received = latest.conversations[thread.id];
      // Drop the replaced suffix, while keeping events newer than this edit request.
      const originalIds = new Set(state.conversations[edit.threadId].turns.map((entry) => entry.id));
      const turns = new Map((thread.turns ?? []).map((entry) => [entry.id, entry]));
      received?.turns.forEach((entry) => {
        if (turns.has(entry.id) || !originalIds.has(entry.id)) turns.set(entry.id, entry);
      });
      if (error) this.recoveredDrafts.set(edit.threadId,
        editedMessageDraft(state.conversations[edit.threadId], edit));
      this.host.patch({ selected: latest.selected === edit.threadId ? thread.id : latest.selected,
        conversations: { ...latest.conversations,
          [thread.id]: conversation({ ...thread, turns: [...turns.values()] }, received) } });
      if (turn) this.host.acceptTurn(thread.id, turn);
      void this.host.refresh();
      if (error) { this.host.report("未能确认发送结果。修改内容已放回输入框，请检查对话后重试。"); return false; }
      return true;
    } catch (error) { this.host.report(error); return false; }
    finally { this.host.patch({ sending: false }); this.host.flushQueue(); }
  };
}
