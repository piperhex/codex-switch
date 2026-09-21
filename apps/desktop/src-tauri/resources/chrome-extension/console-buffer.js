const DEFAULT_LIMIT = 100;
const MAX_RESULT_CHARACTERS = 100000;

// Keep the newest timestamps across independently replayed page and worker sessions.
export function createLogBuffer(args) {
  const entries = [];
  let size = 0;
  let truncated = false;
  return {
    add(entry) {
      if (!entry || (args.level && args.level !== 'all' && entry.level !== args.level)) return;
      if (args.source && args.source !== 'all' && entry.source !== args.source) return;
      const length = JSON.stringify(entry).length + 1;
      entries.push({ entry, length });
      entries.sort((left, right) => left.entry.timestamp - right.entry.timestamp);
      size += length;
      truncated ||= entry.truncated;
      while (entries.length > (args.limit ?? DEFAULT_LIMIT) || size > MAX_RESULT_CHARACTERS) {
        size -= entries.shift().length;
        truncated = true;
      }
    },
    result: () => ({ entries: entries.map(item => item.entry), truncated }),
  };
}
