// A range change queues one fresh read; timer ticks never overlap an active read.
export function createDashboardLoader() {
  let running = false;
  let pending: (() => Promise<void>) | undefined;
  const run = async (task: () => Promise<void>, replacePending = false): Promise<void> => {
    if (running) {
      if (replacePending) pending = task;
      return;
    }
    running = true;
    try {
      await task();
    } finally {
      running = false;
      const next = pending;
      pending = undefined;
      if (next) await run(next);
    }
  };
  return run;
}
