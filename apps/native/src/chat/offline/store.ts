import type { SQLiteDatabase } from 'expo-sqlite';
import type { AuthSession } from '../../types';
import type { Thread } from '../types';
import type { CachedConversation, OfflineHistoryStore } from '../../../../../shared/remote-chat/client/offline';
import type { HistoryWindow } from '../../../../../shared/remote-chat/historyPage';
import type { PrepareHistoryObject } from '../../../../../shared/remote-chat/client/historyPreparation';
import { getChatPolicy } from '../../../../../shared/remote-chat/policy';
import { cacheTransaction, withCache } from './database';
import { decodeRecords, RecordEncoder, type MessageRecord, HISTORY_CHAR_LIMIT,
  THREAD_CHAR_LIMIT, THREAD_COUNT_LIMIT, IMAGE_CHAR_LIMIT, IMAGE_COUNT_LIMIT } from './records';

interface ConversationRow { metadata: string; archived: number }
export function accountScope(session: Pick<AuthSession, 'baseUrl' | 'email'>) {
  return JSON.stringify([session.baseUrl.trim().replace(/\/+$/, ''), session.email.trim().toLowerCase()]);
}

export class SqliteHistoryStore implements OfflineHistoryStore {
  private readonly scope: string;
  private readonly encoder: RecordEncoder;
  constructor(session: Pick<AuthSession, 'baseUrl' | 'email'>, deviceId: string, prepare?: PrepareHistoryObject) {
    this.scope = JSON.stringify([accountScope(session), deviceId]);
    this.encoder = new RecordEncoder(prepare);
  }
  list = () => withCache(async (db) => {
    const rows = await db.getAllAsync<ConversationRow>(
      'SELECT metadata, archived FROM conversations WHERE scope = ? ORDER BY touched DESC', this.scope);
    return rows.map((row) => ({ thread: decodeRecords(row.metadata, []), archived: Boolean(row.archived) }));
  });

  read = (id: string, window: HistoryWindow) => withCache(async (db): Promise<CachedConversation | null> => {
    const scope = [this.scope, id];
    const conversation = await db.getFirstAsync<ConversationRow>(
      'SELECT metadata, archived FROM conversations WHERE scope = ? AND id = ?', scope);
    if (!conversation) return null;
    const anchor = window.start && await db.getFirstAsync<{ position: number }>(
      'SELECT position FROM messages WHERE scope = ? AND thread = ? AND turn = ? AND item = ?',
      [...scope, window.start.turnId, window.start.itemId]);
    const previous = await db.getAllAsync<Pick<MessageRecord, 'position'>>(
      `SELECT position FROM messages WHERE scope = ? AND thread = ? AND position < ? ORDER BY position DESC LIMIT ?`,
      [...scope, anchor?.position ?? Number.MAX_SAFE_INTEGER,
        anchor && !window.older ? 0 : getChatPolicy().historyPageSize]);
    const start = previous[previous.length - 1]?.position ?? anchor?.position ?? 0;
    const rows = await db.getAllAsync<MessageRecord>(
      'SELECT * FROM messages WHERE scope = ? AND thread = ? AND position >= ? ORDER BY position', [...scope, start]);
    const more = await db.getFirstAsync<{ position: number }>(
      'SELECT position FROM messages WHERE scope = ? AND thread = ? AND position < ? LIMIT 1', [...scope, start]);
    const first = rows.find((row) => row.item);
    await db.runAsync('UPDATE conversations SET touched = ? WHERE scope = ? AND id = ?', [Date.now(), ...scope]);
    return { thread: decodeRecords(conversation.metadata, rows), archived: Boolean(conversation.archived),
      page: { hasMore: Boolean(more), start: first ? { turnId: first.turn, itemId: first.item } : undefined } };
  });

  save = (value: CachedConversation) => withCache(async (db) => {
    const rows = await this.encoder.encode(value.thread);
    const { turns: _turns, ...metadata } = value.thread;
    const json = JSON.stringify(metadata);
    if (json.length > THREAD_CHAR_LIMIT || (!rows.length && value.thread.turns?.some((turn) => turn.items.length))) {
      throw new Error('Conversation exceeds cache limit');
    }
    await cacheTransaction(db, async (tx) => {
      await tx.runAsync(`INSERT INTO conversations (scope, id, metadata, archived, touched)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET
        metadata = excluded.metadata, archived = excluded.archived, touched = excluded.touched`,
      [this.scope, value.thread.id, json, Number(value.archived), Date.now()]);
      await this.writeRows(tx, value, rows);
      await pruneHistory(tx);
    });
  });

  private async writeRows(db: SQLiteDatabase, value: CachedConversation, rows: Omit<MessageRecord, 'position'>[]) {
    const scope = [this.scope, value.thread.id];
    const first = rows[0];
    const anchor = first && await db.getFirstAsync<{ position: number }>(
      'SELECT position FROM messages WHERE scope = ? AND thread = ? AND turn = ? AND item = ?',
      [...scope, first.turn, first.item]);
    // A page without overlap can be a compacted/replaced history. Drop the old range to avoid phantom messages.
    const start = value.page.hasMore && anchor ? anchor.position : 0;
    await db.runAsync(`DELETE FROM messages WHERE scope = ? AND thread = ? AND (position >= ? OR position < ?)`,
      [...scope, start + rows.length, value.page.hasMore && anchor ? Number.MIN_SAFE_INTEGER : start]);
    await this.upsertRows(db, { scope, start, rows });
    await db.runAsync(`DELETE FROM messages WHERE scope = ? AND thread = ? AND position NOT IN (
      SELECT position FROM (SELECT position, SUM(size) OVER (ORDER BY position DESC) AS total
        FROM messages WHERE scope = ? AND thread = ?) WHERE total <= ?)`, [...scope, ...scope, THREAD_CHAR_LIMIT]);
  }

  private async upsertRows(db: SQLiteDatabase, options: {
    scope: string[]; start: number; rows: Omit<MessageRecord, 'position'>[];
  }) {
    const { scope, start, rows } = options;
    const known = await db.getAllAsync<Pick<MessageRecord, 'position' | 'signature'>>(
      'SELECT position, signature FROM messages WHERE scope = ? AND thread = ? AND position >= ?', [...scope, start]);
    const signatures = new Map(known.map((row) => [row.position, row.signature]));
    for (const [index, row] of rows.entries()) {
      if (signatures.get(start + index) === row.signature) continue;
      await db.runAsync(`INSERT OR REPLACE INTO messages
        (scope, thread, position, turn, item, turn_data, data, size, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...scope, start + index, row.turn, row.item, row.turn_data, row.data, row.size, row.signature]);
    }
    // Earlier cached items in the same turn must receive the terminal turn status too.
    for (const row of new Map(rows.map((entry) => [entry.turn, entry])).values()) {
      await db.runAsync(`UPDATE messages SET size = size - LENGTH(turn_data) + LENGTH(?),
        turn_data = ?, signature = '' WHERE scope = ? AND thread = ? AND turn = ? AND turn_data <> ?`,
      [row.turn_data, row.turn_data, ...scope, row.turn, row.turn_data]);
    }
  }

  remove = (id: string) => withCache(async (db) => {
    await db.runAsync('DELETE FROM conversations WHERE scope = ? AND id = ?', [this.scope, id]);
  });

  updateSummaries = (threads: Thread[], archived: boolean) => withCache(async (db) => {
    await cacheTransaction(db, async (tx) => {
      for (const { turns: _turns, ...thread } of threads) {
        const metadata = JSON.stringify(thread);
        if (metadata.length > THREAD_CHAR_LIMIT) continue;
        await tx.runAsync('UPDATE conversations SET metadata = ?, archived = ? WHERE scope = ? AND id = ?',
          [metadata, Number(archived), this.scope, thread.id]);
      }
    });
  });

  readImage = (key: string) => withCache(async (db) => {
    const row = await db.getFirstAsync<{ data: string }>(
      'SELECT data FROM images WHERE scope = ? AND id = ?', [this.scope, key]);
    if (row) await db.runAsync('UPDATE images SET touched = ? WHERE scope = ? AND id = ?',
      [Date.now(), this.scope, key]);
    return row?.data ?? null;
  });

  saveImage = (key: string, url: string) => withCache(async (db) => {
    const size = url.length + key.length;
    if (size > IMAGE_CHAR_LIMIT || !url.startsWith('data:image/')) throw new Error('Image exceeds cache limit');
    await cacheTransaction(db, async (tx) => {
      await tx.runAsync('INSERT OR REPLACE INTO images (scope, id, data, size, touched) VALUES (?, ?, ?, ?, ?)',
        [this.scope, key, url, size, Date.now()]);
      await tx.runAsync(`DELETE FROM images WHERE rowid IN (SELECT rowid FROM
        (SELECT rowid, SUM(size) OVER (ORDER BY touched DESC, rowid DESC) AS total FROM images) WHERE total > ?)`,
      IMAGE_CHAR_LIMIT);
      await tx.runAsync(`DELETE FROM images WHERE rowid NOT IN
        (SELECT rowid FROM images ORDER BY touched DESC, rowid DESC LIMIT ?)`, IMAGE_COUNT_LIMIT);
    });
  });
}

async function pruneHistory(db: SQLiteDatabase) {
  await db.runAsync(`DELETE FROM conversations WHERE rowid NOT IN
    (SELECT rowid FROM conversations ORDER BY touched DESC, rowid DESC LIMIT ?)`, THREAD_COUNT_LIMIT);
  await db.runAsync(`DELETE FROM conversations WHERE rowid IN (SELECT rowid FROM
    (SELECT c.rowid, SUM(LENGTH(c.metadata) + COALESCE(m.size, 0)) OVER
      (ORDER BY c.touched DESC, c.rowid DESC) AS total FROM conversations c LEFT JOIN
      (SELECT scope, thread, SUM(size) AS size FROM messages GROUP BY scope, thread) m
      ON c.scope = m.scope AND c.id = m.thread) WHERE total > ?)`, HISTORY_CHAR_LIMIT);
}
