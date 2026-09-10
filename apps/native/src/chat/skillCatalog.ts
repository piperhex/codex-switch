import type { Skill, SkillsResponse } from './types';
import { normalizeSkills } from '../../../../shared/remote-chat/skills';
export { normalizeSkills, skillLabel, skillDescription } from '../../../../shared/remote-chat/skills';

export interface SkillCatalogState { skills: Skill[]; loaded: boolean; loading: boolean; error: string }
export interface SkillCatalogStorage {
  peek: () => Skill[] | undefined;
  read: () => Promise<unknown>;
  write: (skills: Skill[]) => Promise<void>;
}
export class SkillCatalog {
  private state: SkillCatalogState;
  private readonly listeners = new Set<() => void>();
  private hydration?: Promise<void>;
  private pending?: Promise<void>;
  private revision = 0;

  constructor(private readonly storage: SkillCatalogStorage) {
    const skills = storage.peek();
    this.state = { skills: skills ?? [], loaded: skills !== undefined, loading: false, error: '' };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(patch: Partial<SkillCatalogState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  hydrate = () => {
    if (this.hydration) return this.hydration;
    const revision = this.revision;
    this.hydration = this.storage.read().then((value) => {
      if (revision === this.revision && value !== null) {
        this.update({ skills: normalizeSkills(value), loaded: true });
      }
    }).catch(() => { /* A missing or corrupt cache is replaced by the next successful refresh. */ });
    return this.hydration;
  };

  refresh = (load: () => Promise<SkillsResponse>) => {
    if (this.pending) return this.pending;
    this.update({ loading: true, error: '' });
    this.pending = this.fetch(load).finally(() => { this.pending = undefined; });
    return this.pending;
  };

  private async fetch(load: () => Promise<SkillsResponse>) {
    try {
      const response = await load();
      const skills = normalizeSkills(response.data.flatMap((entry) => entry.skills));
      const partial = response.data.some((entry) => entry.errors.length > 0);
      // Preserve previous entries when the PC could only read part of the catalog.
      if (partial) await this.hydrate();
      const next = partial ? normalizeSkills([...this.state.skills, ...skills]) : skills;
      this.revision += 1;
      this.update({ skills: next, loaded: true, loading: false,
        error: partial ? '部分技能暂未更新，可继续使用已有列表。' : '' });
      await this.storage.write(next).catch(() => { /* The in-memory catalog remains usable if disk storage fails. */ });
    } catch {
      this.update({ loading: false, error: this.state.loaded
        ? '暂时无法更新，可继续使用已有列表。' : '暂时无法加载技能，请重新打开重试。' });
    }
  }
}
