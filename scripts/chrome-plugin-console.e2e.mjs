import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { launchExtensionTest } from './lib/chrome-extension-test.mjs';

const source = path.resolve('apps/desktop/src-tauri/resources/chrome-extension');
const executable = process.env.CSW_CHROME_TEST_BROWSER ?? chromium.executablePath();
const extensionId = (await fs.readFile(path.join(source, 'extension-id.txt'), 'utf8')).trim();
const root = path.resolve('.codex-tmp', `chrome-console-${Date.now()}`);
const extension = path.join(root, 'extension');
const profile = path.join(root, 'profile');
await fs.mkdir(profile, { recursive: true });
await fs.cp(source, extension, { recursive: true });
await fs.writeFile(path.join(extension, 'background.js'), `
import { execute } from './operations.js';
import { initializePermissions } from './permissions.js';
const ready = initializePermissions();
globalThis.run = async (operation, args) => { await ready; return execute({clientId:'fixture'}, {operation,args}); };
chrome.runtime.onInstalled.addListener(()=>{});
`);
const content = await fs.readFile('scripts/fixtures/chrome-plugin-console.html');
const fixtureScript = `
const marker = location.pathname;
console.log('loaded', marker, 42, undefined, NaN, { fixture: true });
console.debug('debug', marker);
console.info('info', marker);
console.warn('warning', marker);
console.error('error', marker);
console.assert(false, 'assertion', marker);
setTimeout(() => { throw new Error('uncaught ' + marker); }, 0);
Promise.reject(new Error('rejected ' + marker));
document.querySelector('#emit').onclick = () => console.log('clicked', marker);
document.querySelector('#clear').onclick = () => { console.clear(); console.log('after-clear', marker); };
if (marker === '/main') {
  for (const url of ['/local', location.href.replace('127.0.0.1', 'localhost').replace('/main', '/remote')]) {
    const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame);
  }
}
`;
const server = http.createServer((request, response) => {
  const script = request.url === '/console-fixture.js';
  response.writeHead(200, { 'Content-Type': script ? 'application/javascript' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store' });
  response.end(script ? fixtureScript : content);
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/main`;
let browser;

async function waitForLoad(tabId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await browser.evaluate(`chrome.tabs.get(${tabId})`)).status === 'complete') {
      await delay(100);
      return;
    }
    await delay(100);
  }
  throw new Error('Fixture did not load');
}

function checkEntries(result, marker) {
  assert.ok(result.entries.some(entry => entry.text.includes(`loaded ${marker} 42 undefined NaN`)));
  for (const level of ['debug', 'info', 'warn', 'error']) {
    assert.ok(result.entries.some(entry => entry.level === level), `Missing ${level} in ${marker}`);
  }
  for (const text of [`uncaught ${marker}`, `rejected ${marker}`]) {
    assert.ok(result.entries.some(entry => entry.type === 'exception' && entry.text.includes(text)), `Missing ${text}`);
  }
  assert.ok(result.entries.every(entry => entry.text.includes(marker)));
  const loaded = result.entries.find(entry => entry.text.startsWith('loaded'));
  assert.ok(loaded.url.endsWith('/console-fixture.js'));
  assert.ok(loaded.line > 0 && loaded.column > 0 && loaded.timestamp > 0);
}

async function checkConsole(window) {
  const { tabId } = await browser.evaluate(`run('open',${JSON.stringify({ url })})`);
  await waitForLoad(tabId);
  const run = (operation, args = {}) => browser.evaluate(
    `run(${JSON.stringify(operation)},${JSON.stringify({ tabId, ...args })})`);
  const beforeWindow = await browser.evaluate(`chrome.windows.get(${window.id})`);
  const beforeTabs = await browser.evaluate(`chrome.tabs.query({active:true,windowId:${window.id}})`);
  const first = await run('console_logs');
  checkEntries(first, '/main');
  assert.deepEqual((await run('console_logs')).entries, first.entries, 'Reading must not clear retained messages');
  const errors = await run('console_logs', { level: 'error', limit: 2 });
  assert.equal(errors.entries.length, 2);
  assert.equal(errors.truncated, true);
  assert.ok(errors.entries.every(entry => entry.level === 'error'));
  const { frames } = await run('frames');
  for (const marker of ['/local', '/remote']) {
    const frame = frames.find(item => item.url.endsWith(marker));
    assert.ok(frame, `Missing ${marker} frame`);
    checkEntries(await run('console_logs', { frameId: frame.frameId }), marker);
  }
  await checkActions(run);
  const afterWindow = await browser.evaluate(`chrome.windows.get(${window.id})`);
  assert.equal(afterWindow.state, beforeWindow.state);
  assert.equal(afterWindow.focused, beforeWindow.focused);
  const afterTabs = await browser.evaluate(`chrome.tabs.query({active:true,windowId:${window.id}})`);
  assert.equal(afterTabs[0].id, beforeTabs[0].id);
  await run('navigate', { url: url.replace('/main', '/next') });
  await waitForLoad(tabId);
  checkEntries(await run('console_logs'), '/next');
  await run('close');
}

async function checkActions(run) {
  const click = async name => {
    const snapshot = await run('snapshot');
    const line = snapshot.text.split('\n').find(line => line.includes(`button "${name}"`));
    assert.ok(line, `Missing ${name}`);
    await run('click', { ref: line.match(/^\[([^\]]+)\]/)[1] });
  };
  await click('Emit log');
  assert.ok((await run('console_logs')).entries.some(entry => entry.text === 'clicked /main'));
  await click('Clear logs');
  const cleared = await run('console_logs');
  assert.ok(cleared.entries.some(entry => entry.text === 'after-clear /main'));
  assert.ok(!cleared.entries.some(entry => entry.text.startsWith('loaded')));
}

try {
  browser = await launchExtensionTest({ executable, extension, profile, extensionId });
  const window = await browser.evaluate('chrome.windows.create({url:"about:blank",focused:false,state:"minimized"})');
  await checkConsole(window);
  console.log('Passed retained console logs, exceptions, frames, filters, clear/navigation and background state.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
