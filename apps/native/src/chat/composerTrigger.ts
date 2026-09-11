import { composerTrigger, type TextSelection } from '../../../../shared/remote-chat/client/skillDraft';

export function nativeComposerTrigger(text: string, selection: TextSelection) {
  const command = composerTrigger(text, selection);
  if (command) return { ...command, plugins: false };
  if (selection.start !== selection.end) return null;
  const match = text.slice(0, selection.start).match(/(?:^|\s)@([^\s@/]*)$/u);
  return match ? { start: selection.start - match[1].length - 1, end: selection.start,
    query: match[1], skillsOnly: true, plugins: true } : null;
}

export function insertPluginTrigger(text: string, selection: TextSelection) {
  const prefix = selection.start > 0 && !/\s/u.test(text[selection.start - 1]) ? ' ' : '';
  const value = text.slice(0, selection.start) + prefix + '@' + text.slice(selection.end);
  const caret = selection.start + prefix.length + 1;
  return { text: value, selection: { start: caret, end: caret } };
}
