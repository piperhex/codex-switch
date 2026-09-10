import { useMemo, useState } from 'react';
import { previewThreads, THREAD_GROUP_PREVIEW_COUNT } from '../../chat/threadGroupPreview';
import { projectThreadGroups } from '../sidebar';
import type { ChatState } from './types';

export function useThreadGroups(state: ChatState) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const filtering = Boolean(state.search.trim());
  const groups = useMemo(() => projectThreadGroups(state.threads, state.sidebar).map((group) => {
    const showAll = filtering || expanded.has(group.cwd);
    return { ...group, expanded: showAll, canToggle: !filtering && group.data.length > THREAD_GROUP_PREVIEW_COUNT,
      data: showAll ? group.data : previewThreads(group.data, state.selected?.id ?? null) };
  }), [state.threads, state.sidebar, state.selected?.id, filtering, expanded]);
  const toggle = (cwd: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(cwd)) next.delete(cwd);
    else next.add(cwd);
    return next;
  });
  return { groups, toggle };
}
