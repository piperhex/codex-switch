import http from 'node:http';
import WebSocket from 'ws';

const initial = () => ({ currentVersion: '1.5.0', latestVersion: null, phase: 'idle',
  notes: null, progress: null, error: null });
let status = initial();
let scenario = 'update';
let requests = [];
const devices = () => [
  { deviceId: 'pc', name: '工作电脑', platform: 'Windows', online: true, appVersion: status.currentVersion,
    capabilities: ['app-update'] },
  { deviceId: 'offline', name: '离线电脑', platform: 'macOS', online: false,
    appVersion: '1.4.0', capabilities: ['app-update'] },
  { deviceId: 'old', name: '旧版电脑', platform: 'Windows', online: true, appVersion: '1.3.0', capabilities: [] },
];
const server = http.createServer((request, response) => {
  if (request.url.startsWith('/reset')) {
    scenario = new URL(request.url, 'http://localhost').searchParams.get('scenario') ?? 'update';
    status = initial(); requests = [];
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ status, requests }));
});
const sockets = new WebSocket.Server({ server, path: '/device-switch' });
sockets.on('connection', (socket) => {
  const timers = [];
  const send = (message) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message)); };
  const later = (callback, delay) => { timers.push(setTimeout(callback, delay)); };
  socket.on('close', () => timers.forEach(clearTimeout));
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'subscribe-devices') { send({ type: 'devices-snapshot', devices: devices() }); return; }
    requests.push(message);
    if (message.type !== 'app-update') return;
    if (message.action === 'check') status = { ...status,
      phase: scenario === 'latest' ? 'idle' : 'available', latestVersion: scenario === 'latest' ? null : '1.6.0',
      notes: scenario === 'latest' ? null : '改善连接稳定性。\n优化电脑端使用体验。', error: null };
    if (message.action === 'install') {
      status = { ...status, phase: 'downloading', progress: 25 };
      if (scenario === 'failure') later(() => {
        status = { ...status, phase: 'error', error: '安装更新失败，请稍后重试。' };
      }, 300);
      else later(() => {
        send({ type: 'device-offline', deviceId: 'pc' });
        later(() => {
          status = { ...initial(), currentVersion: '1.6.0' };
          send({ type: 'device-online', device: devices()[0] });
        }, 600);
      }, 600);
    }
    send({ type: 'app-update-result', requestId: message.requestId, data: status });
  });
});
server.listen(1459, '127.0.0.1');
