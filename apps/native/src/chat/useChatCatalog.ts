import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AuthSession } from '../types';
import type { ChatController } from './controller';
import type { ChatState } from './types';
import { SkillCatalog } from './skillCatalog';
import { skillCatalogKey, skillCatalogStorage } from './skillCatalogStorage';

export function useChatCatalog({ session, deviceId, controller, state }: {
  session: AuthSession; deviceId: string; controller: ChatController; state: ChatState;
}) {
  const cwd = state.selected?.cwd ?? state.draftProject?.cwd ?? '';
  const key = useMemo(() => skillCatalogKey(session, deviceId, cwd), [session.baseUrl, session.email, deviceId, cwd]);
  const catalog = useMemo(() => new SkillCatalog(skillCatalogStorage(key)), [key, controller]);
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.snapshot);
  useEffect(() => { void catalog.hydrate(); }, [catalog]);
  const refresh = useCallback(() => {
    if (state.ready) void catalog.refresh(() => controller.loadSkills(cwd));
  }, [catalog, controller, cwd, state.ready]);
  // Connection and project changes prefetch before the user opens the menu.
  useEffect(refresh, [refresh]);
  return { ...snapshot, refresh };
}
