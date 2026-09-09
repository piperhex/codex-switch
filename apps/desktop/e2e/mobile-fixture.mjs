// Local emulator fixture only. It never connects to a cloud account or an AI provider.
import http from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const require = createRequire(new URL('../../admin/package.json', import.meta.url));
const { WebSocketServer } = require('ws');
const { ChatSessions } = require('./dist/modules/devices/chat/chat-sessions.js');
const session = new ChatSessions();
const profile = { id: 'test-owner', email: 'mobile-test@example.test', role: 'user' };
const devices = [{ deviceId: 'computer', name: '我的工作电脑', platform: 'Windows', online: true,
  localProxyRunning: false, capabilities: [], lastSeenAt: new Date().toISOString() }];
const httpServer = http.createServer((request, response) => {
  const routes = {
    '/auth/login': { accessToken: 'local-test-token', refreshToken: 'local-test-refresh', user: profile },
    '/auth/me': profile,
    '/devices': { devices }, '/devices/providers': { providers: [] },
    '/sync/accounts/summary': { accounts: [] },
  };
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(routes[request.url] ?? {}));
});
const wss = new WebSocketServer({ noServer: true });
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
      session.join(socket, { role: frame.role, deviceId: 'computer', ownerId: profile.id,
        expiresAt: Date.now() + 3600_000 }, frame, []);
    } else session.route(socket, frame);
  });
  socket.on('close', () => session.disconnect(socket));
});
await new Promise((resolve) => httpServer.listen(1490, '127.0.0.1', resolve));
const vite = await createServer({ server: { port: 1488, host: '127.0.0.1' } });
await vite.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
page.on('pageerror', (error) => console.error(error.message));
await page.goto('http://127.0.0.1:1488/e2e/chat-harness.html?role=desktop&demo&socket=ws://127.0.0.1:1490/device-chat');
console.log('Emulator fixture ready at http://10.0.2.2:1490 (local test data only).');
process.on('SIGINT', async () => {
  await browser.close();
  await vite.close();
  for (const client of wss.clients) client.terminate();
  httpServer.close();
  process.exit(0);
});
