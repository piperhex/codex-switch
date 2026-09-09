// Opt-in real Windows CUA integration: uses temporary homes and never changes the user's configuration.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const executable = path.resolve('apps/desktop/src-tauri/target/debug/csw.exe');
const source = process.env.CSW_CUA_DRIVER_DIRECTORY;
const codex = process.env.CSW_CUA_CODEX_BINARY;
const version = '0.25.0';
const timeoutMs = 30000;

function rpc(child) {
  const waiting = new Map();
  let nextId = 0;
  createInterface({ input: child.stdout }).on('line', line => {
    const reply = JSON.parse(line);
    waiting.get(reply.id)?.(reply);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Timed out: ${method}`)); }, timeoutMs);
    waiting.set(id, reply => { clearTimeout(timer); waiting.delete(id); resolve(reply); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function fixture(root, name) {
  const home = path.join(root, name);
  const id = createHash('sha256').update(home.replaceAll('\\', '/').toLowerCase()).digest('hex');
  const argument = `--computer-use-mcp=${id}`;
  const record = { home, enabled: true, generation: randomUUID() };
  const recordPath = path.join(root, 'homes', `${id}.json`);
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(path.dirname(recordPath), { recursive: true });
  const save = async () => {
    await fs.writeFile(`${recordPath}.tmp`, JSON.stringify(record));
    await fs.rename(`${recordPath}.tmp`, recordPath);
  };
  await save();
  await fs.writeFile(path.join(home, 'config.toml'),
    `[mcp_servers.codex_switch_computer_use]\ncommand = ${JSON.stringify(executable)}\n`
    + `args = [${JSON.stringify(argument)}]\nenabled = true\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\n`
    + `[mcp_servers.codex_switch_computer_use.env]\nCSW_COMPUTER_USE_TEST_ROOT = ${JSON.stringify(root)}\n`);
  return { record, save, argument };
}

function start(root, argument) {
  const child = spawn(executable, [argument], { windowsHide: true,
    env: { ...process.env, CSW_COMPUTER_USE_TEST_ROOT: root }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {}); // Driver diagnostics stay out of protocol assertions and user screen data.
  return child;
}

async function initialize(child) {
  const call = rpc(child);
  const reply = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'codex-switch-verification', version: '1.0.0' } });
  assert.ok(reply.result?.serverInfo);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return call;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.stdin.end();
  await exited;
}

async function readyServer(call, threadId) {
  const deadline = Date.now() + timeoutMs;
  let server;
  do {
    const result = await call('mcpServerStatus/list', { threadId });
    server = result.result?.data.find(server => server.name === 'codex_switch_computer_use');
    if (server && Object.keys(server.tools).length > 0) return server;
    if (server?.runtimeStatus === 'failed') throw new Error('CUA failed to start in Codex');
    await delay(300);
  } while (Date.now() < deadline);
  throw new Error(`CUA did not become ready in Codex: ${JSON.stringify(server)}`);
}

test('real CUA MCP discovers tools, returns images and revokes only the selected home',
  { skip: process.platform !== 'win32' || !source, timeout: 90000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'csw-computer-use-'));
    const children = [];
    try {
      const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
      await fs.cp(source, path.join(root, `${version}-windows-${architecture}`), { recursive: true });
      const first = await fixture(root, 'first');
      const second = await fixture(root, 'second');
      const firstChild = start(root, first.argument); children.push(firstChild);
      const secondChild = start(root, second.argument); children.push(secondChild);
      const firstCall = await initialize(firstChild);
      const secondCall = await initialize(secondChild);
      const tools = (await firstCall('tools/list')).result.tools;
      for (const name of ['list_apps', 'get_window_state', 'click', 'type_text', 'get_desktop_state']) {
        assert.ok(tools.some(tool => tool.name === name), `Missing ${name}`);
      }
      const apps = await firstCall('tools/call', { name: 'list_apps', arguments: {} });
      assert.notEqual(apps.result?.isError, true);
      assert.ok(apps.result?.content.length);
      const screenshot = await firstCall('tools/call', { name: 'get_desktop_state', arguments: {} });
      assert.notEqual(screenshot.result?.isError, true);
      assert.ok(screenshot.result?.content.some(part => part.type === 'image' && part.data.length > 100));
      const exited = once(firstChild, 'exit');
      first.record.enabled = false;
      first.record.generation = randomUUID();
      await first.save();
      await exited;
      assert.ok((await secondCall('tools/list')).result.tools.length > 0);
      const denied = start(root, first.argument); children.push(denied);
      assert.equal((await once(denied, 'exit'))[0], 1);
    } finally {
      await Promise.all(children.map(stop));
      await fs.rm(root, { recursive: true, force: true });
    }
  });

test('the GUI-managed Codex CLI loads the computer-use tools from the selected home',
  { skip: process.platform !== 'win32' || !source || !codex, timeout: 90000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'csw-cua-codex-'));
    let child;
    let selected;
    try {
      const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
      await fs.cp(source, path.join(root, `${version}-windows-${architecture}`), { recursive: true });
      selected = await fixture(root, 'codex-home');
      await fs.writeFile(path.join(selected.record.home, 'auth.json'),
        JSON.stringify({ OPENAI_API_KEY: 'fixture-no-model-request' }));
      child = spawn(codex, ['app-server'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
        ...process.env, CODEX_HOME: selected.record.home, CSW_COMPUTER_USE_TEST_ROOT: root,
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'codex-tui',
      } });
      child.stderr.on('data', () => {});
      const call = rpc(child);
      await call('initialize', { clientInfo: { name: 'codex-tui', title: 'Codex Switch', version: '0.153.4' },
        capabilities: { experimentalApi: true } });
      child.stdin.write('{"method":"initialized"}\n');
      const thread = await call('thread/start', { cwd: selected.record.home, ephemeral: true });
      assert.ok(thread.result?.thread.id, 'Codex starts an isolated test conversation without a model request');
      const server = await readyServer(call, thread.result.thread.id);
      assert.ok(server, 'Codex discovers the configured server');
      assert.ok(Object.keys(server.tools).some(name => name.endsWith('get_window_state')),
        'Codex completes the CUA handshake and discovers native desktop tools');
    } finally {
      if (selected) { selected.record.enabled = false; await selected.save(); }
      if (child) await stop(child);
      await fs.rm(root, { recursive: true, force: true });
    }
  });
