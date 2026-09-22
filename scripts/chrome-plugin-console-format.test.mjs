import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consoleEntry, browserLogEntry } from '../apps/desktop/src-tauri/resources/chrome-extension/console-format.js';
import { createLogBuffer } from '../apps/desktop/src-tauri/resources/chrome-extension/console-buffer.js';
import { validate } from '../apps/desktop/src-tauri/resources/chrome-extension/validation.js';
import { createObjectReader } from '../apps/desktop/src-tauri/resources/chrome-extension/console-objects.js';

const entry = (args, stackTrace) => consoleEntry('Runtime.consoleAPICalled',
  { type: 'log', timestamp: 100, args, stackTrace });
const property = (name, value, type = 'string') => ({ name, type, value });
const preview = (properties, extra = {}) => ({ type: 'object', description: 'Object', properties, ...extra });
const frame = (functionName, lineNumber = 0) =>
  ({ functionName, url: 'https://fixture.example/app.js', lineNumber, columnNumber: 2 });

test('shows bounded object previews, including arrays and maps, without expanding accessors', () => {
  const result = entry([{ type: 'object', description: 'Object', preview: preview([
    property('status', 'failed'), property('attempts', '2', 'number'), property('secret', undefined, 'accessor'),
    { name: 'items', valuePreview: preview([property('0', 'hello')], { description: 'Array(1)', subtype: 'array' }) },
  ]) }, { type: 'object', preview: preview([], { description: 'Map(1)', entries: [
    { key: { type: 'string', description: 'key' }, value: preview([property('ok', 'true', 'boolean')]) },
  ] }) }]);
  assert.match(result.text, /status: "failed", attempts: 2, secret: <getter>/);
  assert.match(result.text, /items: Array\(1\) \{0: "hello"\}/);
  assert.match(result.text, /Map\(1\) \{key => Object \{ok: true\}\}/);
  assert.equal(result.truncated, false);
});

test('falls back to descriptions and bounds preview count, nesting and text', () => {
  assert.equal(entry([{ type: 'object', description: 'HTMLElement' }]).text, 'HTMLElement');
  for (const object of [
    preview([property('value', 'x')], { overflow: true }),
    preview(Array.from({ length: 100 }, (_, index) => property(String(index), 'x'))),
    preview([property('value', '汉'.repeat(20000))]),
    preview([{ name: 'nested', valuePreview: preview([{ name: 'deep', valuePreview: preview([]) }]) }]),
    preview([], { entries: Array.from({ length: 100 }, () => ({ value: preview([]) })) }),
  ]) {
    const result = entry([{ type: 'object', preview: object }]);
    assert.equal(result.truncated, true);
    assert.ok(result.text.length <= 4001);
  }
});

test('retains inline async stack parents with labels and one-based locations', () => {
  const result = entry([{ value: 'failed' }], { callFrames: [frame('submit')], parent: {
    description: 'setTimeout', callFrames: [frame('schedule', 4)], parent: {
      description: 'await', callFrames: [frame('load', 9)],
    },
  } });
  assert.deepEqual(result.stack.map(item => item.functionName), ['submit', 'schedule', 'load']);
  assert.equal(result.stack[0].asynchronous, undefined);
  assert.equal(result.stack[1].asyncDescription, 'setTimeout');
  assert.equal(result.stack[1].asynchronous, true);
  assert.equal(result.stack[1].line, 5);
  assert.equal(result.stack[2].asyncDescription, 'await');
  assert.equal(result.truncated, false);
});

test('reports unavailable async parents and caps deep or empty stack chains', () => {
  for (const callFrames of [[], [frame('recursive')]]) {
    let trace = { callFrames };
    for (let index = 0; index < 100; index++) trace = { callFrames, parent: trace };
    const result = entry([{ value: 'deep' }], trace);
    assert.equal(result.truncated, true);
    assert.ok(result.stack.length <= 8);
  }
  assert.equal(entry([], { callFrames: [], parentId: { id: 'unavailable' } }).truncated, true);
});

test('browser diagnostics preserve categories, severity and source locations', () => {
  const result = browserLogEntry({ source: 'security', level: 'warning', text: 'Blocked by policy',
    timestamp: 123, url: 'https://fixture.example/app.js', lineNumber: 4 });
  assert.equal(result.source, 'browser');
  assert.equal(result.type, 'security');
  assert.equal(result.level, 'warn');
  assert.equal(result.line, 5);
  assert.equal(result.scope, 'renderer');
  assert.equal(browserLogEntry({ source: 'network' }).source, 'network');
});

test('filters by inclusive timestamp and message or URL before the count and size limits', () => {
  const buffer = createLogBuffer({ since: 100, text: 'wanted', limit: 2 });
  const add = (timestamp, text, extra = {}) => buffer.add({ timestamp, text, truncated: false, ...extra });
  add(99, 'wanted old');
  add(100, 'wanted boundary');
  add(101, 'request failed', { url: 'https://fixture.example/wanted' });
  add(102, 'unrelated'.repeat(20000));
  add(103, 'WANTED different case');
  add(undefined, 'wanted but no timestamp');
  assert.deepEqual(buffer.result().entries.map(item => item.timestamp), [100, 101]);
  assert.equal(buffer.result().truncated, false);
  add(104, 'wanted new');
  assert.deepEqual(buffer.result().entries.map(item => item.timestamp), [101, 104]);
  assert.equal(buffer.result().truncated, true);
});

test('validates diagnostic source and filter inputs at the extension boundary', () => {
  const request = args => ({ operation: 'console_logs', args: { tabId: 4, ...args } });
  for (const since of [-1, NaN, Infinity, '100', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validate(request({ since })));
  }
  for (const text of ['', 'x'.repeat(501), null, 123, []]) assert.throws(() => validate(request({ text })));
  assert.equal(validate(request({ since: 100.5, text: 'Failed', source: 'browser' })).operation, 'console_logs');
});

test('descriptor reads are cached and bounded, with accessors represented without invocation', async () => {
  const calls = [];
  const read = createObjectReader(async (method, params) => {
    calls.push({ method, params });
    return { result: [
      { name: 'status', enumerable: true, value: { type: 'string', value: 'failed' } },
      { name: 'computed', enumerable: true, get: { type: 'function', objectId: 'getter' } },
    ] };
  });
  const object = { type: 'object', objectId: 'object', description: 'Object' };
  const result = entry([await read(object)]);
  assert.match(result.text, /status: "failed", computed: <getter>/);
  assert.equal(result.objectPreviewTiming, 'read');
  await read(object);
  assert.equal(calls.length, 1);
  for (let index = 0; index < 30; index++) await read({ ...object, objectId: String(index) });
  assert.equal(calls.length, 20);
  assert.equal(entry([await read({ ...object, objectId: 'overflow' })]).truncated, true);
  assert.ok(calls.every(call => call.method === 'Runtime.getProperties' && call.params.ownProperties === true));
});

test('large arrays omit index expansion and expired object handles retain a marked description', async () => {
  const array = { type: 'object', subtype: 'array', objectId: 'array', description: 'Array(100000)' };
  const read = createObjectReader(async (_method, params) => {
    assert.equal(params.nonIndexedPropertiesOnly, true);
    return { result: [{ name: 'length', value: { type: 'number', value: 100000 } }] };
  });
  const result = entry([await read(array)]);
  assert.equal(result.truncated, true);
  assert.match(result.text, /length: 100000/);
  const unavailable = createObjectReader(async () => { throw new Error('object collected'); });
  const fallback = entry([await unavailable(array)]);
  assert.equal(fallback.text, 'Array(100000)');
  assert.equal(fallback.truncated, true);
});
