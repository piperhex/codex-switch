import type { Conversation, GuiEvent, GuiState, Item, Thread, Turn } from "./types";

export function conversation(thread: Thread): Conversation {
  const turns = thread.turns ?? [];
  return { thread, turns, activeTurn: turns.find((turn) => turn.status === "inProgress")?.id ?? null,
    diff: "", plan: [], tokens: 0, error: "" };
}

function updateTurn(value: Conversation, id: string, update: (turn: Turn) => Turn): Conversation {
  const turns = [...value.turns];
  const index = turns.findIndex((turn) => turn.id === id);
  const next = update(turns[index] ?? { id, status: "inProgress", items: [] });
  if (index === -1) turns.push(next);
  else turns[index] = next;
  return { ...value, turns };
}

function updateItem(value: Conversation, event: GuiEvent, update: (item: Item) => Item): Conversation {
  const { turnId, itemId, item } = event.params;
  const id = itemId ?? item?.id;
  if (!turnId || !id) return value;
  return updateTurn(value, turnId, (turn) => {
    const items = [...turn.items];
    const index = items.findIndex((entry) => entry.id === id);
    const next = update(items[index] ?? { id, type: "agentMessage", text: "" });
    if (index === -1) items.push(next);
    else items[index] = next;
    return { ...turn, items };
  });
}

function applyDelta(value: Conversation, event: GuiEvent): Conversation {
  const delta = event.params.delta ?? "";
  return updateItem(value, event, (item) => {
    if (event.method === "item/commandExecution/outputDelta") {
      return { ...item, type: "commandExecution", aggregatedOutput: (item.aggregatedOutput ?? "") + delta };
    }
    if (event.method.startsWith("item/reasoning/")) {
      const key = event.method.includes("summary") ? "summary" : "content";
      const parts = [...((item[key] as string[] | undefined) ?? [])];
      const index = event.params.summaryIndex ?? event.params.contentIndex ?? 0;
      parts[index] = (parts[index] ?? "") + delta;
      return { ...item, type: "reasoning", [key]: parts };
    }
    return { ...item, text: (item.text ?? "") + delta };
  });
}

export function reduceConversation(value: Conversation, event: GuiEvent): Conversation {
  const { method, params } = event;
  if (method === "turn/started" && params.turn) {
    return { ...updateTurn(value, params.turn.id, (old) => ({ ...old, status: params.turn!.status })),
      activeTurn: params.turn.id, error: "" };
  }
  if (method === "turn/completed" && params.turn) {
    return { ...updateTurn(value, params.turn.id, (old) => ({ ...old, ...params.turn,
      items: params.turn!.items?.length ? params.turn!.items : old.items })), activeTurn: null,
      error: params.turn.status === "failed" ? "本次回复未完成，请检查连接后重试。" : "" };
  }
  if ((method === "item/started" || method === "item/completed") && params.item) {
    const updated = updateItem(value, event, () => params.item!);
    if (params.item.type === "userMessage" && !value.thread.preview) {
      const content = params.item.content?.filter((part) => typeof part === "object" && part.type === "text") ?? [];
      const preview = content.map((part) => typeof part === "object" ? part.text : "").join(" ");
      return { ...updated, thread: { ...updated.thread, preview } };
    }
    return updated;
  }
  if (method.endsWith("Delta") || method.endsWith("/delta")) return applyDelta(value, event);
  if (method === "turn/diff/updated") return { ...value, diff: params.diff ?? "" };
  if (method === "turn/plan/updated") return { ...value, plan: params.plan ?? [] };
  if (method === "thread/tokenUsage/updated") return { ...value, tokens: params.tokenUsage?.total.totalTokens ?? 0 };
  if (method === "error") return { ...value,
    error: params.willRetry ? "连接暂时中断，Codex 正在重试…" : "本次回复遇到问题，请检查账户和连接后重试。" };
  return value;
}

export function reduceEvent(state: GuiState, event: GuiEvent): GuiState {
  if (event.method === "connection/closed") {
    const conversations = Object.fromEntries(Object.entries(state.conversations)
      .map(([id, value]) => [id, { ...value, activeTurn: null }]));
    return { ...state, connection: "offline", approvals: [], conversations, sending: false,
      error: "Codex 已断开连接。重新连接后可以继续对话。" };
  }
  if (event.id != null) return { ...state,
    approvals: [...state.approvals.filter((entry) => entry.id !== event.id), event] };
  if (event.method === "serverRequest/resolved") {
    return { ...state, approvals: state.approvals.filter((entry) => entry.id !== event.params.requestId) };
  }
  const id = event.params.threadId ?? event.params.thread?.id;
  if (!id) return state;
  const thread = event.params.thread;
  const existing = state.conversations[id];
  if (!existing && !thread) return state;
  const value = reduceConversation(existing ?? conversation(thread!), event);
  const approvals = event.method === "turn/completed"
    ? state.approvals.filter((entry) => entry.params.turnId !== event.params.turn?.id) : state.approvals;
  return { ...state, approvals, conversations: { ...state.conversations, [id]: value } };
}
