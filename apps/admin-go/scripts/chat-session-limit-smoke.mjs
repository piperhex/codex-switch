import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Socket } from './parity-devices.mjs';
import { request, fixtureUsers, fixturePassword } from './parity-client.mjs';
import { fixtureDatabase, seedParity } from './seed-parity.mjs';

// Fixed local fixture only; restore the settings and remove the task's device afterward.
const base = 'http://127.0.0.1:28081';
const endpoint = '/admin/api/chat-settings';
const deviceId = randomUUID();
const sockets = [];
await seedParity();

async function login(role) {
  const response = await request(base, 'POST', '/auth/login', {
    body: { email: fixtureUsers[role].email, password: fixturePassword },
  });
  assert.equal(response.status, 201);
  return response.body.accessToken;
}

const token = await login('admin');
const initial = await request(base, 'GET', endpoint, { token });
assert.equal(initial.status, 200);

function connect(path = '/device-chat') {
  const socket = new Socket(base.replace('http:', 'ws:') + path);
  sockets.push(socket);
  return socket;
}

async function chat(role, overrides = {}) {
  const socket = connect();
  await socket.send({ type: 'authenticate', role, accessToken: token, deviceId, transportVersion: 2,
    ...(role === 'mobile' ? { publicKey: 'ab'.repeat(32) } : {}), ...overrides });
  await socket.next('chat-policy');
  return socket;
}

async function save(limit) {
  const policy = { ...initial.body, chatSessionLimit: limit };
  if (limit === undefined) delete policy.chatSessionLimit;
  const result = await request(base, 'PATCH', endpoint, { token, body: policy });
  assert.equal(result.status, 200);
  assert.equal(result.body.chatSessionLimit, limit ?? 5);
  assert.equal((await request(base, 'GET', endpoint, { token })).body.chatSessionLimit, limit ?? 5);
  return result.body;
}

async function pair(desktop, version = 2) {
  const socket = await chat('mobile', { transportVersion: version });
  const { body } = await socket.next('paired');
  await desktop.next('peer-open');
  return { socket, body };
}

async function expectFull() {
  const socket = connect();
  await socket.send({ type: 'authenticate', role: 'mobile', accessToken: token, deviceId,
    transportVersion: 2, publicKey: 'ab'.repeat(32) });
  assert.deepEqual(await socket.waitClosed(), { code: 4008, reason: 'Too many chat connections' });
}

async function verifyValidation() {
  const restricted = await login('restricted');
  assert.equal((await request(base, 'PATCH', endpoint, { token: restricted, body: initial.body })).status, 403);
  for (const limit of [0, -1, 1.5, null, '5', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await request(base, 'PATCH', endpoint, {
      token, body: { ...initial.body, chatSessionLimit: limit },
    })).status, 400);
  }
}

async function verifyLimits(desktop) {
  const peers = [];
  for (let index = 0; index < 5; index++) peers.push(await pair(desktop));
  await expectFull();
  await save(7);
  await desktop.wait(message => message.type === 'chat-policy' && message.policy.chatSessionLimit === 7, 1500);
  peers.push(await pair(desktop));
  peers.push(await pair(desktop, 1));
  await expectFull();
  await save(2);
  await expectFull();
  assert.ok(peers.every(peer => !peer.socket.closed), 'lowering the limit must preserve active connections');
  const claims = peers.slice(0, 6).map(({ body }) => ({ sessionId: body.sessionId, resumeToken: body.resumeToken }));
  desktop.close();
  await desktop.waitClosed();
  const restored = await chat('desktop', { sessions: claims });
  await restored.next('registered');
  for (const peer of peers.slice(0, 6)) await peer.socket.next('resumed');
  peers[0].socket.close();
  await peers[0].socket.waitClosed();
  const resumed = await chat('mobile', { resume: claims[0] });
  await resumed.next('resumed');
  await expectFull();
  for (const claim of claims.slice(1)) {
    await restored.send({ type: 'peer-close', sessionId: claim.sessionId });
    await restored.next('peer-close');
  }
  await pair(restored);
  await expectFull();
}

try {
  await save(undefined);
  await verifyValidation();
  const registration = connect('/device-switch');
  await registration.send({ type: 'authenticate', accessToken: token, deviceId,
    name: 'Chat limit fixture', platform: 'windows', appVersion: '1.5.38', capabilities: [] });
  await registration.next('authenticated');
  const desktop = await chat('desktop');
  await desktop.next('registered');
  await verifyLimits(desktop);
  console.log('PASS chat limits: default five, persistence, validation, live updates, mixed transports, '
    + 'lowered limits, desktop/mobile resume and released slots');
} finally {
  assert.equal((await request(base, 'PATCH', endpoint, { token, body: initial.body })).status, 200);
  for (const socket of sockets) socket.close();
  const database = await fixtureDatabase('admin_go');
  try {
    await database.query('DELETE FROM remote_devices WHERE "deviceId" = $1 AND "ownerId" = $2',
      [deviceId, fixtureUsers.admin.id]);
  } finally { await database.end(); }
}
