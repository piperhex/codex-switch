import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type { AuthSession } from '../types';
import type { Skill } from './types';
import type { SkillCatalogStorage } from './skillCatalog';

const MAX_MEMORY_CATALOGS = 64;
const memory = new Map<string, Skill[]>();

export function skillCatalogKey(session: Pick<AuthSession, 'baseUrl' | 'email'>, deviceId: string, cwd: string) {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([
    session.baseUrl.replace(/\/+$/, ''), session.email.trim().toLowerCase(), deviceId, cwd,
  ]))));
}

export function skillCatalogStorage(key: string): SkillCatalogStorage {
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/chat-skills-v1-${key}.json`;
  return {
    peek: () => memory.get(key),
    read: async () => {
      if (!await ReactNativeBlobUtil.fs.exists(path)) return null;
      return JSON.parse(await ReactNativeBlobUtil.fs.readFile(path, 'utf8')) as unknown;
    },
    write: async (skills) => {
      memory.delete(key);
      memory.set(key, skills);
      if (memory.size > MAX_MEMORY_CATALOGS) memory.delete(memory.keys().next().value!);
      await ReactNativeBlobUtil.fs.writeFile(path, JSON.stringify(skills), 'utf8');
    },
  };
}
