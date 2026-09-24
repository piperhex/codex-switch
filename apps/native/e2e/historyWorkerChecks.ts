import { NativeModules } from 'react-native';
import { contentHash, historyVersion } from '../../../shared/remote-chat/historySync';
import { createHistoryPreparer } from '../src/chat/historyPreparation';
import type { PreparedHistoryObject } from '../../../shared/remote-chat/client/historyPreparation';

export async function checkHistoryWorker() {
  const prepare = createHistoryPreparer();
  if (!prepare) throw new Error('Android history worker unavailable');
  const inputs = [
    { text: '你好🌍\0\b\f\n\r\t"\\/\u2028\u2029\ud800x\udfff', empty: '' },
    { numbers: [-0, 1e21, 1e-7, 0.000001, 1.2345678901234567, Number.MAX_VALUE, Number.MIN_VALUE],
      nested: { z: [null, true, false, undefined], a: { '🌍': 1, '\ue000': 2, '10': 3, '2': 4 } } },
    { omitted: undefined, nested: { omitted: undefined, value: 3 }, array: [{ x: 2, a: 1 }] },
    { text: 'long 中文 " 🌍 \n '.repeat(60_000) },
  ];
  for (const value of inputs) {
    const actual = await prepare(value);
    const expected = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, { hash: contentHash(entry),
        ...(typeof entry === 'string' ? { length: entry.length } : {}) }]));
    const keys = Object.keys(expected);
    if (actual.hash !== contentHash(JSON.stringify(value)) || actual.data !== JSON.stringify(value)
      || keys.some((key) => actual.fields[key]?.hash !== expected[key].hash
        || actual.fields[key]?.length !== expected[key].length)) {
      throw new Error(`Native history compatibility failed for fixture ${inputs.indexOf(value)}`);
    }
  }
  const worker = NativeModules.ChatHistoryWorker as {
    prepare(json: string[]): Promise<Omit<PreparedHistoryObject, 'data'>[]>;
  };
  for (const invalid of [['{'], Array.from({ length: 17 }, () => '{}')]) {
    let rejected = false;
    try { await worker.prepare(invalid); } catch { rejected = true; }
    if (!rejected) throw new Error('Invalid history input was accepted');
  }
  // Ensure a failed job does not poison the native queue.
  const recovered = await prepare({ id: 'recovery', cwd: '', preview: '', updatedAt: 1 });
  const reference = historyVersion({ id: 'recovery', cwd: '', preview: '', updatedAt: 1 });
  if (recovered.fields.id.hash !== reference.fields.id.hash) {
    throw new Error('History worker failed to recover');
  }
  return { compatibleFixtures: inputs.length, invalidJobsRejected: 2 };
}
