// Local emulator fixture only. It never connects to a cloud account or an AI provider.
import http from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const require = createRequire(new URL('../../admin/package.json', import.meta.url));
const { WebSocketServer } = require('ws');
const { ChatSessions } = require('./dist/modules/devices/chat/chat-sessions.js');
const session = new ChatSessions();
const profile = { id: 'test-owner', email: 'mobile-test@example.test', role: 'user' };
const devices = [{ deviceId: 'computer', name: '我的工作电脑', platform: 'Windows', online: true,
  localProxyRunning: false, capabilities: [], lastSeenAt: new Date().toISOString() }];
let page;
const previewImage = await readFile(new URL('../src-tauri/icons/32x32.png', import.meta.url));
const httpServer = http.createServer((request, response) => {
  if (request.url === '/test/preview.png') {
    response.setHeader('Content-Type', 'image/png');
    response.end(previewImage);
    return;
  }
  if (request.url?.startsWith('/test/') && !page) {
    response.writeHead(503).end('{}');
    return;
  }
  if (request.url === '/test/composer' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate((input) => window.chatTest.setComposer(input), JSON.parse(body));
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (request.url === '/test/sidebar' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate((action) => window.chatTest.setSidebar(action), JSON.parse(body).action);
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (request.url === '/test/legacy-history' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate((enabled) => window.chatTest.setLegacyHistory(enabled), JSON.parse(body).enabled === true);
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (['/test/settings-delay', '/test/history-delay'].includes(request.url) && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate(({ milliseconds, history }) => history ? window.chatTest.setHistoryDelay(milliseconds)
        : window.chatTest.setSettingsDelay(milliseconds), {
        milliseconds: JSON.parse(body).milliseconds, history: request.url === '/test/history-delay',
      });
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (request.url === '/test/state') {
    void page.evaluate(() => window.chatTest ? ({ ...window.chatTest.demoState(), modes: window.chatTest.modes,
      errors: window.chatTest.errors }) : null).then((state) => {
      if (!state) { response.writeHead(503).end('{}'); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ...state, connectedMobiles: mobileClients.size, mobileConnections, relayFrames }));
    }).catch((error) => {
      console.error('Could not read local fixture state:', error);
      response.writeHead(503).end('{}');
    });
    return;
  }
  if (request.url === '/test/reset' && request.method === 'POST') {
    for (const client of mobileClients) client.terminate();
    relayFrames = 0;
    void page.evaluate(() => localStorage.clear()).then(() => page.reload()).then(() => response.end('{}'))
      .catch(() => response.writeHead(503).end('{}'));
    return;
  }
  if (request.url === '/test/fallback' && request.method === 'POST') {
    void page.evaluate(() => window.chatTest.fallback()).then(() => response.end('{}'))
      .catch(() => response.writeHead(503).end('{}'));
    return;
  }
  if (request.url === '/test/disconnect' && request.method === 'POST') {
    for (const client of mobileClients) client.close(4000, 'Emulator reconnect test');
    response.end('{}');
    return;
  }
  const routes = {
    '/auth/login': { accessToken: 'local-test-token', refreshToken: 'local-test-refresh', user: profile },
    '/auth/refresh': { accessToken: 'renewed-test-token', refreshToken: 'renewed-test-refresh', user: profile },
    '/auth/me': profile,
    '/devices': { devices }, '/devices/providers': { providers: [] },
    '/sync/accounts/summary': { accounts: [] },
    '/sync/accounts/web-summary': { accounts: [] },
  };
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(routes[request.url] ?? {}));
});
const wss = new WebSocketServer({ noServer: true });
const mobileClients = new Set();
let mobileConnections = 0;
let relayFrames = 0;
httpServer.on('upgrade', (request, socket, head) => wss.handleUpgrade(request, socket, head,
  (client) => wss.emit('connection', client, request)));
wss.on('connection', (socket, request) => {
  let joined = false;
  socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    if (request.url === '/device-switch') {
      socket.send(JSON.stringify({ type: 'devices-snapshot', devices }));
      return;
    }
    if (!joined) {
      joined = true;
      if (frame.role === 'mobile') {
        mobileClients.add(socket);
        mobileConnections += 1;
      }
      session.join(socket, { role: frame.role, deviceId: 'computer', ownerId: profile.id,
        expiresAt: Date.now() + 3600_000 }, frame, []);
    } else {
      if (frame.type === 'relay') relayFrames += 1;
      // Like the real gateway, reject frames from a closed session without crashing the fixture server.
      try { session.route(socket, frame); }
      catch (error) {
        console.error('Fixture rejected chat frame:', frame.type, error instanceof Error ? error.message : String(error));
        socket.close(4001, 'Chat connection rejected');
      }
    }
  });
  socket.on('close', () => { mobileClients.delete(socket); session.disconnect(socket); });
});
await new Promise((resolve) => httpServer.listen(1490, '127.0.0.1', resolve));
const vite = await createServer({ optimizeDeps: { entries: ['e2e/chat-harness.html'] },
  cacheDir: process.env.CHAT_TEST_CACHE, server: { port: 1488, host: '127.0.0.1' } });
await vite.listen();
const browser = await chromium.launch({ channel: process.env.CHAT_TEST_BROWSER
  ?? (process.platform === 'win32' ? 'msedge' : 'chromium'), headless: true });
page = await browser.newPage();
page.on('pageerror', (error) => console.error(error.message));
page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
page.on('requestfailed', (request) => console.error('Fixture request failed:', request.url(), request.failure()));
await page.goto('http://127.0.0.1:1488/e2e/chat-harness.html?role=desktop&demo&socket=ws://127.0.0.1:1490/device-chat',
  { timeout: 60_000 });
console.log('Emulator fixture ready at http://10.0.2.2:1490 (local test data only).');
process.on('SIGINT', async () => {
  await browser.close();
  await vite.close();
  for (const client of wss.clients) client.terminate();
  httpServer.close();
  process.exit(0);
});
