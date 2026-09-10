import type { Thread } from './client/types';

export const SIDEBAR_EVENT = 'chat/sidebar/updated';
export interface ThreadReadReceipt { turnId: string; unread: boolean }
export interface SidebarThread {
  cwd: string;
  projectName: string;
  title: string;
  running: boolean;
}
export interface SidebarSnapshot {
  revision: number;
  threads: Record<string, SidebarThread>;
  readState: Record<string, ThreadReadReceipt>;
}
export const emptySidebar = (): SidebarSnapshot => ({ revision: -1, threads: {}, readState: {} });

export function threadPresentation(thread: Thread, sidebar: SidebarSnapshot) {
  const entry = sidebar.threads[thread.id];
  const cwd = entry?.cwd ?? thread.cwd;
  return {
    cwd, title: entry?.title || thread.name || thread.preview || '新聊天',
    projectName: entry?.projectName || cwd?.split(/[\\/]/).filter(Boolean).at(-1) || '最近',
    running: entry?.running ?? (thread.status?.type === 'active'
      || thread.turns?.some((turn) => turn.status === 'inProgress') === true),
    unread: sidebar.readState[thread.id]?.unread ?? false,
  };
}

export function projectThreadGroups(threads: Thread[], sidebar: SidebarSnapshot) {
  const groups = new Map<string, { cwd: string; label: string; data: Thread[] }>();
  for (const thread of threads) {
    const { cwd, projectName } = threadPresentation(thread, sidebar);
    const group = groups.get(cwd) ?? { cwd, label: projectName, data: [] };
    group.data.push(thread);
    groups.set(cwd, group);
  }
  return [...groups.values()];
}
