/** Move running chats forward without changing the stored order or either group's relative order. */
export function prioritizeRunningThreads<T>(threads: readonly T[], isRunning: (thread: T) => boolean): T[] {
  const running: T[] = [];
  const idle: T[] = [];
  for (const thread of threads) {
    (isRunning(thread) ? running : idle).push(thread);
  }
  return [...running, ...idle];
}
