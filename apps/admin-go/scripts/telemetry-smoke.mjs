import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { request } from './parity-client.mjs';
import { fixtureDatabase } from './seed-parity.mjs';

// Fixed local fixtures only. This script cannot target production.
const base = 'http://127.0.0.1:28081';
const require = createRequire(new URL('../testdata/tools/package.json', import.meta.url));
const Redis = require('ioredis');
const redis = new Redis({ host: '127.0.0.1', port: 16380, lazyConnect: true });
const db = await fixtureDatabase('admin_go');
const deviceIds = [];
const endpoint = '/telemetry/installations';

function device() {
  const id = randomUUID();
  deviceIds.push(id);
  return id;
}

async function clearFixtureLimits() {
  // The dedicated local parity Redis contains synthetic fixture data only.
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'telemetry:limits:v1:*', 'COUNT', 100);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}

async function report(id, type, overrides = {}) {
  return request(base, 'POST', endpoint, { body: {
    deviceId: id, platform: 'windows', appVersion: '1.5.43', eventType: type, ...overrides,
  } });
}

async function counts(id) {
  const result = await db.query(`SELECT
    (SELECT count(*)::int FROM device_installations WHERE "deviceId"=$1) AS installations,
    (SELECT count(*)::int FROM device_telemetry_events WHERE "deviceId"=$1) AS events`, [id]);
  return result.rows[0];
}

async function verifyRegistrationAndActivity() {
  const id = device();
  for (const type of ['activity', 'base_url_changed']) assert.equal((await report(id, type)).status, 200);
  assert.deepEqual(await counts(id), { installations: 0, events: 0 });
  assert.equal((await report(id, 'installation')).status, 200);
  const original = (await db.query('SELECT * FROM device_installations WHERE "deviceId"=$1', [id])).rows[0];
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => report(id, 'activity')));
  for (const response of concurrent) assert.equal(response.status, 200);
  assert.deepEqual(await counts(id), { installations: 1, events: 1 });
  assert.equal((await report(id, 'activity', { appVersion: '0.1.0', platform: 'linux' })).status, 200);
  let current = (await db.query('SELECT * FROM device_installations WHERE "deviceId"=$1', [id])).rows[0];
  assert.equal(current.appVersion, original.appVersion);
  assert.equal(current.platform, 'windows');
  assert.equal((await report(id, 'installation', { appVersion: '1.5.44' })).status, 200);
  current = (await db.query('SELECT * FROM device_installations WHERE "deviceId"=$1', [id])).rows[0];
  assert.equal(current.appVersion, '1.5.44');
  assert.equal(current.firstSeenAt.getTime(), original.firstSeenAt.getTime());
  await db.query(`UPDATE device_telemetry_events SET "createdAt"="createdAt"-interval '1 day'
    WHERE "deviceId"=$1`, [id]);
  assert.equal((await report(id, 'activity')).status, 200);
  assert.deepEqual(await counts(id), { installations: 1, events: 2 });
  const limited = await report(id.toUpperCase(), 'activity');
  assert.equal(limited.status, 429, 'uppercase UUID must share the device budget');
  assert.ok(Number(limited.headers['retry-after']) > 0);
}

async function verifyConcurrentInstallations() {
  const id = device();
  const responses = await Promise.all(Array.from({ length: 8 }, () => report(id, 'installation')));
  for (const response of responses) assert.equal(response.status, 200);
  assert.deepEqual(await counts(id), { installations: 1, events: 1 });
}

async function verifyNewInstallationBudget() {
  await clearFixtureLimits();
  const admitted = [];
  for (let index = 0; index < 30; index++) {
    const id = device();
    admitted.push(id);
    assert.equal((await report(id, 'installation')).status, 200);
  }
  const blocked = device();
  const response = await request(base, 'POST', endpoint, {
    headers: { 'X-Forwarded-For': '198.51.100.99', 'X-Real-IP': '198.51.100.99' },
    body: { deviceId: blocked, platform: 'windows', eventType: 'installation', appVersion: '1.5.43' },
  });
  assert.equal(response.status, 429);
  assert.deepEqual(await counts(blocked), { installations: 0, events: 0 });
  assert.equal((await report(admitted[0], 'installation', { appVersion: '1.5.44' })).status, 200);
  assert.equal((await report(admitted[0], 'activity')).status, 200);
}

try {
  await redis.connect();
  await clearFixtureLimits();
  await verifyRegistrationAndActivity();
  await verifyConcurrentInstallations();
  await verifyNewInstallationBudget();
  console.log('PASS telemetry registration, concurrent daily deduplication, spoofing and installation budgets');
} finally {
  await db.query('DELETE FROM device_telemetry_events WHERE "deviceId"=ANY($1::uuid[])', [deviceIds]);
  await db.query('DELETE FROM device_installations WHERE "deviceId"=ANY($1::uuid[])', [deviceIds]);
  await clearFixtureLimits();
  await redis.quit();
  await db.end();
}
