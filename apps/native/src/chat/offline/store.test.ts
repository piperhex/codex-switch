import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
import type { BindParams, Database } from 'sql.js';
import { accountScope, SqliteHistoryStore } from './store';
import { readDevices, saveDevices } from './devices';
import { THREAD_COUNT_LIMIT, THREAD_CHAR_LIMIT, HISTORY_CHAR_LIMIT, IMAGE_CHAR_LIMIT } from './records';
import type { Thread } from '../types';
import { sliceHistory } from '../../../../../shared/remote-chat/historyPage';
import { DEFAULT_CHAT_POLICY, setChatPolicy } from '../../../../../shared/remote-chat/policy';
import { contentHash } from '../../../../../shared/remote-chat/historySync';

const state = vi.hoisted(() => ({ db: null as Database | null, reads: [] as string[] }));
vi.mock('expo-sqlite', () => {
  function all(sql: string, args: unknown[]) {
    state.reads.push(sql);
    const statement = state.db!.prepare(sql);
    try {
      statement.bind((Array.isArray(args[0]) ? args[0] : args) as BindParams);
      const result = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally { statement.free(); }
  }
  const adapter = {
    execAsync: async (sql: string) => { state.db!.exec(sql); },
    runAsync: async (sql: string, ...args: unknown[]) => { all(sql, args); },
    getAllAsync: async (sql: string, ...args: unknown[]) => all(sql, args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => all(sql, args)[0] ?? null,
    withTransactionAsync: async (operation: () => Promise<void>) => {
      state.db!.exec('BEGIN');
      try { await operation(); state.db!.exec('COMMIT'); }
      catch (error) { state.db!.exec('ROLLBACK'); throw error; }
    },
  };
  return { openDatabaseAsync: async () => adapter };
});

const account = { baseUrl: 'https://cloud.test', email: 'one@example.test' };
const store = () => new SqliteHistoryStore(account, 'pc');
const history = (id = 'chat', count = 35): Thread => ({ id, preview: id, cwd: '/project', updatedAt: 1,
  turns: [{ id: 'turn', status: 'completed', items: Array.from({ length: count }, (_, index) => ({
    id: String(index), type: 'agentMessage', text: `message ${index}`,
  })) }] });
const items = (value: Awaited<ReturnType<SqliteHistoryStore['read']>>) => value?.thread.turns?.flatMap((t) => t.items);
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let empty: Uint8Array;
beforeAll(async () => {
  SQL = await initSqlJs();
  state.db = new SQL.Database();
  await store().list();
  empty = state.db.export();
});
beforeEach(() => {
  state.db?.close(); state.db = new SQL.Database(empty);
  state.db.exec('PRAGMA foreign_keys = ON'); state.reads = [];
});
afterAll(() => state.db?.close());
afterEach(() => setChatPolicy(DEFAULT_CHAT_POLICY));

describe('persistent chat cache using SQLite', () => {
  it('reopens worker-prepared rows with the existing schema and updates terminal turn status', async () => {
    const prepare = vi.fn(async (value: object, omit = '') => {
      const data = JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== omit)));
      return { data, hash: contentHash(data), fields: {} };
    });
    const native = new SqliteHistoryStore(account, 'pc', prepare);
    const thread = history('worker', 25);
    thread.turns![0].status = 'inProgress';
    await native.save({ thread, page: { hasMore: false }, archived: false });
    const reopened = await store().read(thread.id, {});
    expect(items(reopened)).toEqual(thread.turns![0].items.slice(-10));
    const recent = sliceHistory({ ...thread, turns: [{ ...thread.turns![0], status: 'completed' }] });
    await native.save({ ...recent, archived: false });
    const older = await store().read(thread.id, { start: reopened!.page.start, older: true });
    expect(older?.thread.turns?.[0].status).toBe('completed');
    expect(items(older)).toEqual(thread.turns![0].items.slice(-20));
    expect(prepare).toHaveBeenCalled();
  });

  it('loads more than 100 messages per page and applies updated settings to older history', async () => {
    await store().save({ thread: history('chat', 500), page: { hasMore: false }, archived: false });
    setChatPolicy({ ...DEFAULT_CHAT_POLICY, historyPageSize: 150 });
    const recent = await store().read('chat', {});
    expect(items(recent)).toHaveLength(150);
    expect(recent?.page.hasMore).toBe(true);
    setChatPolicy({ ...DEFAULT_CHAT_POLICY, historyPageSize: 200 });
    const older = await store().read('chat', { start: recent?.page.start, older: true });
    expect(items(older)).toHaveLength(350);
    expect(older?.page.hasMore).toBe(true);
    const first = await store().read('chat', { start: older?.page.start, older: true });
    expect(items(first)).toHaveLength(500);
    expect(first?.page.hasMore).toBe(false);
  });

  it('survives reopening and reads only the newest page before loading older records', async () => {
    await store().save({ ...sliceHistory(history(), { start: { turnId: 'turn', itemId: '5' } }), archived: false });
    const bytes = state.db!.export();
    state.db!.close(); state.db = new SQL.Database(bytes); state.db.exec('PRAGMA foreign_keys = ON');
    const reopened = store();
    expect((await reopened.list()).map((entry) => entry.thread.id)).toEqual(['chat']);
    const recent = await reopened.read('chat', {});
    expect(items(recent)?.map((item) => item.id)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 25)));
    expect(recent?.page.hasMore).toBe(true);
    const older = await reopened.read('chat', { start: recent?.page.start, older: true });
    expect(items(older)).toHaveLength(20);
    const first = await reopened.read('chat', { start: older?.page.start, older: true });
    expect(items(first)?.[0].id).toBe('5');
    expect(first?.page.hasMore).toBe(false);
  });

  it('isolates server, account and computer, including cached images', async () => {
    await store().save({ ...sliceHistory(history()), archived: false });
    await store().saveImage('image', 'data:image/png;base64,abc');
    for (const isolated of [new SqliteHistoryStore(account, 'other'),
      new SqliteHistoryStore({ ...account, email: 'two@example.test' }, 'pc'),
      new SqliteHistoryStore({ ...account, baseUrl: 'https://other.test' }, 'pc')]) {
      expect(await isolated.list()).toEqual([]);
      expect(await isolated.read('chat', {})).toBeNull();
      expect(await isolated.readImage('image')).toBeNull();
    }
    expect(await store().readImage('image')).toBe('data:image/png;base64,abc');
  });

  it('preserves previously cached older pages when the latest window changes', async () => {
    const thread = history();
    await store().save({ thread, page: { hasMore: false }, archived: false });
    const latest = history('chat', 37);
    latest.turns![0].items[30].text = 'changed';
    await store().save({ ...sliceHistory(latest), archived: false });
    const all = await store().read('chat', { start: { turnId: 'turn', itemId: '0' } });
    expect(items(all)).toHaveLength(37);
    expect(items(all)?.[30].text).toBe('changed');
  });

  it('replaces deleted or compacted messages without resurrecting the old tail', async () => {
    await store().save({ thread: history(), page: { hasMore: false }, archived: false });
    await store().save({ thread: history('chat', 3), page: { hasMore: false }, archived: true });
    expect(items(await store().read('chat', {}))).toHaveLength(3);
    expect((await store().list())[0].archived).toBe(true);
    const compacted = history('chat', 2);
    compacted.turns![0].id = 'compacted';
    await store().save({ thread: compacted, page: { hasMore: true }, archived: false });
    expect(items(await store().read('chat', {}))).toHaveLength(2);
    await store().remove('chat');
    expect(await store().read('chat', {})).toBeNull();
    expect(state.db!.exec('SELECT COUNT(*) FROM messages')[0].values[0][0]).toBe(0);
  });

  it('bounds history and image storage and keeps the most recently read conversations', async () => {
    for (let index = 0; index < THREAD_COUNT_LIMIT; index++) {
      await store().save({ thread: history(String(index), 1), page: { hasMore: false }, archived: false });
    }
    await store().read('0', {});
    await store().save({ thread: history('new', 1), page: { hasMore: false }, archived: false });
    expect(await store().list()).toHaveLength(THREAD_COUNT_LIMIT);
    expect(await store().read('0', {})).not.toBeNull();
    const big = history('big', 20);
    big.turns![0].items.forEach((item) => { item.text = 'x'.repeat(THREAD_CHAR_LIMIT / 4); });
    await store().save({ thread: big, page: { hasMore: false }, archived: false });
    expect(items(await store().read('big', {}))!.length).toBeLessThan(4);
    const image = `data:image/png;base64,${'x'.repeat(IMAGE_CHAR_LIMIT / 2)}`;
    await store().saveImage('old', image);
    await store().saveImage('new', image);
    expect(await store().readImage('old')).toBeNull();
    expect(await store().readImage('new')).toBe(image);
  });

  it('rolls back a failed write and allows a later retry', async () => {
    await store().save({ thread: history(), page: { hasMore: false }, archived: false });
    state.db!.exec(`CREATE TRIGGER fail_write BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    await expect(store().save({ thread: history('chat', 2), page: { hasMore: false }, archived: false }))
      .rejects.toThrow();
    expect(items(await store().read('chat', {}))).toHaveLength(10);
    state.db!.exec('DROP TRIGGER fail_write');
    await store().save({ thread: history('chat', 2), page: { hasMore: false }, archived: false });
    expect(items(await store().read('chat', {}))).toHaveLength(2);
  });

  it('updates cached titles and archive status without caching unread conversations', async () => {
    await store().save({ thread: history(), page: { hasMore: false }, archived: false });
    await store().updateSummaries([{ ...history(), name: 'renamed' }, history('unread')], true);
    expect(await store().list()).toHaveLength(1);
    const cached = await store().read('chat', {});
    expect(cached?.thread.name).toBe('renamed');
    expect(cached?.archived).toBe(true);
    expect(items(cached)).toHaveLength(10);
  });

  it('does not rewrite unchanged messages on every streaming snapshot', async () => {
    const cache = store();
    const thread = history();
    await cache.save({ thread, page: { hasMore: false }, archived: false });
    state.reads = [];
    await cache.save({ thread: { ...thread, updatedAt: 2 }, page: { hasMore: false }, archived: false });
    expect(state.reads.filter((sql) => sql.includes('INSERT OR REPLACE INTO messages'))).toHaveLength(0);
    thread.turns = [{ ...thread.turns![0], items: thread.turns![0].items.map((item) => item.id === '34'
      ? { ...item, text: 'new delta' } : item) }];
    state.reads = [];
    await cache.save({ thread, page: { hasMore: false }, archived: false });
    expect(state.reads.filter((sql) => sql.includes('INSERT OR REPLACE INTO messages'))).toHaveLength(1);
  });

  it('surfaces corrupted records and recovers when the authoritative history is saved again', async () => {
    await store().save({ thread: history(), page: { hasMore: false }, archived: false });
    state.db!.exec("UPDATE messages SET data = 'corrupt', signature = ''");
    await expect(store().read('chat', {})).rejects.toThrow();
    await store().save({ thread: history(), page: { hasMore: false }, archived: false });
    expect(items(await store().read('chat', {}))).toHaveLength(10);
  });

  it('restores device display metadata only for the signed-in account and marks it offline', async () => {
    await saveDevices(accountScope(account), [{ deviceId: 'pc', name: 'computer', platform: 'Windows',
      online: true, localProxyRunning: true, capabilities: [], lastSeenAt: 'today', activeAccountId: 'private' }]);
    const devices = await readDevices(accountScope(account));
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ deviceId: 'pc', online: false, localProxyRunning: false });
    expect(devices[0].activeAccountId).toBeUndefined();
    expect(await readDevices(accountScope({ ...account, email: 'other' }))).toEqual([]);
  });

  it('replaces device metadata without restoring removed computers after reopening', async () => {
    const device = { deviceId: 'pc', name: 'computer', platform: 'Windows',
      online: false, localProxyRunning: false, capabilities: [], lastSeenAt: 'today' };
    const scope = accountScope(account);
    await saveDevices(scope, [device, { ...device, deviceId: 'deleted' }]);
    await saveDevices(scope, [device]);
    const bytes = state.db!.export();
    state.db!.close(); state.db = new SQL.Database(bytes); state.db.exec('PRAGMA foreign_keys = ON');
    expect((await readDevices(scope)).map((entry) => entry.deviceId)).toEqual(['pc']);
  });

  it('clears the final device without deleting another account or cached conversations', async () => {
    const device = { deviceId: 'pc', name: 'computer', platform: 'Windows',
      online: false, localProxyRunning: false, capabilities: [], lastSeenAt: 'today' };
    const scope = accountScope(account);
    const other = accountScope({ ...account, email: 'other' });
    await store().save({ thread: history(), page: { hasMore: false }, archived: false });
    await saveDevices(scope, [device]);
    await saveDevices(other, [device]);
    await saveDevices(scope, []);
    expect(await readDevices(scope)).toEqual([]);
    expect(await readDevices(other)).toHaveLength(1);
    expect(await store().read('chat', {})).not.toBeNull();
  });

  it('rolls back device cache replacement if saving the new list fails', async () => {
    const device = { deviceId: 'pc', name: 'computer', platform: 'Windows',
      online: false, localProxyRunning: false, capabilities: [], lastSeenAt: 'today' };
    const scope = accountScope(account);
    await saveDevices(scope, [device]);
    state.db!.exec("CREATE TRIGGER fail_devices BEFORE INSERT ON devices BEGIN SELECT RAISE(ABORT, 'full'); END");
    await expect(saveDevices(scope, [{ ...device, deviceId: 'new' }])).rejects.toThrow();
    expect((await readDevices(scope)).map((entry) => entry.deviceId)).toEqual(['pc']);
    state.db!.exec('DROP TRIGGER fail_devices');
    await saveDevices(scope, []);
    expect(await readDevices(scope)).toEqual([]);
  });

  it('enforces the global history budget across computer scopes', async () => {
    for (let index = 0; index < 12; index++) {
      const thread = history('large', 3);
      thread.turns![0].items.forEach((item) => { item.text = 'x'.repeat(THREAD_CHAR_LIMIT / 4); });
      await new SqliteHistoryStore(account, `pc-${index}`).save({ thread, page: { hasMore: false }, archived: false });
    }
    const size = state.db!.exec('SELECT SUM(size) FROM messages')[0].values[0][0] as number;
    expect(size).toBeLessThanOrEqual(HISTORY_CHAR_LIMIT);
    expect(await new SqliteHistoryStore(account, 'pc-0').list()).toEqual([]);
    expect(await new SqliteHistoryStore(account, 'pc-11').list()).toHaveLength(1);
  });
});
