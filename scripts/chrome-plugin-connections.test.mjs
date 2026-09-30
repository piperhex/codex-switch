import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { acquireConnection, assertConnected, closeConnection, releaseConnection, debuggerDetached,
  hasDebuggerConnections, stopConnections, DEBUGGER_IDLE_MS }
  from '../apps/desktop/src-tauri/resources/chrome-extension/debugger-connections.js';
import { initializePermissions } from '../apps/desktop/src-tauri/resources/chrome-extension/permissions.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
let calls;
beforeEach(async () => {
  calls = [];
  globalThis.chrome = {
    storage: { local: { get: async () => ({ paused: false }) },
      session: { get: async () => ({}), set: async () => {} } },
    debugger: { attach: async target => calls.push(['attach', target]),
      detach: async target => calls.push(['detach', target]) },
  };
  await initializePermissions();
});
afterEach(() => stopConnections());

test('idle connections survive gaps, renew their deadline and eventually detach', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = await acquireConnection({ tabId: 1 });
  await releaseConnection(first, true);
  t.mock.timers.tick(DEBUGGER_IDLE_MS - 1);
  assert.equal(calls.length, 1);
  const second = await acquireConnection({ tabId: 1 });
  assert.equal(first, second);
  await releaseConnection(second, true);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(DEBUGGER_IDLE_MS - 1);
  await flush();
  assert.deepEqual(calls, [['attach', { tabId: 1 }], ['detach', { tabId: 1 }]]);
  assert.equal(hasDebuggerConnections(), false);
});

test('an active operation cannot be detached by its previous idle deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await releaseConnection(await acquireConnection({ tabId: 1 }), true);
  const active = await acquireConnection({ tabId: 1 });
  t.mock.timers.tick(DEBUGGER_IDLE_MS * 2);
  await flush();
  assertConnected(active);
  assert.equal(calls.length, 1);
  await releaseConnection(active, false);
  assert.equal(calls.at(-1)[0], 'detach');
});

test('stop releases both retained and active connections, including workers', async () => {
  await releaseConnection(await acquireConnection({ tabId: 1 }), true);
  const active = await acquireConnection({ targetId: 'worker' });
  await stopConnections();
  assert.equal(calls.filter(([method]) => method === 'detach').length, 2);
  assert.throws(() => assertConnected(active), /已结束/);
  await releaseConnection(active, true);
  assert.equal(hasDebuggerConnections(), false);
});

test('stop during attach waits for and releases the newly established connection', async () => {
  let finishAttach;
  chrome.debugger.attach = () => new Promise(resolve => { finishAttach = resolve; });
  const attaching = acquireConnection({ tabId: 1 });
  const rejected = assert.rejects(attaching, /已结束/);
  const stopping = stopConnections();
  finishAttach();
  await Promise.all([rejected, stopping]);
  assert.deepEqual(calls, [['detach', { tabId: 1 }]]);
  assert.equal(hasDebuggerConnections(), false);
});

test('an aborted attach is not retained and failed attaches can retry', async () => {
  const controller = new AbortController();
  chrome.debugger.attach = async () => controller.abort();
  await assert.rejects(acquireConnection({ tabId: 1 }, controller.signal), /取消/);
  assert.equal(hasDebuggerConnections(), false);
  chrome.debugger.attach = async () => { throw new Error('busy'); };
  await assert.rejects(acquireConnection({ tabId: 1 }), /busy/);
  assert.equal(hasDebuggerConnections(), false);
  chrome.debugger.attach = async () => {};
  assertConnected(await acquireConnection({ tabId: 1 }));
});

test('Chrome detachment invalidates cached connections without detaching a replacement', async () => {
  const old = await acquireConnection({ tabId: 1 });
  await releaseConnection(old, true);
  await debuggerDetached({ tabId: 1 });
  assert.throws(() => assertConnected(old), /已结束/);
  const next = await acquireConnection({ tabId: 1 });
  await releaseConnection(old, false);
  assertConnected(next);
  assert.equal(calls.filter(([method]) => method === 'attach').length, 2);
  assert.ok(!calls.some(([method]) => method === 'detach'));
});

test('a request waits for an idle detach before attaching again', async () => {
  const old = await acquireConnection({ tabId: 1 });
  let finishDetach;
  chrome.debugger.detach = () => new Promise(resolve => { finishDetach = resolve; });
  const closing = closeConnection(old);
  await flush();
  const opening = acquireConnection({ tabId: 1 });
  await flush();
  assert.equal(calls.length, 1);
  finishDetach();
  await closing;
  const next = await opening;
  assertConnected(next);
  assert.equal(calls.length, 2);
  chrome.debugger.detach = async () => {};
});
