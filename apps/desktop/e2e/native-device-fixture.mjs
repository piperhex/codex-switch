// Local-only coordinator/echo fixture for the separately installed Android release test package.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const extension = process.platform === 'win32' ? '.exe' : '';
const binaries = path.join(root, 'crates/chat-connectivity/target/debug');
const output = path.join(root, '.codex-tmp/native-device-fixture');
await mkdir(output, { recursive: true });
const coordinator = spawn(path.join(binaries, `chat-rendezvous${extension}`), [], {
  env: { ...process.env, CHAT_RENDEZVOUS_SECRET: randomBytes(32).toString('hex') }, stdio: 'inherit',
});
const children = new Set([coordinator]);
let mode = 'native';
let sequence = 0;
let latestResult;
const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  try {
    if (request.url === '/app') { mode = 'app'; response.end('{}'); return; }
    if (request.url === '/native') { mode = 'native'; response.end('{}'); return; }
    if (request.url === '/result' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      latestResult = JSON.parse(body);
      await writeFile(path.join(output, `result-${sequence}.json`), JSON.stringify(latestResult, null, 2));
      console.log('DEVICE_RESULT', JSON.stringify(latestResult));
      response.end('{}'); return;
    }
    if (request.url === '/result') { response.end(JSON.stringify(latestResult ?? null)); return; }
    if (request.url !== '/config') { response.writeHead(404).end('{}'); return; }
    if (mode === 'app') { response.end(JSON.stringify({ mode })); return; }
    latestResult = undefined;
    sequence += 1;
    const config = { sessionId: `device-fixture-${Date.now()}`, secret: randomBytes(32).toString('hex'),
      servers: ['tcp://127.0.0.1:11010'], stunServers: [], desktop: true, expiresAt: Date.now() + 300_000 };
    const peer = spawn(path.join(binaries, 'examples', `device_echo${extension}`), [], {
      env: { ...process.env, DEVICE_FIXTURE_CONFIG: JSON.stringify(config) }, stdio: 'inherit',
    });
    children.add(peer);
    peer.on('exit', () => children.delete(peer));
    peer.on('error', error => console.error('Echo fixture failed:', error.message));
    response.end(JSON.stringify({ mode, options: { sessionId: config.sessionId, desktop: false,
      config: { ...config, desktop: false } } }));
  } catch (error) { console.error(error); response.writeHead(500).end('{}'); }
});
server.listen(15049, '127.0.0.1', () => console.log('Native device fixture ready on localhost:15049'));
function stop() { for (const child of children) child.kill(); server.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
coordinator.on('error', error => { console.error(error); stop(); process.exitCode = 1; });
