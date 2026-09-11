import type { GuiEvent, Item, Thread, Turn } from '../remote-chat/client/types';

export const MESSAGE_ACKNOWLEDGED = 'chat/message/acknowledged';

/** The ordinal identifies repeated identical sends without matching their text or attachment URLs. */
export function acknowledgeMessage(turn: Turn, event: GuiEvent): Turn {
  const { item, userMessageIndex } = event.params;
  if (!item || !item.localEcho || !Number.isSafeInteger(userMessageIndex) || userMessageIndex! < 0) return turn;
  const users = turn.items.filter((entry) => entry.type === 'userMessage');
  if (users.length > userMessageIndex! || turn.items.some((entry) => entry.id === item.id)) return turn;
  return { ...turn, items: userMessageIndex === 0 ? [item, ...turn.items] : [...turn.items, item] };
}

export function reconcileAcknowledgedItems(live: Item[], snapshot: Item[]): Item[] {
  const users = snapshot.filter((item) => item.type === 'userMessage' && !item.localEcho);
  const liveUsers = live.filter((item) => item.type === 'userMessage');
  const anchor = liveUsers.findIndex((item) => !item.localEcho && users.some((user) => user.id === item.id));
  // Loading older pages shifts user ordinals. Align by a real message before comparing echoes.
  const offset = anchor < 0 ? 0 : users.findIndex((item) => item.id === liveUsers[anchor].id) - anchor;
  let ordinal = 0;
  return live.flatMap((item) => {
    if (item.type !== 'userMessage') return [item];
    const server = users[offset + ordinal++];
    return item.localEcho && server ? [] : [item];
  });
}

export function acknowledgedEvents(thread: Thread): GuiEvent[] {
  return (thread.turns ?? []).flatMap((turn) => {
    let userMessageIndex = 0;
    return turn.items.flatMap((item): GuiEvent[] => {
      if (item.type !== 'userMessage') return [];
      const index = userMessageIndex++;
      return item.localEcho ? [{ method: MESSAGE_ACKNOWLEDGED,
        params: { threadId: thread.id, turnId: turn.id, item, userMessageIndex: index } }] : [];
    });
  });
}
