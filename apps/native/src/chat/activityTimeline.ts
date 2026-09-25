import { groupConsecutiveActivities, latestActivity } from '../../../desktop/src/pages/codexGui/activityGroups';
import type { Item, Turn } from './types';
import type { TurnEntry, WorkEntry } from './turnPresentation';

export { latestActivity };
export interface ActivityEntry { id: string; kind: 'activities'; turn: Turn; items: Item[] }
export type TimelineEntry = TurnEntry | ActivityEntry;

const activityCache = new WeakMap<WorkEntry, TimelineEntry[]>();

function workActivities(work: WorkEntry): TimelineEntry[] {
  const cached = activityCache.get(work);
  if (cached) return cached;
  const entries = groupConsecutiveActivities(work.items).map((group): TimelineEntry => {
    if (group.activity && group.items.length > 1) return {
      id: `${work.turn.id}:activities:${group.key}`, kind: 'activities', turn: work.turn, items: group.items,
    };
    return { id: `${work.turn.id}:message:${group.key}`, kind: 'process', turn: work.turn, item: group.items[0] };
  });
  activityCache.set(work, entries);
  return entries;
}

/** Match desktop tool grouping while keeping commentary and reasoning in chronological order. */
export function activityTimeline(entries: TurnEntry[]): TimelineEntry[] {
  return entries.flatMap((entry): TimelineEntry[] => {
    if (entry.kind === 'process') return [];
    if (entry.kind === 'work' && entry.inline) return [entry, ...workActivities(entry)];
    return [entry];
  });
}

/** Resolve against all work, even after completion folds it or an older page extends the group. */
export function findActivityEntry(entries: TurnEntry[], id: string): ActivityEntry | undefined {
  for (const entry of entries) {
    if (entry.kind !== 'work') continue;
    const activity = workActivities(entry).find((group): group is ActivityEntry => group.kind === 'activities'
      && (group.id === id || group.items.some(item => `${group.turn.id}:activities:${item.id}` === id)));
    if (activity) return activity;
  }
  return undefined;
}
