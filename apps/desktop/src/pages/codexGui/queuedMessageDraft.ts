import type { ComposerText, MessageInput } from "./types";

/** Restore explicit skill references as editable chips, including references without a text label. */
export function queuedMessageText(message: MessageInput): ComposerText {
  let text = message.text;
  const mentions: ComposerText["mentions"] = [];
  const skills = [...message.skills].sort((left, right) => right.name.length - left.name.length);
  for (const reference of skills) {
    const label = `$${reference.name}`;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const starts = Array.from(text.matchAll(new RegExp(`${escaped}(?![\\w-])`, "gu")), (match) => match.index)
      .filter((start) => !mentions.some((mention) => start < mention.end && start + label.length > mention.start));
    if (!starts.length) {
      text += text && !/\s$/u.test(text) ? " " : "";
      starts.push(text.length);
      text += label;
    }
    const skill = { ...reference, description: "", enabled: true };
    mentions.push(...starts.map((start) => ({ start, end: start + label.length, skill })));
  }
  return { text, mentions: mentions.sort((left, right) => left.start - right.start) };
}
