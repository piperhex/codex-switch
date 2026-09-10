import { expect, it, vi } from 'vitest';
import { skillCatalogKey, skillCatalogStorage } from './skillCatalogStorage';
import type { Skill } from './types';

const disk = vi.hoisted(() => ({
  exists: vi.fn(), readFile: vi.fn(), writeFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-native-blob-util', () => ({ default: { fs: { ...disk, dirs: { CacheDir: '/private-cache' } } } }));
const account = { baseUrl: 'https://example.test', email: 'test@example.test' };
const skill: Skill = { name: 'review', path: 'C:/skills/review/SKILL.md', description: '检查', enabled: true };

it('isolates cached lists by account, server, computer and project without exposing identity in filenames', () => {
  const key = skillCatalogKey(account, 'pc', 'C:/project');
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  expect(skillCatalogKey({ ...account, baseUrl: account.baseUrl + '/', email: account.email.toUpperCase() },
    'pc', 'C:/project')).toBe(key);
  expect(new Set([
    key, skillCatalogKey({ ...account, baseUrl: 'https://other.test' }, 'pc', 'C:/project'),
    skillCatalogKey({ ...account, email: 'other@test' }, 'pc', 'C:/project'),
    skillCatalogKey(account, 'other-pc', 'C:/project'), skillCatalogKey(account, 'pc', 'C:/other'),
  ]).size).toBe(5);
});

it('serves memory on remount and reloads the persisted catalog after an app restart', async () => {
  const key = skillCatalogKey(account, 'pc', 'C:/project');
  const storage = skillCatalogStorage(key);
  await storage.write([skill]);
  expect(skillCatalogStorage(key).peek()).toEqual([skill]);
  expect(skillCatalogStorage(skillCatalogKey(account, 'pc', 'C:/other')).peek()).toBeUndefined();
  const path = `/private-cache/chat-skills-v1-${key}.json`;
  expect(disk.writeFile).toHaveBeenCalledWith(path, JSON.stringify([skill]), 'utf8');
  disk.exists.mockResolvedValue(true);
  disk.readFile.mockResolvedValue(JSON.stringify([skill]));
  expect(await storage.read()).toEqual([skill]);
  expect(disk.readFile).toHaveBeenCalledWith(path, 'utf8');
});
