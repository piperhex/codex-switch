import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { Socket } from './parity-devices.mjs';
import { fixtureDatabase } from './seed-parity.mjs';
import { fixturePassword, request } from './parity-client.mjs';

const require = createRequire(new URL('../testdata/tools/package.json', import.meta.url));
const bcrypt = require('bcryptjs');
export const sides = ['legacy', 'modern'];
export const securityUser = '00000000-0000-4000-8000-000000000021';
export const securityDevice = '00000000-0000-4000-8000-000000000022';
export const strangerUser = '00000000-0000-4000-8000-000000000023';
export const strangerDevice = '00000000-0000-4000-8000-000000000024';
const securityEmail = 'chat-security-fixture@example.test';
const activeSockets = new Set();

export async function prepareSecurity(pair) {
  const passwordHash = await bcrypt.hash(fixturePassword, 12);
  for (const side of sides) {
    const database = await fixtureDatabase(side === 'legacy' ? 'legacy' : 'admin_go');
    try {
      for (const [id, email] of [
        [securityUser, securityEmail],
        [strangerUser, 'chat-stranger-fixture@example.test'],
      ]) {
        await database.query(
          `INSERT INTO users(id,email,"passwordHash",role,disabled) VALUES($1,$2,$3,'user',false)
          ON CONFLICT(id) DO UPDATE SET "passwordHash"=EXCLUDED."passwordHash",role='user',disabled=false`,
          [id, email, passwordHash],
        );
        await database.query('DELETE FROM remote_devices WHERE "ownerId"=$1', [id]);
      }
    } finally {
      await database.end();
    }
    const login = await request(pair.urls[side], 'POST', '/auth/login', {
      body: { email: securityEmail, password: fixturePassword },
    });
    assert.equal(login.status, 201);
    pair.tokens[side] = login.body.accessToken;
  }
}

export function signedToken(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: securityUser, exp: Math.floor(Date.now() / 1000) + 600, ...overrides }),
  ).toString('base64url');
  const signature = createHmac('sha256', 'local-parity-access-secret-not-for-production')
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function connections(pair, path = '/device-chat') {
  return Object.fromEntries(
    sides.map((side) => {
      const socket = new Socket(pair.urls[side].replace(/^http/, 'ws') + path);
      activeSockets.add(socket);
      socket.ws.once('close', () => activeSockets.delete(socket));
      return [side, socket];
    }),
  );
}
export function releaseConnections() {
  for (const socket of activeSockets) socket.ws.terminate();
  activeSockets.clear();
}
export async function nextBoth(sockets, type) {
  return Object.fromEntries(await Promise.all(sides.map(async (side) => [side, await sockets[side].next(type)])));
}
export async function closeBoth(sockets) {
  for (const socket of Object.values(sockets)) socket.close();
  await Promise.all(Object.values(sockets).map((socket) => socket.waitClosed()));
}
export function compareFrames(pair, label, frames, normalize) {
  return pair.check(
    label,
    Object.fromEntries(sides.map((side) => [side, { status: 200, body: frames[side].body }])),
    normalize,
  );
}
export async function compareClosed(pair, label, sockets, expected, timeout = 6000) {
  const responses = Object.fromEntries(
    await Promise.all(
      sides.map(async (side) => [side, { status: 200, body: await sockets[side].waitClosed(timeout) }]),
    ),
  );
  pair.check(label, responses);
  if (expected) assert.deepEqual(responses.legacy.body, expected);
}
export async function sendBoth(sockets, message) {
  await Promise.all(sides.map((side) => sockets[side].send(typeof message === 'function' ? message(side) : message)));
}
export async function control(pair, overrides = {}) {
  const sockets = connections(pair, '/device-switch');
  await sendBoth(sockets, (side) => ({
    type: 'authenticate',
    accessToken: pair.tokens[side],
    deviceId: securityDevice,
    name: 'Security fixture PC',
    platform: 'windows',
    capabilities: ['provider-switch', 'provider-group-switch', 'restart-codex'],
    localProxyRunning: true,
    ...overrides,
  }));
  await nextBoth(sockets, 'authenticated');
  return sockets;
}
export async function chat(pair, role, overrides = {}) {
  const sockets = connections(pair);
  await sendBoth(sockets, (side) => ({
    type: 'authenticate',
    accessToken: pair.tokens[side],
    deviceId: securityDevice,
    role,
    transportVersion: 2,
    ...(role === 'mobile' ? { publicKey: 'ab'.repeat(32) } : {}),
    ...(typeof overrides === 'function' ? overrides(side) : overrides),
  }));
  return sockets;
}
export async function desktop(pair, overrides = {}) {
  const sockets = await chat(pair, 'desktop', overrides);
  await nextBoth(sockets, 'registered');
  return sockets;
}
export async function mobile(pair, desktops, overrides = {}) {
  const sockets = await chat(pair, 'mobile', overrides);
  const paired = await nextBoth(sockets, 'paired');
  await nextBoth(desktops, 'peer-open');
  pair.alias(paired.legacy.body.resumeToken, paired.modern.body.resumeToken, 'resume proof');
  compareFrames(pair, 'security fixture mobile paired', paired, (body) => ({ ...body, expiresAt: '<expiry>' }));
  return { sockets, paired };
}
export function claims(paired, side) {
  return { sessionId: paired[side].body.sessionId, resumeToken: paired[side].body.resumeToken };
}
export function passed(pair, label) {
  pair.results.push({ label, status: 200 });
  console.log(`PASS ${label}`);
}
