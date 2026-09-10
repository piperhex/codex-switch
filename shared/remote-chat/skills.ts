import type { Skill, SkillsResponse } from './client/types';

export const skillLabel = (skill: Skill) => skill.interface?.displayName || skill.name;
export const skillDescription = (skill: Skill) =>
  skill.interface?.shortDescription || skill.shortDescription || skill.description;

function isSkill(value: unknown): value is Skill {
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return ['name', 'path', 'description'].every((key) => typeof fields[key] === 'string')
    && typeof fields.enabled === 'boolean';
}

/** Transfer and cache menu text and references without potentially large embedded icons. */
export function normalizeSkills(value: unknown): Skill[] {
  if (!Array.isArray(value)) throw new Error('暂时无法读取技能列表。');
  const skills = value.map((skill: unknown): Skill => {
    if (!isSkill(skill)) throw new Error('暂时无法读取技能列表。');
    const label = skill.interface?.displayName;
    const description = skill.interface?.shortDescription ?? skill.shortDescription;
    return { name: skill.name, path: skill.path, description: skill.description, enabled: skill.enabled,
      interface: { displayName: typeof label === 'string' ? label : undefined,
        shortDescription: typeof description === 'string' ? description : undefined } };
  });
  return [...new Map(skills.map((skill) => [skill.path, skill])).values()]
    .sort((left, right) => skillLabel(left).localeCompare(skillLabel(right)));
}

export function remoteSkills(response: SkillsResponse): SkillsResponse {
  return { data: response.data.map((entry) => ({ skills: normalizeSkills(entry.skills),
    errors: entry.errors.map(() => ({ message: '部分技能暂未加载。' })) })) };
}
