import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Socket } from './parity-devices.mjs';
import { request, fixtureUsers, fixturePassword } from './parity-client.mjs';
import { fixtureDatabase } from './seed-parity.mjs';

const require = createRequire(new URL('../testdata/tools/package.json', import.meta.url));
const bcrypt = require('bcryptjs');
const base = 'http://127.0.0.1:28081';
const endpoint = '/admin/api/chat-traffic/users';
const owner = randomUUID();
const deviceId = randomUUID();
const email = `traffic-${owner}@fixture.test`;
const sockets = [];
const SETTLEMENT_WAIT_MS = 15_000;
const SETTLEMENT_POLL_MS = 100;
const database = await fixtureDatabase('admin_go');
let adminToken;
let userToken;

async function login(email) {
  const result = await request(base, 'POST', '/auth/login', { body: { email, password: fixturePassword } });
  assert.equal(result.status, 201);
  return result.body.accessToken;
}

function socket(path = '/device-chat') {
  const client = new Socket(base.replace('http:', 'ws:') + path);
  sockets.push(client);
  return client;
}

async function chat(role, extra = {}) {
  const client = socket();
  await client.send({ type: 'authenticate', role, accessToken: userToken, deviceId, transportVersion: 2,
    ...(role === 'mobile' ? { publicKey: 'ab'.repeat(32), clientInfo: { name: 'Pixel 9', platform: 'Android' } } : {}),
    ...extra });
  await client.next('chat-policy');
  return client;
}

async function saveLimit(monthlyLimitBytes) {
  const result = await request(base, 'PATCH', `${endpoint}/${owner}/limit`, {
    token: adminToken, body: { monthlyLimitBytes },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
}

async function detail() {
  const result = await request(base, 'GET', `${endpoint}/${owner}`, { token: adminToken });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function untilUsed(expected) {
  // A five-second grant can expire just after the five-second settlement pass.
  const deadline = Date.now() + SETTLEMENT_WAIT_MS;
  while (Date.now() < deadline) {
    const result = await detail();
    if (result.user.monthUsedBytes === expected) return result;
    await new Promise(resolve => setTimeout(resolve, SETTLEMENT_POLL_MS));
  }
  assert.fail(`Expected ${expected} bytes`);
}

async function checkPermissions() {
  for (const token of [undefined, userToken]) {
    for (const [method, path] of [['GET', endpoint], ['GET', `${endpoint}/${owner}`],
      ['PATCH', `${endpoint}/${owner}/limit`]]) {
      assert.equal((await request(base, method, path, { token, body: method === 'PATCH'
        ? { monthlyLimitBytes: -1 } : undefined })).status, token ? 403 : 401);
    }
  }
  for (const monthlyLimitBytes of [undefined, null, -2, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await request(base, 'PATCH', `${endpoint}/${owner}/limit`, {
      token: adminToken, body: { monthlyLimitBytes },
    })).status, 400);
  }
  assert.equal((await request(base, 'GET', `${endpoint}?month=2026-13`, { token: adminToken })).status, 400);
  assert.equal((await request(base, 'GET', `${endpoint}/invalid`, { token: adminToken })).status, 400);
  assert.equal((await request(base, 'GET', `${endpoint}/${randomUUID()}`, { token: adminToken })).status, 404);
}

async function pair(desktop, version = 2) {
  const mobile = await chat('mobile', { transportVersion: version });
  const { body } = await mobile.next('paired');
  const opened = await desktop.next('peer-open');
  assert.deepEqual(opened.body.clientInfo, { name: 'Pixel 9', platform: 'Android' });
  return { mobile, sessionId: body.sessionId, resumeToken: body.resumeToken };
}

async function verifyRelay(desktop) {
  const first = await pair(desktop);
  const second = await pair(desktop);
  const frame = { type: 'relay', sessionId: first.sessionId, payload: 'ab'.repeat(512) };
  const size = Buffer.byteLength(JSON.stringify(frame));
  await saveLimit(size * 3);
  for (let index = 0; index < 20; index++) {
    const peer = index % 2 ? second : first;
    await peer.mobile.send({ ...frame, sessionId: peer.sessionId });
  }
  for (let index = 0; index < 3; index++) await desktop.next('relay');
  await first.mobile.next('relay-quota');
  const snapshot = await untilUsed(size * 3);
  assert.equal(snapshot.daily.reduce((sum, day) => sum + day.bytes, 0), size * 3);
  assert.ok(snapshot.daily.every(day => day.hourlyBytes.length === 24));
  await second.mobile.send({ type: 'signal', sessionId: second.sessionId, payload: { kind: 'key', key: 'cd'.repeat(32) } });
  await desktop.next('signal');
  assert.ok(!desktop.closed && !first.mobile.closed, 'quota must preserve signalling');
  const before = snapshot.user.monthUsedBytes;
  await saveLimit(-1);
  await desktop.send(frame);
  const received = await first.mobile.next('relay');
  assert.equal(received.bytes, size);
  await untilUsed(before + size);
  const traffic = await desktop.wait(value => value.type === 'relay-traffic'
    && value.sessionId === first.sessionId && value.uploadBytes === size);
  assert.ok(traffic.body.downloadBytes > 0);
  first.mobile.close();
  await first.mobile.waitClosed();
  const restored = await chat('mobile', { resume: { sessionId: first.sessionId, resumeToken: first.resumeToken } });
  await restored.next('resumed');
  await restored.send(frame);
  await desktop.next('relay');
  await untilUsed(before + 2 * size);
  const legacy = await pair(desktop, 1);
  await legacy.mobile.send({ type: 'relay-request', sessionId: legacy.sessionId, reason: 'disconnected' });
  await legacy.mobile.next('relay-ready');
  await legacy.mobile.send({ ...frame, sessionId: legacy.sessionId });
  await desktop.next('relay');
  await untilUsed(before + 3 * size);
  await saveLimit(0);
  await legacy.mobile.send({ ...frame, sessionId: legacy.sessionId });
  await legacy.mobile.next('relay-quota');
  assert.equal((await detail()).user.monthUsedBytes, before + 3 * size);
  const list = await request(base, 'GET', `${endpoint}?search=${encodeURIComponent(email)}&pageSize=1`, { token: adminToken });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].monthBytes, before + 3 * size);
}

try {
  await database.query(`INSERT INTO users(id,email,"passwordHash",role) VALUES($1,$2,$3,'user')`,
    [owner, email, await bcrypt.hash(fixturePassword, 12)]);
  adminToken = await login(fixtureUsers.admin.email);
  userToken = await login(email);
  assert.equal((await detail()).user.monthlyLimitBytes, -1);
  await checkPermissions();
  const registration = socket('/device-switch');
  await registration.send({ type: 'authenticate', accessToken: userToken, deviceId,
    name: 'Traffic fixture PC', platform: 'windows', appVersion: '1.5.38', capabilities: [] });
  await registration.next('authenticated');
  const desktop = await chat('desktop');
  await desktop.next('registered');
  await verifyRelay(desktop);
  console.log('PASS traffic: permissions, validation, defaults, concurrent devices, exact bytes, hourly totals, '
    + 'zero/unlimited quota, preserved signalling, resumed sessions and legacy relay');
} finally {
  for (const client of sockets) client.close();
  await Promise.all(sockets.map(client => client.waitClosed()));
  await database.query('DELETE FROM remote_devices WHERE "ownerId"=$1', [owner]);
  await database.query('DELETE FROM users WHERE id=$1', [owner]);
  await database.end();
}
