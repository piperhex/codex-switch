import { HISTORY_CHANGED } from './historySync';
import type { GuiEvent } from './client/types';

/** Stream live output directly; a resumed thread must not broadcast its entire history. */
export function historyNotification(event: GuiEvent): GuiEvent {
  const threadId = event.params?.threadId ?? event.params?.thread?.id;
  if (event.id == null && threadId && event.method.startsWith('thread/') && event.params.thread) {
    return { method: HISTORY_CHANGED, params: { threadId, reason: event.method } };
  }
  if (event.id == null && event.method === 'turn/completed' && event.params.turn) {
    return { ...event, params: { ...event.params, turn: { ...event.params.turn, items: [] } } };
  }
  return event;
}
