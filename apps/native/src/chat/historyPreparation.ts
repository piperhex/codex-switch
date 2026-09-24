import { NativeModules, Platform } from 'react-native';
import type { PrepareHistoryObject, PreparedHistoryObject }
  from '../../../../shared/remote-chat/client/historyPreparation';

interface HistoryWorker { prepare(json: string[]): Promise<Omit<PreparedHistoryObject, 'data'>[]> }
interface PendingObject {
  value: object; omit?: string;
  resolve: (value: PreparedHistoryObject) => void; reject: (error: unknown) => void;
}
const BATCH_CHARS = 128 * 1024;
const BATCH_OBJECTS = 16;
const SERIALIZE_BUDGET_MS = 4;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One worker call at a time; yield between bridge batches so touch events can run during a large sync. */
export function createHistoryPreparer(): PrepareHistoryObject | undefined {
  const worker = Platform.OS === 'android' ? NativeModules.ChatHistoryWorker as HistoryWorker | undefined : undefined;
  if (!worker) return undefined;
  const cache = new WeakMap<object, Map<string, Promise<PreparedHistoryObject>>>();
  const pending: PendingObject[] = [];
  let running = false;

  async function drain() {
    while (pending.length) {
      await pause();
      const batch = serializeBatch(pending);
      try {
        const results = await worker!.prepare(batch.map((entry) => entry.data));
        if (results.length !== batch.length) throw new Error('聊天记录处理未完成，请重试。');
        batch.forEach((entry, index) => entry.task.resolve({ ...results[index], data: entry.data }));
      } catch (error) { batch.forEach(({ task }) => task.reject(error)); }
    }
    running = false;
  }

  return (value, omit = '') => {
    let entries = cache.get(value);
    if (!entries) { entries = new Map(); cache.set(value, entries); }
    let known = entries.get(omit);
    if (known) return known;
    known = new Promise<PreparedHistoryObject>((resolve, reject) => {
      pending.push({ value, omit, resolve, reject });
    }).catch((error: unknown) => { entries.delete(omit); throw error; });
    entries.set(omit, known);
    if (!running) { running = true; void drain(); }
    return known;
  };
}

function serializeBatch(pending: PendingObject[]) {
  const batch: { task: PendingObject; data: string }[] = [];
  let chars = 0;
  const started = performance.now();
  while (pending.length && batch.length < BATCH_OBJECTS && chars < BATCH_CHARS) {
    const task = pending.shift()!;
    try {
      // Only bridge serialization remains in JS; canonicalization and both digests run on the worker.
      const value = task.omit ? Object.fromEntries(Object.entries(task.value).filter(([key]) => key !== task.omit))
        : task.value;
      const data = JSON.stringify(value);
      batch.push({ task, data });
      chars += data.length;
    } catch (error) { task.reject(error); }
    if (performance.now() - started >= SERIALIZE_BUDGET_MS) break;
  }
  return batch;
}
