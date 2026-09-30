import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { withTab, stopDebugging } from '../apps/desktop/src-tauri/resources/chrome-extension/driver.js';
import { initializePermissions } from '../apps/desktop/src-tauri/resources/chrome-extension/permissions.js';

let calls;
let listeners;
let allowed;
let send;
const cleanup = ['Target.setAutoAttach', 'Runtime.disable', 'Log.disable'];
afterEach(() => stopDebugging());
beforeEach(async () => {
  calls = [];
  listeners = new Set();
  allowed = true;
  send = async method => method === 'Page.getLayoutMetrics'
    ? { cssLayoutViewport: { clientWidth: 1280, clientHeight: 720 } } : {};
  globalThis.chrome = {
    permissions: { contains: async () => allowed },
    storage: { local: { get: async () => ({ paused: false, siteAccessMode: 'all' }) },
      session: { get: async () => ({}), set: async () => {} } },
    tabs: { get: async () => ({ id: 4, active: false, url: 'https://fixture.example/' }) },
    windows: { get: async () => ({ width: 1000, height: 800, state: 'minimized', focused: false }) },
    scripting: { executeScript: async () => {} },
    debugger: {
      attach: async () => calls.push('attach'), detach: async () => calls.push('detach'),
      onEvent: { addListener: callback => listeners.add(callback),
        removeListener: callback => listeners.delete(callback) },
      sendCommand: async (_target, method, params) => { calls.push(method); return send(method, params); },
    },
  };
  await initializePermissions();
});

test('prepares input and restores rendering while retaining the debugger between operations', async () => {
  const result = await withTab({ clientId: 'test' }, { tabId: 4 }, async driver => {
    await driver.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 });
    return { clicked: true };
  });
  assert.deepEqual(result, { clicked: true });
  assert.deepEqual(calls, ['attach', 'Emulation.setFocusEmulationEnabled', 'Page.getLayoutMetrics',
    'Target.setAutoAttach', 'Input.dispatchMouseEvent', 'Runtime.evaluate',
    ...cleanup, 'Emulation.setFocusEmulationEnabled']);
  assert.equal(listeners.size, 0);
  await withTab({ clientId: 'test' }, { tabId: 4 }, async () => 'next');
  assert.equal(calls.filter(method => method === 'attach').length, 1);
  assert.ok(!calls.includes('detach'));
  await stopDebugging();
  assert.equal(calls.at(-1), 'detach');
});

test('diagnostic reads avoid focus emulation and rendering waits but still recheck access', async () => {
  const read = operation => withTab({ clientId: 'test' }, { tabId: 4 }, operation, { prepareInput: false });
  assert.equal(await read(async () => 'logs'), 'logs');
  assert.deepEqual(calls, ['attach', 'Target.setAutoAttach', ...cleanup]);
  await assert.rejects(read(async () => { allowed = false; return 'private logs'; }), /Chrome/);
  assert.equal(calls.at(-1), 'detach');
  assert.equal(listeners.size, 0);
});

test('a zero-sized minimized page gets a temporary viewport without restoring or focusing its window', async () => {
  const commands = [];
  send = async (method, params) => {
    commands.push({ method, params });
    return method === 'Page.getLayoutMetrics' ? { cssLayoutViewport: { clientWidth: 0, clientHeight: 0 } } : {};
  };
  await withTab({ clientId: 'test' }, { tabId: 4 }, async () => 'ready');
  assert.deepEqual(commands.find(item => item.method === 'Emulation.setDeviceMetricsOverride').params,
    { width: 1000, height: 800, deviceScaleFactor: 0, mobile: false });
  assert.deepEqual(calls.slice(-2), ['Emulation.setFocusEmulationEnabled', 'Emulation.clearDeviceMetricsOverride']);
  assert.ok(!calls.includes('detach'));
});

test('failed background preparation never dispatches input and still releases the debugger', async () => {
  send = async method => {
    if (method === 'Emulation.setFocusEmulationEnabled') throw new Error('unavailable');
    return {};
  };
  await assert.rejects(withTab({ clientId: 'test' }, { tabId: 4 }, async () => {
    assert.fail('must not dispatch input without preparing the renderer');
  }), /unavailable/);
  assert.deepEqual(calls,
    ['attach', 'Emulation.setFocusEmulationEnabled', ...cleanup, 'Emulation.setFocusEmulationEnabled', 'detach']);
  assert.equal(listeners.size, 0);
});

test('navigation during rendering does not erase the dispatched result', async () => {
  send = async method => { if (method === 'Runtime.evaluate') throw new Error('context destroyed'); return {}; };
  assert.equal(await withTab({ clientId: 'test' }, { tabId: 4 }, async () => 'dispatched'), 'dispatched');
  assert.ok(!calls.includes('detach'));
});

test('rendering waits never swallow permission revocation or cancellation', async () => {
  const controller = new AbortController();
  for (const revoke of [() => { allowed = false; }, () => controller.abort()]) {
    allowed = true;
    send = async method => { if (method === 'Runtime.evaluate') { revoke(); throw new Error('detached'); } return {}; };
    await assert.rejects(withTab({ clientId: 'test', signal: controller.signal }, { tabId: 4 }, async () => 'sent'),
      /Chrome|取消/);
    assert.ok(calls.includes('detach'));
    assert.equal(listeners.size, 0);
  }
});

test('failed cleanup releases the connection instead of retaining focus emulation', async () => {
  send = async (method, params) => {
    if (method === 'Emulation.setFocusEmulationEnabled' && !params.enabled) throw new Error('cannot restore');
    return {};
  };
  assert.equal(await withTab({ clientId: 'test' }, { tabId: 4 }, async () => 'sent'), 'sent');
  assert.equal(calls.at(-1), 'detach');
});

test('queued operations share a connection but keep their own permission checks', async () => {
  const order = [];
  const first = withTab({ clientId: 'first' }, { tabId: 4 }, async () => { order.push('first'); return 1; });
  const second = withTab({ clientId: 'second' }, { tabId: 4 }, async () => { order.push('second'); return 2; });
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(calls.filter(method => method === 'attach').length, 1);
  allowed = false;
  await assert.rejects(withTab({ clientId: 'third' }, { tabId: 4 }, async () => assert.fail('denied')), /Chrome/);
});
