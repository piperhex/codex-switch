export const THREAD_GROUP_PREVIEW_COUNT = 5;

export function previewThreads<T extends { id: string }>(threads: T[], selected: string | null) {
  const preview = threads.slice(0, THREAD_GROUP_PREVIEW_COUNT);
  const active = threads.find((thread) => thread.id === selected);
  if (!active || preview.includes(active)) return preview;
  // Keep the current conversation reachable when older rows are folded away.
  return [...preview.slice(0, THREAD_GROUP_PREVIEW_COUNT - 1), active];
}
