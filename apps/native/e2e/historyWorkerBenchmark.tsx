import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { HistoryVersionCache } from '../../../shared/remote-chat/historySync';
import { AsyncHistoryVersionCache } from '../../../shared/remote-chat/client/historyPreparation';
import { createHistoryPreparer } from '../src/chat/historyPreparation';
import { RecordEncoder } from '../src/chat/offline/records';
import type { Thread } from '../src/chat/types';
import { checkHistoryWorker } from './historyWorkerChecks';

const pause = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const report = (value: object) => console.log('HISTORY_BENCHMARK', JSON.stringify(value));

function fixture(count: number, chars: number): Thread {
  const text = '工具输出 中文🌍 \n'.repeat(Math.ceil(chars / 12)).slice(0, chars);
  return { id: 'isolated-benchmark', cwd: '', preview: '', updatedAt: 1, turns: [
    { id: 'turn', status: 'completed', items: Array.from({ length: count }, (_, index) => ({
      id: `item-${index}`, type: 'commandExecution', aggregatedOutput: text, status: 'completed',
    })) },
  ] };
}

async function measure(operation: () => unknown | Promise<unknown>) {
  let previous = performance.now();
  let maxGapMs = 0;
  let beats = 0;
  const timer = setInterval(() => {
    const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - previous); previous = now; beats++;
  }, 16);
  await pause(50);
  const start = performance.now();
  const result = await operation();
  const elapsedMs = performance.now() - start;
  await pause(50);
  clearInterval(timer);
  return { elapsedMs, maxGapMs, beats, result };
}

async function compare(thread: Thread, nativeFirst: boolean) {
  const prepare = createHistoryPreparer()!;
  const versions = new AsyncHistoryVersionCache(prepare);
  const records = new RecordEncoder(prepare);
  const portable = () => measure(async () => ({ version: new HistoryVersionCache().read(thread),
    rows: await new RecordEncoder().encode(thread) }));
  const native = () => measure(async () => ({
    version: await versions.read(thread), rows: await records.encode(thread),
  }));
  const first = await (nativeFirst ? native() : portable());
  const second = await (nativeFirst ? portable() : native());
  const [js, android] = nativeFirst ? [second, first] : [first, second];
  if (JSON.stringify(js.result) !== JSON.stringify(android.result)) {
    // Map key order across the bridge is unspecified; compare values through the reference's ordering.
    const normalize = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
    if (normalize(js.result) !== normalize(android.result)) throw new Error('History results differ');
  }
  const warm = await native();
  const metrics = ({ result: _result, ...timing }: Awaited<ReturnType<typeof measure>>) => timing;
  return { items: thread.turns![0].items.length, chars: JSON.stringify(thread).length, nativeFirst,
    js: metrics(js), android: metrics(android), warm: metrics(warm), equal: true };
}

async function run() {
  report({ checks: await checkHistoryWorker() });
  for (const [count, chars] of [[10, 100_000], [128, 8_000], [1, 1_000_000]]) {
    for (const nativeFirst of [false, true]) report(await compare(fixture(count, chars), nativeFirst));
  }
  report({ done: true });
}

function App() {
  const [status, setStatus] = useState('正在检查聊天同步性能…');
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setBeats((value) => value + 1), 100);
    void run().then(() => setStatus('检查完成')).catch((error: unknown) => {
      report({ error: String(error) }); setStatus(String(error));
    }).finally(() => clearInterval(timer));
    return () => clearInterval(timer);
  }, []);
  return <ScrollView style={{ padding: 30, paddingTop: 80 }}><Text>{status}</Text><Text>{beats}</Text></ScrollView>;
}

registerRootComponent(App);
