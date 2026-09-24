import type { Item, Thread, Turn } from '../types';
import { contentHash } from '../../../../../shared/remote-chat/historySync';
import type { PrepareHistoryObject } from '../../../../../shared/remote-chat/client/historyPreparation';

export const THREAD_CHAR_LIMIT = 2 * 1024 * 1024;
export const HISTORY_CHAR_LIMIT = 16 * 1024 * 1024;
export const IMAGE_CHAR_LIMIT = 24 * 1024 * 1024;
export const IMAGE_COUNT_LIMIT = 128;
export const THREAD_COUNT_LIMIT = 20;
const MAX_ROWS = 2000;
const PREPARE_BATCH_SIZE = 16;

export interface MessageRecord {
  position: number; turn: string; item: string; turn_data: string; data: string; size: number; signature: string;
}

/** Weak keys reuse serialization for unchanged messages without retaining old conversations. */
export class RecordEncoder {
  private encoded = new WeakMap<Item, { data: string; hash: string }>();
  constructor(private readonly prepare?: PrepareHistoryObject) {}
  encode(thread: Thread): Omit<MessageRecord, 'position'>[] | Promise<Omit<MessageRecord, 'position'>[]> {
    if (this.prepare) return encodePreparedRecords(thread, this.prepare);
    const rows: Omit<MessageRecord, 'position'>[] = [];
    let size = 0;
    for (const turn of [...(thread.turns ?? [])].reverse()) {
      const { items, ...metadata } = turn;
      const turn_data = JSON.stringify(metadata);
      const turnHash = contentHash(turn_data);
      for (const item of [...(items.length ? items : [null])].reverse()) {
        const { data, hash } = item ? this.item(item) : { data: 'null', hash: '' };
        const chars = data.length + turn_data.length;
        // Retain a contiguous suffix. Never imply that a gap contains no messages.
        if (size + chars > THREAD_CHAR_LIMIT || rows.length >= MAX_ROWS) return rows.reverse();
        rows.push({ turn: turn.id, item: item?.id ?? '', turn_data, data,
          size: chars, signature: `${turnHash}:${hash}` });
        size += chars;
      }
    }
    return rows.reverse();
  }
  private item(item: Item) {
    const known = this.encoded.get(item);
    if (known) return known;
    const data = JSON.stringify(item);
    const encoded = { data, hash: contentHash(data) };
    this.encoded.set(item, encoded);
    return encoded;
  }
}

async function encodePreparedRecords(thread: Thread, prepare: PrepareHistoryObject) {
  const rows: Omit<MessageRecord, 'position'>[] = [];
  let size = 0;
  for (const turn of [...(thread.turns ?? [])].reverse()) {
    const metadata = await prepare(turn, 'items');
    for await (const { item, record } of preparedItems(turn.items, prepare)) {
      const chars = record.data.length + metadata.data.length;
      if (size + chars > THREAD_CHAR_LIMIT || rows.length >= MAX_ROWS) return rows.reverse();
      rows.push({ turn: turn.id, item: item?.id ?? '', turn_data: metadata.data, data: record.data,
        size: chars, signature: `${metadata.hash}:${record.hash}` });
      size += chars;
    }
  }
  return rows.reverse();
}

async function* preparedItems(items: Item[], prepare: PrepareHistoryObject) {
  const reversed = [...(items.length ? items : [null])].reverse();
  for (let offset = 0; offset < reversed.length; offset += PREPARE_BATCH_SIZE) {
    const batch = await Promise.all(reversed.slice(offset, offset + PREPARE_BATCH_SIZE).map(async (item) => ({
      item, record: item ? await prepare(item) : { data: 'null', hash: '' },
    })));
    yield* batch;
  }
}

export function decodeRecords(metadata: string, rows: MessageRecord[]): Thread {
  const thread = JSON.parse(metadata) as Thread;
  if (!thread || typeof thread.id !== 'string') throw new Error('Invalid cached conversation');
  const turns: Turn[] = [];
  for (const row of rows) {
    let turn = turns[turns.length - 1];
    if (turn?.id !== row.turn) {
      turn = { ...JSON.parse(row.turn_data) as Turn, items: [] };
      if (turn.id !== row.turn) throw new Error('Invalid cached turn');
      turns.push(turn);
    }
    const item = JSON.parse(row.data) as Item | null;
    if (item) turn.items.push(item);
  }
  return { ...thread, turns };
}
