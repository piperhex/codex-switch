// Local sample data only; never forwards requests to a real account or device.
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../admin/package.json', import.meta.url));
const { WebSocketServer } = require('ws');

const now = new Date().toISOString();
const profile = { id: 'web-review', email: 'review@example.test', role: 'admin', roleName: '管理员' };
const accounts = [57, 100, 12, null].map((remaining, index) => ({
  id: `account-${index}`, email: ['alex@example.test', 'studio@example.test',
    'long-account-name-for-layout@example.test', 'free@example.test'][index],
  plan: index === 3 ? 'free' : 'plus', accountId: `sample-account-${index}`, active: index === 0,
  note: '工作账号。这里是一段较长的备注，用于检查窄屏下的省略与完整内容查看。',
  expiresAt: '2027-12-31', source: 'personal',
  privateDetails: { password: 'sample-password', phoneNumber: '13800000000', totpSecret: 'JBSWY3DPEHPK3PXP' },
  usage: { primary: remaining === null ? null : { remainingPercent: remaining, usedPercent: 100 - remaining,
    resetsAt: Math.floor(Date.now() / 1000) + 7200 },
  secondary: { remainingPercent: 77, usedPercent: 23 }, fetchedAt: now, apiExpiresAt: '2027-10-01' },
}));
const devices = [
  { deviceId: 'sample-pc', name: '我的工作电脑', platform: 'Windows', online: true,
    activeAccountId: accounts[0].id, activeProviderId: null, activeProviderGroup: null,
    guiAccountId: accounts[1].id, guiProviderId: null,
    capabilities: ['provider-switch', 'provider-group-switch', 'gui-model-switch'],
    lastSeenAt: now, localProxyRunning: true },
  { deviceId: 'offline-pc', name: '备用电脑', platform: 'Windows', online: false,
    activeAccountId: accounts[0].id, capabilities: [], lastSeenAt: now, localProxyRunning: false },
];
const initialDevices = structuredClone(devices);
const providers = [{ id: 'provider-1', name: '测试 Provider', model: 'test-model', group: '工作分组' }];
let credits = [{ issuedAt: now, expiresAt: '2027-12-31' }];
let vault = { entries: ['GitHub', 'OpenAI', 'AWS'].map((issuer, index) => ({
  id: `totp-${index}`, issuer, accountName: `review-${index}@example.test`, secret: 'JBSWY3DPEHPK3PXP',
  algorithm: 'SHA1', digits: index === 2 ? 8 : 6, period: 30,
  createdAt: `2026-09-${10 + index}T00:00:00.000Z`, updatedAt: now,
})), tombstones: [], modifiedAt: now };
const initialVault = structuredClone(vault);

const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  const path = request.url;
  let body = '';
  for await (const chunk of request) body += chunk;
  const account = accounts.find((item) => path?.includes(`/accounts/${item.id}/`));
  let result;
  if (path === '/test/reset' && request.method === 'POST') {
    vault = structuredClone(initialVault);
    devices.splice(0, devices.length, ...structuredClone(initialDevices));
    result = { ok: true };
  } else if (path === '/auth/login' || path === '/auth/refresh') {
    result = { accessToken: 'local-review', refreshToken: 'local-review-refresh', user: profile };
  } else if (path === '/auth/me') result = profile;
  else if (path === '/sync/accounts/web-summary') result = { accounts };
  else if (path === '/devices') result = { devices };
  else if (path === '/devices/providers') result = { providers };
  else if (path?.startsWith('/devices/sample-pc/') && request.method === 'POST') {
    const device = devices[0];
    const input = JSON.parse(body);
    switch (path.split('/').at(-1)) {
      case 'gui-account': device.guiAccountId = input.accountId; device.guiProviderId = null; break;
      case 'gui-provider': device.guiAccountId = null; device.guiProviderId = input.providerId; break;
      case 'account':
        device.activeAccountId = input.accountId; device.activeProviderId = null; device.activeProviderGroup = null;
        break;
      case 'provider': device.activeProviderId = input.providerId; device.activeProviderGroup = null; break;
      case 'provider-group': device.activeProviderId = null; device.activeProviderGroup = input.group; break;
      default: response.writeHead(404);
    }
    result = { ...device, requiresRestart: false };
  }
  else if (path === '/sync/totp') {
    if (request.method === 'PUT') {
      const incoming = JSON.parse(body);
      const entries = new Map([...vault.entries, ...incoming.entries].map(entry => [entry.id, entry]));
      for (const tombstone of incoming.tombstones) entries.delete(tombstone.id);
      vault = { ...incoming, entries: [...entries.values()] };
    }
    result = vault;
  } else if (account && path.endsWith('/usage')) result = account.usage;
  else if (account && path.endsWith('/details')) {
    if (request.method === 'PATCH') Object.assign(account, JSON.parse(body));
    result = account;
  } else if (account && path.endsWith('/reset-credits/consume')) {
    credits = credits.slice(1);
    result = { ok: true };
  } else if (account && path.endsWith('/reset-credits')) result = { credits };
  else if (path === '/admin/api/profile/password' || path === '/auth/logout') result = { ok: true };
  else { response.writeHead(404); result = { message: '本地预览暂不提供此操作' }; }
  response.end(JSON.stringify(result));
});
const sockets = new WebSocketServer({ server });
sockets.on('connection', (socket) => socket.on('message', () => {
  socket.send(JSON.stringify({ type: 'devices-snapshot', devices }));
}));
server.listen(1491, '127.0.0.1', () => console.log('Management fixture: http://127.0.0.1:1491'));
