import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { execute } from '../apps/desktop/src-tauri/resources/chrome-extension/operations.js';
import { initializePermissions } from '../apps/desktop/src-tauri/resources/chrome-extension/permissions.js';
import { validate } from '../apps/desktop/src-tauri/resources/chrome-extension/validation.js';
import { stopWorkers } from '../apps/desktop/src-tauri/resources/chrome-extension/worker-driver.js';

let targets;
let listeners;
let calls;
let allowed;
let command;
const emit = (source, method, params) => listeners.forEach(listener => listener(source, method, params));
const run = (args, signal) => execute({ clientId: 'home', signal }, { operation: 'console_logs', args });

beforeEach(async () => {
  targets = [
    { id: 'shared', type: 'worker', url: 'https://fixture.example/shared.js', title: 'Shared Worker' },
    { id: 'service', type: 'worker', url: 'https://fixture.example/sw.js', title: 'Service Worker' },
    { id: 'extension', type: 'worker', url: 'chrome-extension://secret/worker.js' },
    { id: 'opaque', type: 'worker', url: 'blob:null/id' },
    { id: 'frame', type: 'other', url: 'https://fixture.example/frame' },
  ];
  listeners = new Set();
  calls = [];
  allowed = true;
  command = async (target, method) => {
    if (method === 'Runtime.enable') {
      emit(target, 'Runtime.executionContextCreated', { context: { id: 1 } });
      emit(target, 'Runtime.consoleAPICalled', { executionContextId: 1, type: 'warning', timestamp: 100,
        args: [{ type: 'string', value: 'worker warning' }] });
      emit({ targetId: 'unrelated' }, 'Runtime.consoleAPICalled', { executionContextId: 1, type: 'log', timestamp: 101,
        args: [{ value: 'private' }] });
    }
    if (method === 'Log.enable') emit(target, 'Log.entryAdded', { entry: {
      source: 'network', level: 'error', timestamp: 200, text: 'request failed', url: 'https://fixture.example/missing',
    } });
    return {};
  };
  globalThis.chrome = {
    storage: { local: { get: async () => ({ paused: false, siteAccessMode: 'all' }) } },
    permissions: { contains: async () => allowed },
    debugger: {
      getTargets: async () => targets,
      attach: async target => { calls.push({ method: 'attach', target }); },
      detach: async target => { calls.push({ method: 'detach', target }); },
      onEvent: { addListener: listener => listeners.add(listener),
        removeListener: listener => listeners.delete(listener) },
      sendCommand: async (target, method) => { calls.push({ target, method }); return command(target, method); },
    },
  };
  await initializePermissions();
});

test('lists only standalone web workers and never exposes extension or opaque worker targets', async () => {
  const result = await execute({ clientId: 'home' }, { operation: 'workers' });
  assert.equal(result.scope, 'profile');
  assert.deepEqual(result.workers.map(worker => worker.workerId), ['shared', 'service']);
  assert.equal(calls.length, 0);
});

test('bounds worker discovery metadata and reports omitted targets', async () => {
  targets = Array.from({ length: 150 }, (_, index) => ({ id: String(index), type: 'worker',
    url: 'https://fixture.example/' + 'a'.repeat(10000), title: '汉'.repeat(10000) }));
  const result = await execute({ clientId: 'home' }, { operation: 'workers' });
  assert.equal(result.workers.length, 100);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024 * 1024);
});

test('reads an explicitly selected worker and isolates its events without a tab', async () => {
  const result = await run({ workerId: 'shared' });
  assert.deepEqual(result.entries.map(entry => entry.source), ['worker', 'network']);
  assert.deepEqual(result.entries.map(entry => entry.text), ['worker warning', 'request failed']);
  assert.ok(result.entries.every(entry => entry.workerId === 'shared' && entry.scope === 'worker'));
  assert.equal(result.entries[0].workerUrl, targets[0].url);
  assert.deepEqual(calls[0], { method: 'attach', target: { targetId: 'shared' } });
  assert.deepEqual(calls.at(-1), { method: 'detach', target: { targetId: 'shared' } });
  assert.equal(listeners.size, 0);
});

test('standalone source filtering only enables the needed domains', async () => {
  assert.equal((await run({ workerId: 'service', source: 'network' })).entries[0].source, 'network');
  assert.ok(!calls.some(call => call.method === 'Runtime.enable'));
  calls.length = 0;
  assert.equal((await run({ workerId: 'service', source: 'worker' })).entries[0].level, 'warn');
  assert.ok(!calls.some(call => call.method === 'Log.enable'));
});

test('rejects missing, forbidden and changed worker targets before returning logs', async () => {
  for (const workerId of ['missing', 'extension', 'opaque', 'frame']) await assert.rejects(run({ workerId }), /Worker/);
  assert.equal(calls.length, 0);
  command = async () => { targets[0].url = 'https://other.example/shared.js'; return {}; };
  await assert.rejects(run({ workerId: 'shared' }), /已变化/);
  assert.equal(listeners.size, 0);
  assert.equal(calls.at(-1).method, 'detach');
});

test('permission revocation and cancellation reject reads and release worker debugger sessions', async () => {
  allowed = false;
  await assert.rejects(run({ workerId: 'shared' }), /Chrome/);
  assert.equal(calls.length, 0);
  allowed = true;
  const controller = new AbortController();
  command = async () => { controller.abort(); await stopWorkers(); return {}; };
  await assert.rejects(run({ workerId: 'shared' }, controller.signal), /取消/);
  assert.equal(listeners.size, 0);
  assert.ok(calls.some(call => call.method === 'detach' && call.target.targetId === 'shared'));
  command = async () => { allowed = false; return {}; };
  await assert.rejects(run({ workerId: 'shared' }), /Chrome/);
  assert.equal(listeners.size, 0);
});

test('validates exclusive log targets and rejects page-only reads for a worker', () => {
  for (const args of [{}, { workerId: '' }, { workerId: 'a', tabId: 1 },
    { workerId: 'a', frameId: 'frame' }, { workerId: 'a', source: 'page' }]) {
    assert.throws(() => validate({ operation: 'console_logs', args }));
  }
  assert.equal(validate({ operation: 'console_logs', args: { workerId: 'shared', source: 'worker' } }).operation,
    'console_logs');
});
