import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { execute } from '../apps/desktop/src-tauri/resources/chrome-extension/operations.js';
import { validate } from '../apps/desktop/src-tauri/resources/chrome-extension/validation.js';
import { initializePermissions } from '../apps/desktop/src-tauri/resources/chrome-extension/permissions.js';

let listeners;
let calls;
let replay;
let allowed;
let documentsRead;
let changeDocument;
const MAIN = { id: 'main', url: 'https://fixture.example/', loaderId: 'document-1' };
const CHILD = { id: 'child', url: 'https://child.example/', loaderId: 'document-2' };
const LOCAL = { id: 'local', url: 'https://fixture.example/child', loaderId: 'document-3' };
const context = (id, frameId, isDefault = true) => ['Runtime.executionContextCreated',
  { context: { id, auxData: { frameId, isDefault } } }];
const log = (text, type = 'log', executionContextId = 1, timestamp = 100) => ['Runtime.consoleAPICalled',
  { type, executionContextId, timestamp, args: [{ type: 'string', value: text }],
    stackTrace: { callFrames: [{ functionName: 'submit', url: MAIN.url, lineNumber: 4, columnNumber: 8 }] } }];
const emit = (source, event) => listeners.forEach(listener => listener(source, ...event));
const read = (args = {}, signal) => execute({ clientId: 'fixture', signal },
  { operation: 'console_logs', args: { tabId: 4, ...args } });

beforeEach(async () => {
  listeners = new Set();
  calls = [];
  allowed = true;
  documentsRead = 0;
  changeDocument = false;
  replay = async target => {
    emit(target, context(1, target.sessionId ? 'child' : 'main'));
    emit(target, log('hello'));
  };
  globalThis.chrome = {
    permissions: { contains: async () => allowed },
    storage: { local: { get: async () => ({ paused: false, siteAccessMode: 'all' }) },
      session: { get: async () => ({}), set: async () => {} } },
    tabs: { get: async () => ({ id: 4, active: false, url: MAIN.url }) },
    scripting: { executeScript: async () => {} },
    debugger: {
      attach: async () => calls.push({ method: 'attach' }),
      detach: async () => calls.push({ method: 'detach' }),
      onEvent: { addListener: listener => listeners.add(listener),
        removeListener: listener => listeners.delete(listener) },
      sendCommand: async (target, method) => {
        calls.push({ target, method });
        if (method === 'Page.getLayoutMetrics') return { cssLayoutViewport: { clientWidth: 1280, clientHeight: 720 } };
        if (method === 'Target.setAutoAttach' && !target.sessionId) {
          emit(target, ['Target.attachedToTarget',
            { sessionId: 'remote', targetInfo: { targetId: 'child', type: 'iframe' } }]);
        }
        if (method === 'Page.getFrameTree') {
          documentsRead++;
          const frame = target.sessionId ? CHILD : MAIN;
          return { frameTree: { frame: changeDocument && documentsRead > 2 ? { ...frame, loaderId: 'new' } : frame,
            childFrames: target.sessionId ? [] : [{ frame: LOCAL }] } };
        }
        if (method === 'Runtime.enable') await replay(target);
        return {};
      },
    },
  };
  await initializePermissions();
});

test('reads retained console messages and exceptions, formats values and one-based locations', async () => {
  replay = async target => {
    emit(target, context(1, 'main'));
    const event = log('hello', 'warning');
    event[1].args.push({ type: 'number', value: 42 }, { type: 'undefined' },
      { type: 'number', unserializableValue: 'NaN' }, { type: 'object', description: 'Object' });
    emit(target, event);
    emit(target, ['Runtime.exceptionThrown', { timestamp: 101, exceptionDetails: {
      executionContextId: 1, text: 'Uncaught', exception: { description: 'Error: failed' },
      url: MAIN.url, lineNumber: 9, columnNumber: 0,
    } }]);
  };
  const result = await read();
  assert.equal(result.frameId, 'main');
  assert.equal(result.truncated, false);
  assert.equal(result.entries[0].text, 'hello 42 undefined NaN Object');
  assert.equal(result.entries[0].level, 'warn');
  assert.equal(result.entries[0].timestamp, 100);
  assert.deepEqual(result.entries[0].stack, [{ url: MAIN.url, line: 5, column: 9, functionName: 'submit' }]);
  assert.equal(result.entries[1].type, 'exception');
  assert.equal(result.entries[1].level, 'error');
  assert.equal(result.entries[1].text, 'Error: failed');
  assert.equal(result.entries[1].line, 10);
  assert.equal(listeners.size, 0);
  assert.equal(calls.at(-1).method, 'detach');
  assert.ok(!calls.some(call => ['Runtime.discardConsoleEntries', 'Runtime.callFunctionOn'].includes(call.method)));
});

test('filters levels before keeping the newest entries, with empty reads supported', async () => {
  replay = async target => {
    emit(target, context(1, 'main'));
    for (const event of [log('old', 'error'), log('assertion', 'assert'), log('new', 'error'), log('info', 'info')]) {
      emit(target, event);
    }
  };
  const result = await read({ level: 'error', limit: 2 });
  assert.deepEqual(result.entries.map(entry => entry.text), ['assertion', 'new']);
  assert.equal(result.truncated, true);
  assert.deepEqual((await read({ level: 'debug' })).entries, []);
});

test('isolates the requested frame, target session, tab and default page world', async () => {
  replay = async target => {
    for (const event of [context(1, 'main'), context(2, 'local'), context(3, 'main', false),
      log('main'), log('local', 'log', 2), log('extension', 'log', 3), log('unknown', 'log', 99)]) emit(target, event);
    emit({ tabId: 999 }, log('other tab'));
    emit({ ...target, sessionId: 'unrelated' }, log('other session'));
  };
  assert.deepEqual((await read()).entries.map(entry => entry.text), ['main']);
  assert.deepEqual((await read({ frameId: 'local' })).entries.map(entry => entry.text), ['local']);
  replay = async target => {
    assert.equal(target.sessionId, 'remote');
    emit(target, context(1, 'child'));
    emit(target, log('cross-origin'));
    emit({ tabId: 4 }, log('parent'));
  };
  assert.deepEqual((await read({ frameId: 'child' })).entries.map(entry => entry.text), ['cross-origin']);
});

test('bounds text, stack, entry count and encoded response size', async () => {
  replay = async target => {
    emit(target, context(1, 'main'));
    for (let index = 0; index < 1000; index++) {
      const event = log(`${index}:` + '汉'.repeat(20000));
      event[1].stackTrace.callFrames = Array.from({ length: 100 }, () => ({
        url: '界'.repeat(2000), functionName: '函'.repeat(1000), lineNumber: 1, columnNumber: 2,
      }));
      emit(target, event);
    }
  };
  const result = await read({ limit: 200 });
  assert.equal(result.truncated, true);
  assert.ok(result.entries.length < 200);
  assert.ok(result.entries.at(-1).text.startsWith('999:'));
  assert.equal(result.entries.at(-1).stack.length, 8);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024 * 1024);
});

test('rejects navigation and always removes event listeners after failures', async () => {
  changeDocument = true;
  await assert.rejects(read(), /页面已变化/);
  assert.equal(listeners.size, 0);
  changeDocument = false;
  replay = async () => { throw new Error('session detached'); };
  await assert.rejects(read(), /session detached/);
  assert.equal(listeners.size, 0);
  assert.equal(calls.at(-1).method, 'detach');
});

test('rejects context replacement even when the frame loader is unchanged', async () => {
  replay = async target => {
    emit(target, context(1, 'main'));
    emit(target, log('before'));
    emit(target, ['Runtime.executionContextDestroyed', { executionContextId: 1 }]);
    emit(target, context(2, 'main'));
    emit(target, log('after', 'log', 2));
  };
  await assert.rejects(read(), /页面已变化/);
  assert.equal(listeners.size, 0);
});

test('website access and cancellation are checked before returning retained logs', async () => {
  allowed = false;
  await assert.rejects(read(), /Chrome/);
  assert.ok(!calls.some(call => call.method === 'Runtime.enable'));
  allowed = true;
  const controller = new AbortController();
  replay = async target => { emit(target, context(1, 'main')); emit(target, log('private')); controller.abort(); };
  await assert.rejects(read({}, controller.signal), /取消/);
  assert.equal(listeners.size, 0);
});

test('requires access to the selected child origin and rejects mid-read permission revocation', async () => {
  chrome.permissions.contains = async ({ origins }) => !origins.some(origin => origin.includes('child.example'));
  await assert.rejects(read({ frameId: 'child' }), /Chrome/);
  assert.ok(!calls.some(call => call.method === 'Runtime.enable'));
  assert.equal(listeners.size, 0);
  chrome.permissions.contains = async () => allowed;
  replay = async target => { emit(target, context(1, 'main')); emit(target, log('private')); allowed = false; };
  await assert.rejects(read(), /Chrome/);
  assert.equal(listeners.size, 0);
});

test('rejects invalid console options before accessing Chrome', () => {
  for (const args of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { limit: '10' }, { limit: null },
    { level: 'verbose' }, { level: null }, { frameId: '' }]) {
    assert.throws(() => validate({ operation: 'console_logs', args: { tabId: 4, ...args } }));
  }
  assert.equal(calls.length, 0);
});
