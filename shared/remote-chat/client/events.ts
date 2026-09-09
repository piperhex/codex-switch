import type { ChatState, GuiEvent, Item, Thread, Turn } from './types';

function mergeItems(previous: Item[], incoming: Item[]) {
  const items = [...previous];
  for (const item of incoming) {
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index < 0) items.push(item);
    else items[index] = { ...items[index], ...item };
  }
  return items;
}

function updateTurn(thread: Thread, event: GuiEvent): Thread {
  const { params, method } = event;
  const id = params.turnId ?? params.turn?.id;
  if (!id) return thread;
  const turns = [...(thread.turns ?? [])];
  const index = turns.findIndex((turn) => turn.id === id);
  let turn: Turn = turns[index] ?? { id, status: 'inProgress', items: [] };
  if (params.turn) turn = { ...turn, ...params.turn, items: mergeItems(turn.items, params.turn.items ?? []) };
  if (params.item) turn = { ...turn, items: mergeItems(turn.items, [params.item]) };
  if (method === 'turn/diff/updated') turn = { ...turn, diff: params.diff };
  if (method === 'turn/plan/updated') turn = { ...turn, plan: params.plan, planExplanation: params.explanation };
  if (method.endsWith('Delta') || method.endsWith('/delta')) turn = applyDelta(turn, event);
  if (index < 0) turns.push(turn);
  else turns[index] = turn;
  return { ...thread, turns };
}

function applyDelta(turn: Turn, event: GuiEvent): Turn {
  const { itemId, delta = '', summaryIndex = 0 } = event.params;
  if (!itemId) return turn;
  const old = turn.items.find((item) => item.id === itemId) ?? { id: itemId, type: 'agentMessage' };
  let item: Item = { ...old, text: (old.text ?? '') + delta };
  if (event.method.includes('outputDelta')) item = { ...old, aggregatedOutput: (old.aggregatedOutput ?? '') + delta };
  if (event.method.includes('/reasoning/')) {
    const summary = [...(old.summary ?? [])];
    summary[summaryIndex] = (summary[summaryIndex] ?? '') + delta;
    item = { ...old, type: 'reasoning', summary };
  }
  return { ...turn, items: mergeItems(turn.items, [item]) };
}

export function applyChatEvent(state: ChatState, event: GuiEvent): ChatState {
  if (!event || typeof event.method !== 'string' || !event.params) return state;
  const { method, params } = event;
  if (event.id != null) return { ...state,
    approvals: [...state.approvals.filter((entry) => entry.id !== event.id), event] };
  if (method === 'serverRequest/resolved') return { ...state,
    approvals: state.approvals.filter((entry) => entry.id !== params.requestId) };
  if (method === 'codex/disconnected') return { ...state, error: '电脑上的 Codex 已断开，请重新连接。' };
  const threadId = params.threadId ?? params.thread?.id;
  let threads = state.threads;
  if (method === 'thread/started' && params.thread) {
    threads = [params.thread, ...threads.filter((thread) => thread.id !== params.thread!.id)];
  }
  let selected = state.selected;
  if (selected && selected.id === threadId) selected = updateTurn(selected, event);
  const approvals = method === 'turn/completed'
    ? state.approvals.filter((entry) => entry.params.turnId !== params.turn?.id) : state.approvals;
  const error = method === 'error' && !params.willRetry ? (params.error?.message ?? '本次回复未完成。') : state.error;
  return { ...state, threads, selected, approvals, error };
}
