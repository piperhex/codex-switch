// Runs the packaged headless host against a loopback TLS coordinator. Native capture is replaced by fixed RPC replies.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { prepareDesktopService } from './prepare-desktop-service.mjs';

await prepareDesktopService();
const root = resolve('.codex-tmp/desktop-service-test');
await mkdir(root, { recursive: true });
const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
const cert = resolve(root, 'cert.pem');
const key = resolve(root, 'key.pem');
const generated = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
{ windowsHide: true, stdio: 'pipe' });
assert.equal(generated.status, 0, 'OpenSSL fixture generation failed');
const library = resolve(root, 'link.mjs');
await build({ stdin: { contents: "export { ChatLink } from './shared/remote-chat/link';" +
  "export { keyPair } from './shared/remote-chat/cipher';", resolveDir: process.cwd() },
outfile: library, bundle: true, platform: 'node', format: 'esm' });
const { ChatLink, keyPair } = await import(pathToFileURL(library).href);
const server = createServer({ cert: await readFile(cert), key: await readFile(key) });
const sockets = new WebSocket.Server({ server });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const baseUrl = `https://127.0.0.1:${server.address().port}`;
const credential = 'csw-desktop-service-' + 'a'.repeat(64);
const deviceId = '0f992083-ff67-4937-8519-77a54d252bce';
const native = [];
const links = new Map();
let serial = 0;
let child;
const authenticated = new Set();
let failure;
const responses = new Map();
const until = async predicate => {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (failure) throw failure;
    assert(Date.now() < deadline, 'headless host response timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
let host;
sockets.on('connection', (socket, request) => socket.on('message', async data => {
  try {
    const message = JSON.parse(data.toString());
    if (message.type === 'authenticate') {
      assert.equal(message.accessToken, credential); assert.equal(message.deviceId, deviceId);
      authenticated.add(request.url);
      if (request.url === '/device-chat') host = socket;
      return;
    }
    const link = links.get(message.sessionId);
    if (message.type === 'signal' && message.payload.kind === 'key') {
      assert.equal(message.payload.identity.key, 'b'.repeat(64));
      await link.acceptSignal(message.payload); link.enableRelay();
      socket.send(JSON.stringify({ type: 'relay-ready', sessionId: message.sessionId }));
    }
    if (message.type === 'relay') link.receive(message.payload);
  } catch (error) { failure = error; }
}));
try {
  const runtime = resolve('apps/desktop/src-tauri/resources/desktop-service');
  child = spawn(resolve(runtime, 'node.exe'), [resolve(runtime, 'host.mjs')], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '', NODE_EXTRA_CA_CERTS: cert },
  });
  child.on('error', error => { failure = error; });
  child.stderr.on('data', data => { failure = new Error(`Host diagnostic: ${data.toString()}`); });
  const input = createInterface({ input: child.stdout });
  input.on('line', line => {
    try {
      const call = JSON.parse(line); let data;
      if (call.command === 'service_configuration') data = { baseUrl, credential, deviceId, name: 'Fixture', version: 'test' };
      else if (call.command === 'service_sign') data = { key: 'b'.repeat(64), signature: 'c'.repeat(128) };
      else {
        native.push(call);
        switch (call.command) {
          case 'remote_desktop_stream_available': data = true; break;
          case 'remote_desktop_open':
            assert(call.args.expiresAt > Date.now()); data = { id: 'native-fixture', permissions: { control: false } }; break;
          case 'remote_desktop_stream_open': data = { sdp: 'fixture-offer' }; break;
          case 'remote_desktop_stream_status': data = { closed: false }; break;
          case 'remote_desktop_stream_close': case 'remote_desktop_close': case 'remote_desktop_renew': data = null; break;
          default: throw new Error(`Unexpected privileged command: ${call.command}`);
        }
      }
      child.stdin.write(JSON.stringify({ id: call.id, data }) + '\n');
    } catch (error) { failure = error; }
  });
  await until(() => authenticated.size === 2);
  for (const transportVersion of [1, 2]) {
    const sessionId = `fixture-${transportVersion}`;
    const keys = keyPair(size => crypto.getRandomValues(new Uint8Array(size)));
    const link = new ChatLink({ sessionId, transportVersion, desktop: false, secret: keys.secret, iceServers: [],
      createPeer: () => ({ offer: async () => {}, accept: async () => {}, close() {} }), relayBuffered: () => 0,
      signal: message => host.send(JSON.stringify(message)), mode() {}, error: text => { failure = new Error(text); },
      message: message => responses.set(message.id, message) });
    links.set(sessionId, link);
    host.send(JSON.stringify({ type: 'peer-open', sessionId, transportVersion, publicKey: keys.publicKey,
      resumeToken: 'fixture-resume', expiresAt: Date.now() + 60_000, desktopIceServers: [] }));
    const rpc = async (method, body) => {
      const id = String(++serial);
      await link.send({ kind: 'request', id, method, body });
      await until(() => responses.has(id)); return responses.get(id);
    };
    assert.equal((await rpc('connect', {})).data.desktopOnly, true);
    assert.match((await rpc('request', { operation: 'command', command: 'whoami' })).error, /先登录电脑/);
    const desktop = { operation: 'remoteDesktop', id: 'fixture-desktop', action: 'open',
      settings: { quality: 'auto', fps: 'auto' } };
    const opened = await rpc('request', desktop);
    assert.equal(opened.data.sdp, 'fixture-offer');
    assert.equal(opened.data.capabilities.control, false);
    await rpc('request', { ...desktop, action: 'close' });
    host.send(JSON.stringify({ type: 'peer-close', sessionId })); link.close(); links.delete(sessionId);
  }
  assert.equal(native.filter(call => call.command === 'remote_desktop_open').length, 2);
  console.log('Headless host passed: TLS registration, encrypted v1/v2 chat, desktop-only RPCs, expiry, permissions, cleanup.');
} finally {
  for (const link of links.values()) link.close();
  if (child) { child.kill(); await once(child, 'exit').catch(() => {}); }
  for (const socket of sockets.clients) socket.terminate();
  sockets.close(); server.close();
}
