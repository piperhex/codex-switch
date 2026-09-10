import type { Skill } from '../src/pages/codexGui/types';

let revision = 1;
let delay = 0;
export function setDemoSkills(input: { revision?: number; delay?: number }) {
  revision = input.revision ?? revision;
  delay = Math.max(0, Math.min(20_000, input.delay ?? delay));
}
export const demoSkillsDelay = () => delay;
export function demoSkills() {
  const skills: Skill[] = [
    { name: 'review', path: 'F:/skills/review/SKILL.md', description: '检查代码改动', enabled: true,
      interface: { displayName: revision === 1 ? '代码检查' : '代码检查（已更新）' } },
    { name: 'disabled', path: 'F:/skills/disabled/SKILL.md', description: '暂不可用', enabled: false },
  ];
  return { data: [{ skills, errors: [] }] };
}
