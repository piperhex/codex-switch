import { composerTrigger, type TextSelection } from '../remote-chat/client/skillDraft';

export function composerMenuTrigger(text: string, selection: TextSelection) {
  const command = composerTrigger(text, selection);
  if (command) return { ...command, conversations: false };
  if (selection.start !== selection.end) return null;
  const match = text.slice(0, selection.start).match(/(?:^|\s)@([^\s@/]*)$/u);
  return match ? { start: selection.start - match[1].length - 1, end: selection.start,
    query: match[1], skillsOnly: true, conversations: true } : null;
}
