import { expect, it, vi } from 'vitest';
import { normalizeSkills, SkillCatalog, type SkillCatalogStorage } from './skillCatalog';
import type { Skill, SkillsResponse } from './types';

const skill: Skill = { name: 'review', path: 'C:/skills/review/SKILL.md', description: '检查代码', enabled: true };
const response = (skills: Skill[], errors: { message: string }[] = []): SkillsResponse => ({ data: [{ skills, errors }] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function storage(skills?: Skill[]): SkillCatalogStorage {
  return { peek: () => skills, read: vi.fn().mockResolvedValue(null), write: vi.fn().mockResolvedValue(undefined) };
}

it('immediately serves cached skills during one shared background refresh, then replaces the list', async () => {
  const disk = storage([skill]);
  const catalog = new SkillCatalog(disk);
  const request = deferred<SkillsResponse>();
  const load = vi.fn(() => request.promise);
  const pending = catalog.refresh(load);
  expect(catalog.refresh(load)).toBe(pending);
  expect(load).toHaveBeenCalledOnce();
  expect(catalog.snapshot()).toMatchObject({ skills: [skill], loaded: true, loading: true });
  const updated = { ...skill, name: 'updated', enabled: false };
  request.resolve(response([updated]));
  await pending;
  expect(catalog.snapshot()).toMatchObject({ skills: [expect.objectContaining(updated)], loading: false, error: '' });
  expect(disk.write).toHaveBeenCalledWith(normalizeSkills([updated]));
  await catalog.refresh(async () => response([]));
  expect(catalog.snapshot().skills).toEqual([]);
});

it('hydrates a previous app session while the PC is still loading', async () => {
  const disk = storage();
  vi.mocked(disk.read).mockResolvedValue([skill]);
  const catalog = new SkillCatalog(disk);
  const request = deferred<SkillsResponse>();
  const pending = catalog.refresh(() => request.promise);
  await catalog.hydrate();
  expect(catalog.snapshot()).toMatchObject({ skills: [expect.objectContaining(skill)], loaded: true, loading: true });
  request.resolve(response([]));
  await pending;
});

it('does not let a slow disk read overwrite or delay a fresh PC response', async () => {
  const disk = storage();
  const read = deferred<unknown>();
  vi.mocked(disk.read).mockReturnValue(read.promise);
  const catalog = new SkillCatalog(disk);
  const hydrated = catalog.hydrate();
  await catalog.refresh(async () => response([]));
  read.resolve([skill]);
  await hydrated;
  expect(catalog.snapshot()).toMatchObject({ skills: [], loaded: true, loading: false });
});

it('keeps the cache on failure or partial results and accepts updates to disabled skills', async () => {
  const catalog = new SkillCatalog(storage([skill]));
  await catalog.refresh(async () => { throw new Error('private PC path'); });
  expect(catalog.snapshot()).toMatchObject({ skills: [skill], loading: false });
  expect(catalog.snapshot().error).not.toContain('private');
  await catalog.refresh(async () => response([], [{ message: 'unavailable' }]));
  expect(catalog.snapshot().skills).toMatchObject([skill]);
  await catalog.refresh(async () => response([{ ...skill, enabled: false }], [{ message: 'unavailable' }]));
  expect(catalog.snapshot().skills[0].enabled).toBe(false);
});

it('recovers from corrupt storage and keeps freshly loaded skills if persistence fails', async () => {
  const disk = storage();
  vi.mocked(disk.read).mockResolvedValue([{ name: 'broken' }]);
  vi.mocked(disk.write).mockRejectedValue(new Error('disk full'));
  const catalog = new SkillCatalog(disk);
  await catalog.hydrate();
  expect(catalog.snapshot().loaded).toBe(false);
  await catalog.refresh(async () => response([skill]));
  expect(catalog.snapshot()).toMatchObject({ loaded: true, skills: [expect.objectContaining(skill)], error: '' });
});

it('deduplicates paths without losing same-named skills in different directories and strips icons', () => {
  const named = { ...skill, interface: { displayName: '代码检查', shortDescription: '检查改动' }, iconUrl: 'data:large' };
  const entries = normalizeSkills([skill, named, { ...skill, path: 'C:/other/SKILL.md' }]);
  expect(entries).toHaveLength(2);
  expect(entries.find((entry) => entry.path === skill.path)).toMatchObject({ interface: named.interface });
  expect(entries.some((entry) => entry.iconUrl)).toBe(false);
});
