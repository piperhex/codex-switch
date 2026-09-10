import type { ComposerText, Skill } from '../../../apps/desktop/src/pages/codexGui/types';

export interface TextSelection { start: number; end: number }
export interface ComposerTrigger extends TextSelection { query: string; skillsOnly: boolean }
export const emptySkillDraft = (): ComposerText => ({ text: '', mentions: [] });

export function composerTrigger(text: string, selection: TextSelection): ComposerTrigger | null {
  if (selection.start !== selection.end) return null;
  const match = text.slice(0, selection.start).match(/(?:^|\s)([/$])([^\s/$]*)$/u);
  if (!match) return null;
  return { start: selection.start - match[2].length - 1, end: selection.start,
    query: match[2], skillsOnly: match[1] === '$' };
}

/** Keep a reference only while its original token survives an edit unchanged. */
export function editSkillDraft(draft: ComposerText, text: string): ComposerText {
  let start = 0;
  while (start < draft.text.length && start < text.length && draft.text[start] === text[start]) start += 1;
  let end = draft.text.length;
  let nextEnd = text.length;
  while (end > start && nextEnd > start && draft.text[end - 1] === text[nextEnd - 1]) { end -= 1; nextEnd -= 1; }
  const offset = nextEnd - end;
  const mentions = draft.mentions.flatMap((mention) => {
    if (mention.end <= start) return [mention];
    if (mention.start >= end) return [{ ...mention, start: mention.start + offset, end: mention.end + offset }];
    return [];
  }).filter((mention) => !/[\p{L}\p{N}_-]/u.test(text[mention.end] ?? '')
    && (mention.start === 0 || /\s/u.test(text[mention.start - 1])));
  return { text, mentions };
}

export function insertDraftSkill(draft: ComposerText, range: TextSelection, skill: Skill): ComposerText {
  if (!skill.enabled) return draft;
  const prefix = range.start > 0 && !/\s/u.test(draft.text[range.start - 1]) ? ' ' : '';
  const token = `$${skill.name}`;
  const text = draft.text.slice(0, range.start) + prefix + token + ' ' + draft.text.slice(range.end);
  const source = { ...draft, mentions: draft.mentions.filter((mention) =>
    mention.end <= range.start || mention.start >= range.end) };
  const updated = editSkillDraft(source, text);
  const start = range.start + prefix.length;
  return { text, mentions: [...updated.mentions, { start, end: start + token.length, skill }]
    .sort((left, right) => left.start - right.start) };
}

export function draftSkills(draft: ComposerText) {
  return [...new Map(draft.mentions.map(({ skill }) => [skill.path, { name: skill.name, path: skill.path }])).values()];
}
