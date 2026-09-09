import type { Content, Item, QueuedMessage, Turn } from "./types";

/** Replace local echoes in submission order; server IDs handle repeated lifecycle notifications. */
export function mergeMessageItems(previous: Item[], incoming: Item[]): Item[] {
  const items = [...previous];
  const indices = new Map(items.map((item, index) => [item.id, index]));
  for (const item of incoming) {
    let index = indices.get(item.id) ?? -1;
    if (index === -1 && item.type === "userMessage" && !item.localEcho) {
      index = items.findIndex((entry) => entry.localEcho);
    }
    if (index === -1) {
      indices.set(item.id, items.length);
      items.push(item);
      continue;
    }
    indices.delete(items[index].id);
    indices.set(item.id, index);
    items[index] = { ...items[index], ...item, localEcho: item.localEcho };
  }
  return items;
}

function messageContent(message: QueuedMessage): Content[] {
  return [
    { type: "text", text: message.text },
    ...message.images.map((image) => image.startsWith("data:")
      ? { type: "image", url: image } : { type: "localImage", path: image }),
    ...message.skills.map((skill) => ({ type: "mention", name: skill.name, path: skill.path })),
    ...(message.attachments ?? []).map((attachment) => ({
      type: "mention", name: attachment.name, path: attachment.path,
    })),
  ];
}

/** A batch is one server user message. Keep it visible until that message is delivered. */
export function withSentMessage(turn: Turn, messages: QueuedMessage[], userMessageIndex: number): Turn {
  if (!messages.length || turn.items.filter((item) => item.type === "userMessage").length > userMessageIndex) return turn;
  const item: Item = { id: `sent-${messages[0].id}`, type: "userMessage", localEcho: true,
    content: messages.flatMap(messageContent) };
  return { ...turn, items: userMessageIndex === 0 ? [item, ...turn.items] : [...turn.items, item] };
}
