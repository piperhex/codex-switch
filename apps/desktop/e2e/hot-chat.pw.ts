import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { WebSocketServer as Server } from 'ws';
import type { AddressInfo } from 'node:net';
import type { ChatSessions as Sessions } from '../../admin/src/modules/devices/chat/chat-sessions';
import type {} from './hot-chat-harness';

const require = createRequire(import.meta.url);
const { DEFAULT_CHAT_POLICY } = require('../../../shared/chat/chatPolicy') as
  typeof import('../../../shared/chat/chatPolicy');
const { WebSocketServer } = createRequire(new URL('../../admin/package.json', import.meta.url))('ws') as {
  WebSocketServer: typeof Server;
};
const { ChatSessions } = require('../../admin/dist/modules/devices/chat/chat-sessions.js') as {
  ChatSessions: typeof Sessions;
};
let server: Server;
let sessions: Sessions;
let endpoint: string;
let available: boolean;
let relayDelay: number;
const delayedFrames = new Set<ReturnType<typeof setTimeout>>();
test.beforeEach(async () => {
  available = true;
  relayDelay = 0;
  sessions = new ChatSessions();
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on('connection', (socket) => {
    if (!available) { socket.terminate(); return; }
    let joined = false;
    socket.on('message', (raw) => {
      try {
        const frame = JSON.parse(raw.toString());
        if (joined && frame.type === 'relay' && relayDelay) {
          const timer = setTimeout(() => {
            delayedFrames.delete(timer);
            try { sessions.route(socket, frame); } catch { socket.close(4001); }
          }, relayDelay);
          delayedFrames.add(timer);
        } else if (joined) sessions.route(socket, frame);
        else {
          joined = true;
          sessions.join(socket, { role: frame.role, ownerId: 'owner', deviceId: 'computer',
            expiresAt: Date.now() + 300_000 }, frame, []);
        }
      } catch { socket.close(4001); }
    });
    socket.on('close', () => sessions.disconnect(socket));
  });
});
test.afterEach(async () => {
  for (const timer of delayedFrames) clearTimeout(timer);
  delayedFrames.clear();
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('keeps slow relay usable without reconnecting when P2P is unavailable', async ({ context }) => {
  relayDelay = 2000;
  const pc = await context.newPage();
  const phone = await context.newPage();
  await pc.goto(`/e2e/hot-chat-harness.html?role=desktop&relayOnly&socket=${encodeURIComponent(endpoint)}`);
  await expect(pc.locator('#status')).toHaveText('registered');
  await phone.goto(`/e2e/hot-chat-harness.html?role=mobile&relayOnly&socket=${encodeURIComponent(endpoint)}`);
  await expect(phone.locator('#status')).toHaveText('relay', { timeout: 10_000 });
  const beats = await phone.evaluate(() => window.hotChat.stats().beats);
  for (const text of ['slow relay request', 'still connected']) {
    expect(await phone.evaluate((value) => window.hotChat.request(value), text)).toEqual({ text });
  }
  await phone.waitForTimeout(6000);
  expect(await phone.evaluate(() => window.hotChat.stats().beats)).toBeGreaterThan(beats + 100);
  expect(await phone.evaluate(() => window.hotChat.stats().readyCount)).toBe(1);
  for (const page of [pc, phone]) {
    await expect(page.locator('#status')).toHaveText('relay');
    expect(await page.evaluate(() => window.hotChat.errors)).toEqual([]);
    const modes = await page.evaluate(() => window.hotChat.modes);
    expect(modes.slice(modes.indexOf('relay'))).toEqual(['relay']);
  }
});

test('keeps relay usable while a twelve-second negotiation completes with the original peer', async ({ context }) => {
  const pc = await context.newPage();
  const phone = await context.newPage();
  await pc.goto(`/e2e/hot-chat-harness.html?role=desktop&signalDelay=12000&socket=${encodeURIComponent(endpoint)}`);
  await expect(pc.locator('#status')).toHaveText('registered');
  await phone.goto(`/e2e/hot-chat-harness.html?role=mobile&socket=${encodeURIComponent(endpoint)}`);
  await expect(phone.locator('#status')).toHaveText('relay', { timeout: 5000 });
  const before = await phone.evaluate(() => window.hotChat.stats().beats);
  expect(await phone.evaluate(() => window.hotChat.request('during negotiation')))
    .toEqual({ text: 'during negotiation' });
  await expect(phone.locator('#status')).toHaveText('direct', { timeout: 25_000 });
  await expect(pc.locator('#status')).toHaveText('direct');
  for (const page of [pc, phone]) {
    expect(await page.evaluate(() => window.hotChat.stats().peerCreations)).toBe(1);
    expect(await page.evaluate(() => window.hotChat.errors)).toEqual([]);
  }
  expect(await phone.evaluate(() => window.hotChat.stats().beats)).toBeGreaterThan(before + 10);
  expect(await phone.evaluate(() => window.hotChat.stats().readyCount)).toBe(1);
  expect(await phone.evaluate(() => window.hotChat.request('after negotiation')))
    .toEqual({ text: 'after negotiation' });
});

test('recovers the same direct channel after a short outage while relay carries requests', async ({ context }) => {
  const pc = await context.newPage();
  const phone = await context.newPage();
  await pc.goto(`/e2e/hot-chat-harness.html?role=desktop&socket=${encodeURIComponent(endpoint)}`);
  await expect(pc.locator('#status')).toHaveText('registered');
  await phone.goto(`/e2e/hot-chat-harness.html?role=mobile&socket=${encodeURIComponent(endpoint)}`);
  await expect(phone.locator('#status')).toHaveText('direct', { timeout: 12_000 });
  // The old policy immediately replaced healthy peers older than ten seconds after a lost probe.
  await phone.waitForTimeout(8000);
  await phone.evaluate(() => window.hotChat.dropDirect(true));
  await expect(phone.locator('#status')).toHaveText('relay', { timeout: 5000 });
  expect(await phone.evaluate(() => window.hotChat.request('during outage'))).toEqual({ text: 'during outage' });
  await phone.evaluate(() => window.hotChat.dropDirect(false));
  await expect(phone.locator('#status')).toHaveText('direct', { timeout: 8000 });
  for (const page of [pc, phone]) {
    expect(await page.evaluate(() => window.hotChat.stats().peerCreations)).toBe(1);
    expect(await page.evaluate(() => window.hotChat.errors)).toEqual([]);
  }
  expect(await phone.evaluate(() => window.hotChat.stats().readyCount)).toBe(1);
});

test('applies policy broadcasts to an active negotiation without interrupting relay', async ({ context }) => {
  const pc = await context.newPage();
  const phone = await context.newPage();
  await pc.goto(`/e2e/hot-chat-harness.html?role=desktop&signalDelay=60000&socket=${encodeURIComponent(endpoint)}`);
  await expect(pc.locator('#status')).toHaveText('registered');
  await phone.goto(`/e2e/hot-chat-harness.html?role=mobile&socket=${encodeURIComponent(endpoint)}`);
  await expect(phone.locator('#status')).toHaveText('relay', { timeout: 5000 });
  const publish = (seconds: number) => {
    const policy = { ...DEFAULT_CHAT_POLICY, p2pNegotiationTimeoutSeconds: seconds,
      p2pRetryIntervalSeconds: seconds, p2pDisconnectGraceSeconds: seconds };
    for (const client of server.clients) client.send(JSON.stringify({ type: 'chat-policy', policy }));
  };
  publish(1);
  await expect.poll(() => phone.evaluate(() => window.hotChat.stats().peerCreations), { timeout: 3000 })
    .toBeGreaterThan(1);
  publish(Number.MAX_SAFE_INTEGER);
  await phone.waitForTimeout(300);
  const attempts = await phone.evaluate(() => window.hotChat.stats().peerCreations);
  await phone.waitForTimeout(2500);
  expect(await phone.evaluate(() => window.hotChat.stats().peerCreations)).toBe(attempts);
  expect(await phone.evaluate(() => window.hotChat.request('updated policy'))).toEqual({ text: 'updated policy' });
  expect(await phone.evaluate(() => window.hotChat.stats().readyCount)).toBe(1);
  expect(await phone.evaluate(() => window.hotChat.errors)).toEqual([]);
});

for (const [path, mib] of [['large.apk', 21], ['lan-100mb.bin', 100]] as const) {
  test(`downloads ${mib} MiB over transport v2 while messages remain responsive`, async ({ context }) => {
    test.setTimeout(120_000);
    // Exercise the same decoder fallback used by Hermes versions without TextDecoder.
    await context.addInitScript(() => Object.defineProperty(globalThis, 'TextDecoder', { value: undefined }));
    const pc = await context.newPage();
    const phone = await context.newPage();
    await pc.goto(`/e2e/hot-chat-harness.html?role=desktop&download=true&socket=${encodeURIComponent(endpoint)}`);
    await expect(pc.locator('#status')).toHaveText('registered');
    await phone.goto(`/e2e/hot-chat-harness.html?role=mobile&socket=${encodeURIComponent(endpoint)}`);
    await expect(phone.locator('#status')).toHaveText('direct', { timeout: 12_000 });
    await expect(pc.locator('#status')).toHaveText('direct');
    const before = await phone.evaluate(() => window.hotChat.stats().beats);
    const downloading = phone.evaluate((path) => window.hotDownload(path), path);
    expect(await phone.evaluate(() => window.hotChat.request('during download'))).toEqual({ text: 'during download' });
    const result = await downloading;
    const expected = Buffer.alloc(mib * 1024 * 1024 + 17);
    for (let index = 0; index < expected.length; index++) expected[index] = index % 251;
    expect(result.hash).toBe(createHash('sha256').update(expected).digest('hex'));
    expect(result.size).toBe(expected.length);
    const stats = await phone.evaluate(() => window.hotChat.stats());
    console.log(JSON.stringify({ benchmark: 'P2P download without TextDecoder', mib,
      elapsedMs: Math.round(result.elapsedMs),
      mibPerSecond: Number((result.size / 1024 / 1024 / (result.elapsedMs / 1000)).toFixed(2)),
      packets: stats.packets, batches: stats.batches }));
    expect(stats.batches).toBeGreaterThan(0);
    expect(await phone.evaluate(() => window.hotChat.stats().beats)).toBeGreaterThan(before + 2);
    expect(await phone.evaluate(() => window.hotChat.errors)).toEqual([]);
  });
}

test('transfers large P2P messages in both directions while the UI heartbeat and other requests keep running',
  async ({ context }) => {
    const pc = await context.newPage();
    const phone = await context.newPage();
    await pc.goto(`/e2e/hot-chat-harness.html?role=desktop&socket=${encodeURIComponent(endpoint)}`);
    await expect(pc.locator('#status')).toHaveText('registered');
    await phone.goto(`/e2e/hot-chat-harness.html?role=mobile&socket=${encodeURIComponent(endpoint)}`);
    await expect(phone.locator('#status')).toHaveText('direct', { timeout: 12_000 });
    await expect(pc.locator('#status')).toHaveText('direct');
    const before = await phone.evaluate(() => window.hotChat.stats().beats);
    const size = 9 * 1024 * 1024;
    const upload = phone.evaluate(async (length) => {
      const result = await window.hotChat.request('x'.repeat(length)) as { text: string };
      return result.text.length;
    }, size);
    const download = pc.evaluate((length) => window.hotChat.stream('y'.repeat(length)), size);
    expect(await phone.evaluate(() => window.hotChat.request('still responsive')))
      .toEqual({ text: 'still responsive' });
    expect(await upload).toBe(size);
    await download;
    await expect.poll(() => phone.evaluate(() => (window.hotChat.events[0] as { text: string })?.text.length))
      .toBe(size);
    expect(await phone.evaluate(() => window.hotChat.stats().beats)).toBeGreaterThan(before + 1);
    expect(await phone.evaluate(() => window.hotChat.errors)).toEqual([]);
    expect(await pc.evaluate(() => window.hotChat.errors)).toEqual([]);
    await phone.evaluate(() => window.hotChat.blockDirect(true));
    await expect(phone.locator('#status')).toHaveText('relay', { timeout: 5000 });
    const rejected = await phone.evaluate(async (length) => {
      try { await window.hotChat.request('x'.repeat(length)); return false; } catch { return true; }
    }, size);
    expect(rejected).toBe(true);
    expect(await phone.evaluate(() => window.hotChat.request('relay works'))).toEqual({ text: 'relay works' });
  });

test('keeps a real conversation alive through relay loss, coordinator restart and repeated P2P recovery',
  async ({ context }) => {
    test.setTimeout(75_000);
    const pc = await context.newPage();
    const phone = await context.newPage();
    await pc.goto(`/e2e/hot-chat-harness.html?role=desktop&socket=${encodeURIComponent(endpoint)}`);
    await expect(pc.locator('#status')).toHaveText('registered');
    await phone.goto(`/e2e/hot-chat-harness.html?role=mobile&socket=${encodeURIComponent(endpoint)}`);
    await expect(phone.locator('#status')).toHaveText('direct', { timeout: 12_000 });
    expect(await phone.evaluate(() => window.hotChat.request('first'))).toEqual({ text: 'first' });

    available = false;
    for (const client of server.clients) client.terminate();
    // Reset the in-memory registry as a real backend restart would.
    sessions = new ChatSessions();
    await phone.waitForTimeout(3500);
    expect(await phone.evaluate(() => window.hotChat.request('cloud unavailable')))
      .toEqual({ text: 'cloud unavailable' });
    await expect(phone.locator('#status')).toHaveText('direct');
    available = true;
    // The phone may retry before the PC registers and enter the next reconnect backoff.
    await expect.poll(() => server.clients.size, { timeout: 20_000 }).toBe(2);
    await phone.waitForTimeout(1500);

    const text = 'stream 中文😀'.repeat(20_000);
    const before = await phone.evaluate(() => window.hotChat.stats().beats);
    const streaming = pc.evaluate((value) => window.hotChat.stream(value), text);
    await phone.waitForTimeout(100);
    await phone.evaluate(() => window.hotChat.blockDirect(true));
    await expect(phone.locator('#status')).toHaveText('relay', { timeout: 5000 });
    await streaming;
    await expect.poll(() => phone.evaluate(() => window.hotChat.events.length)).toBe(1);
    expect(await phone.evaluate(() => window.hotChat.events[0])).toEqual({ text });
    expect(await phone.evaluate(() => window.hotChat.stats().beats)).toBeGreaterThan(before + 10);
    expect(await phone.evaluate(() => window.hotChat.request('relay request'))).toEqual({ text: 'relay request' });

    await phone.evaluate(() => window.hotChat.blockDirect(false));
    await expect(phone.locator('#status')).toHaveText('direct', { timeout: 18_000 });
    expect(await phone.evaluate(() => window.hotChat.request('restored'))).toEqual({ text: 'restored' });
    expect(await phone.evaluate(() => window.hotChat.stats().readyCount)).toBe(1);
    expect(await pc.evaluate(() => window.hotChat.stats().executions)).toBe(4);
    expect(await phone.evaluate(() => window.hotChat.errors)).toEqual([]);
    expect(await pc.evaluate(() => window.hotChat.errors)).toEqual([]);
    expect(await phone.evaluate(() => window.hotChat.modes)).not.toContain('offline');
    await phone.evaluate(() => window.hotChat.disconnect());
    await expect(pc.locator('#status')).toHaveText('offline');
  });
