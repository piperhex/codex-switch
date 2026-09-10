import { HISTORY_CHANGED } from './historySync';
import type { GuiEvent } from './client/types';

/** Message contents are delivered only by syncHistory, never twice through completion notifications. */
export function historyNotification(event: GuiEvent): GuiEvent {
  const threadId = event.params?.threadId ?? event.params?.thread?.id;
  if (event.id == null && threadId && /^(item|turn|thread)\//.test(event.method)) {
    return { method: HISTORY_CHANGED, params: { threadId, reason: event.method } };
  }
  return event;
}
