import { expect, it } from 'vitest';
import { composerTrigger, draftSkills, editSkillDraft, emptySkillDraft, insertDraftSkill }
  from '../../../../shared/remote-chat/client/skillDraft';
import type { Skill } from './types';
const skill: Skill = { name: 'review', path: 'C:/skills/review/SKILL.md', description: '检查代码', enabled: true };

it('opens slash and dollar menus at the caret without matching URLs, paths or selected text', () => {
  expect(composerTrigger('请用 /rev 后面', { start: 7, end: 7 })).toEqual({
    start: 3, end: 7, query: 'rev', skillsOnly: false,
  });
  expect(composerTrigger('$review', { start: 7, end: 7 })?.skillsOnly).toBe(true);
  for (const text of ['https://test', 'C:/review', 'a/review', '/review/child']) {
    expect(composerTrigger(text, { start: text.length, end: text.length })).toBeNull();
  }
  expect(composerTrigger('/review', { start: 1, end: 7 })).toBeNull();
});

it('replaces only the trigger and sends the selected PC path even for same-named skills', () => {
  const source = editSkillDraft(emptySkillDraft(), '请用 /rev 检查');
  const draft = insertDraftSkill(source, { start: 3, end: 7 }, skill);
  expect(draft.text).toBe('请用 $review  检查');
  expect(draftSkills(draft)).toEqual([{ name: skill.name, path: skill.path }]);
  const second = { ...skill, path: 'C:/project/SKILL.md' };
  const next = insertDraftSkill(draft, { start: draft.text.length, end: draft.text.length }, second);
  expect(draftSkills(next)).toHaveLength(2);
});

it('preserves intact references across edits and removes modified or deleted mentions', () => {
  const draft = insertDraftSkill(emptySkillDraft(), { start: 0, end: 0 }, skill);
  const inserted = editSkillDraft(draft, `请用 ${draft.text}`);
  const prefixed = editSkillDraft(inserted, `${inserted.text}检查`);
  expect(draftSkills(prefixed)).toHaveLength(1);
  expect(prefixed.mentions[0].start).toBe(3);
  expect(draftSkills(editSkillDraft(prefixed, '请用 $reviewer 检查'))).toEqual([]);
  expect(draftSkills(editSkillDraft(prefixed, '请用 检查'))).toEqual([]);
  expect(draftSkills(editSkillDraft(prefixed, '请用$review 检查'))).toEqual([]);
  expect(draftSkills(editSkillDraft(emptySkillDraft(), '$review 手动输入'))).toEqual([]);
});

it('does not insert disabled skills or duplicate a reference selected twice', () => {
  const empty = emptySkillDraft();
  expect(insertDraftSkill(empty, { start: 0, end: 0 }, { ...skill, enabled: false })).toBe(empty);
  const first = insertDraftSkill(empty, { start: 0, end: 0 }, skill);
  const repeated = insertDraftSkill(first, { start: first.text.length, end: first.text.length }, skill);
  expect(draftSkills(repeated)).toHaveLength(1);
  const replacement = { ...skill, path: 'C:/other/SKILL.md' };
  expect(draftSkills(insertDraftSkill(first, { start: 0, end: 7 }, replacement)))
    .toEqual([{ name: replacement.name, path: replacement.path }]);
});
