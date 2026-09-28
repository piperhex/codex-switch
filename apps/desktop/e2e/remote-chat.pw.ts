import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { WebSocketServer as Server } from 'ws';
import type { AddressInfo } from 'node:net';
import type { ChatSessions as Sessions } from '../../admin/src/modules/devices/chat/chat-sessions';
import type { ChatIdentity } from '../../admin/src/modules/devices/chat/protocol';
import './chat-harness-types';

const require = createRequire(import.meta.url);
const { WebSocketServer } = createRequire(new URL('../../admin/package.json', import.meta.url))('ws') as {
  WebSocketServer: typeof Server;
};
const { ChatSessions } = require('../../admin/dist/modules/devices/chat/chat-sessions.js') as { ChatSessions: typeof Sessions };
let server: Server;
let endpoint: string;
let relayPackets: number;

test.beforeEach(async () => {
  relayPackets = 0;
  const sessions = new ChatSessions();
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('connection', (socket) => {
    let joined = false;
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      if (!joined) {
        joined = true;
        const identity: ChatIdentity = { role: frame.role, deviceId: 'computer', ownerId: 'test-owner',
          expiresAt: Date.now() + 60_000 };
        sessions.join(socket, identity, frame, []);
      } else {
        if (frame.type === 'relay') { relayPackets += 1; expect(frame.payload).toMatch(/^[a-f0-9]+$/); }
        sessions.route(socket, frame);
      }
    });
    socket.on('close', () => sessions.disconnect(socket));
  });
});

test.afterEach(async () => {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('uses real ICE data channels, streams without relay traffic, then recovers through the admin relay', async ({ context }) => {
  const pc = await context.newPage();
  const phone = await context.newPage();
  await pc.goto(`/e2e/chat-harness.html?role=desktop&socket=${encodeURIComponent(endpoint)}`);
  await expect(pc.locator('#status')).toHaveText('registered');
  await phone.goto(`/e2e/chat-harness.html?role=mobile&socket=${encodeURIComponent(endpoint)}`);
  await expect(phone.locator('#status')).toHaveText('direct', { timeout: 12_000 });
  expect(await phone.evaluate(() => window.chatTest.request('继续处理 👋'))).toEqual({ text: '继续处理 👋' });
  const before = await phone.evaluate(() => window.chatTest.beats());
  await pc.evaluate(() => window.chatTest.stream('大段历史与流式内容😀'.repeat(15_000)));
  await expect.poll(() => phone.evaluate(() => window.chatTest.events.length)).toBe(1);
  expect(await phone.evaluate(() => window.chatTest.beats())).toBeGreaterThan(before + 2);
  expect(relayPackets).toBe(0);
  await phone.evaluate(() => window.chatTest.fallback());
  await expect(phone.locator('#status')).toHaveText('relay');
  expect(await phone.evaluate(() => window.chatTest.request('断线后继续'))).toEqual({ text: '断线后继续' });
  expect(relayPackets).toBeGreaterThan(0);
  expect(await pc.evaluate(() => window.chatTest.executions())).toBe(2);
  expect(await phone.evaluate(() => window.chatTest.errors)).toEqual([]);
});

test('waits for unsuccessful direct discovery before using encrypted admin relay', async ({ context }) => {
  const pc = await context.newPage();
  const phone = await context.newPage();
  await pc.goto(`/e2e/chat-harness.html?role=desktop&blocked=true&socket=${encodeURIComponent(endpoint)}`);
  await expect(pc.locator('#status')).toHaveText('registered');
  const started = Date.now();
  await phone.goto(`/e2e/chat-harness.html?role=mobile&blocked=true&socket=${encodeURIComponent(endpoint)}`);
  await expect(phone.locator('#status')).toHaveText('relay', { timeout: 15_000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(10_000);
  expect(await phone.evaluate(() => window.chatTest.request('中转聊天'))).toEqual({ text: '中转聊天' });
  expect(relayPackets).toBeGreaterThan(0);
  expect(await phone.evaluate(() => window.chatTest.modes)).not.toContain('direct');
});

test('isolates overlapping sessions when an older client falls back and disconnects', async ({ context }) => {
  const pc = await context.newPage();
  await pc.goto(`/e2e/chat-harness.html?role=desktop&socket=${encodeURIComponent(endpoint)}`);
  await expect(pc.locator('#status')).toHaveText('registered');
  const phones = [await context.newPage(), await context.newPage()];
  for (const phone of phones) {
    await phone.goto(`/e2e/chat-harness.html?role=mobile&socket=${encodeURIComponent(endpoint)}`);
    await expect(phone.locator('#status')).toHaveText('direct', { timeout: 12_000 });
  }
  await pc.evaluate(() => window.chatTest.stream('shared update'));
  for (const phone of phones) {
    await expect.poll(() => phone.evaluate(() => window.chatTest.events)).toEqual([{ text: 'shared update' }]);
  }
  await phones[0].evaluate(() => window.chatTest.fallback());
  await expect(phones[0].locator('#status')).toHaveText('relay');
  expect(await phones[0].evaluate(() => window.chatTest.request('older session')))
    .toEqual({ text: 'older session' });
  await phones[0].close();
  expect(await phones[1].evaluate(() => window.chatTest.request('remaining session')))
    .toEqual({ text: 'remaining session' });
  await pc.evaluate(() => window.chatTest.stream('still running'));
  await expect.poll(() => phones[1].evaluate(() => window.chatTest.events))
    .toEqual([{ text: 'shared update' }, { text: 'still running' }]);
  expect(await pc.evaluate(() => window.chatTest.errors)).toEqual([]);
  expect(await phones[1].evaluate(() => window.chatTest.errors)).toEqual([]);
});

test('downloads binary files above relay limits over real P2P and keeps relay downloads compatible', async ({ context }) => {
  test.setTimeout(120_000);
  const pc = await context.newPage();
  const phone = await context.newPage();
  await pc.goto(`/e2e/chat-harness.html?role=desktop&download=true&socket=${encodeURIComponent(endpoint)}`);
  await expect(pc.locator('#status')).toHaveText('registered');
  await phone.goto(`/e2e/chat-harness.html?role=mobile&socket=${encodeURIComponent(endpoint)}`);
  await expect(phone.locator('#status')).toHaveText('direct', { timeout: 12_000 });
  const before = await phone.evaluate(() => window.chatTest.beats());
  const result = await phone.evaluate(() => window.downloadFixture('large.apk'));
  const expected = Buffer.alloc(21 * 1024 * 1024 + 17);
  for (let index = 0; index < expected.length; index++) expected[index] = index % 251;
  expect(result).toEqual({ size: expected.length, hash: createHash('sha256').update(expected).digest('hex') });
  expect(await phone.evaluate(() => window.chatTest.beats())).toBeGreaterThan(before + 2);
  expect(relayPackets).toBe(0);
  expect(await phone.evaluate(() => window.downloadFixture('empty'))).toEqual({ size: 0,
    hash: createHash('sha256').digest('hex') });
  await phone.evaluate(() => window.chatTest.fallback());
  await expect(phone.locator('#status')).toHaveText('relay');
  const small = await phone.evaluate(() => window.downloadFixture('small.zip'));
  expect(small).toEqual({ size: 1024 * 1024 + 3,
    hash: createHash('sha256').update(expected.subarray(0, 1024 * 1024 + 3)).digest('hex') });
  expect(relayPackets).toBeGreaterThan(0);
  expect(await phone.evaluate(() => window.chatTest.errors)).toEqual([]);
});
