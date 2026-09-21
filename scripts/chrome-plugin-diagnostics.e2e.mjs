import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { launchExtensionTest } from './lib/chrome-extension-test.mjs';

const source = path.resolve('apps/desktop/src-tauri/resources/chrome-extension');
const root = path.resolve('.codex-tmp', `chrome-diagnostics-${Date.now()}`);
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
const script = await fs.readFile('scripts/fixtures/chrome-plugin-diagnostics.js');
const workerScript = `
const owner = new URL(location.href).searchParams.get('owner');
const nested = new URL(location.href).searchParams.has('nested');
console.log((nested ? 'nested ' : 'dedicated ') + owner);
console.warn('worker warning ' + owner);
setTimeout(() => { throw new Error('worker exception ' + owner); }, 0);
Promise.reject(new Error('worker rejection ' + owner));
if (!nested) self.child = new Worker('/worker.js?owner=' + owner + '&nested=1');
postMessage('ready');
`;
const scripts = {
  '/fixture.js': script, '/worker.js': workerScript,
  '/shared.js': `console.log('shared retained');onconnect=e=>{e.ports[0].postMessage('ready');};`,
  '/sw.js': `console.log('service retained');self.addEventListener('install',()=>self.skipWaiting());
    self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));`,
};
const server = http.createServer((request, response) => {
  const route = new URL(request.url, 'http://fixture.test').pathname;
  if (route === '/dropped') { request.socket.destroy(); return; }
  response.setHeader('Cache-Control', 'no-store');
  if (route === '/missing') { response.writeHead(404); response.end('missing'); return; }
  if (route === '/cors') { response.end('no cors header'); return; }
  if (scripts[route]) {
    response.setHeader('Content-Type', 'application/javascript'); response.end(scripts[route]); return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end('<title>Diagnostics</title><p id="ready">Loading</p><button id="stop">Stop workers</button>'
    + '<script src="/fixture.js"></script>');
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const run = (operation, args = {}) => browser.evaluate(`run(${JSON.stringify(operation)},${JSON.stringify(args)})`);

async function assertMinimized(window, stage) {
  const state = await browser.evaluate(`chrome.windows.get(${window.id})`);
  assert.equal(state.state, 'minimized', stage);
}

async function readyTab(pathname) {
  const tab = await run('open', { url: origin + pathname });
  await run('wait', { tabId: tab.tabId, text: 'Ready' });
  return tab.tabId;
}

async function checkNetwork(tabId) {
  const logs = await run('console_logs', { tabId, source: 'network' });
  assert.ok(logs.entries.length > 0);
  assert.ok(logs.entries.every(entry => entry.source === 'network' && entry.scope === 'renderer'));
  for (const route of ['/missing?', '/dropped?', '/cors?']) {
    assert.ok(logs.entries.some(entry => entry.url.includes(route)), `Missing network error ${route}`);
  }
  assert.ok(logs.entries.some(entry => entry.text.includes('404')));
  assert.ok(logs.rendererFrameIds.length >= 2, 'same-process frames share the browser log');
  const page = await run('console_logs', { tabId, source: 'page' });
  assert.deepEqual(page.entries.map(entry => entry.text), ['page /main']);
  assert.ok(page.entries.every(entry => entry.source === 'page'));
}

async function checkWorkers(tabId) {
  const logs = await run('console_logs', { tabId, source: 'worker' });
  const texts = logs.entries.map(entry => entry.text);
  for (const text of ['dedicated /main', 'nested /main', 'blob /main', 'service retained']) {
    assert.ok(texts.includes(text), `Missing ${text}: ${JSON.stringify(logs)}`);
  }
  assert.equal(texts.filter(text => text === 'dedicated /main').length, 1, 'forwarded logs must be deduplicated');
  assert.ok(!texts.some(text => text.includes('/remote') || text.includes('/unrelated')));
  assert.ok(logs.entries.some(entry => entry.type === 'exception' && entry.text.includes('worker exception')));
  assert.ok(logs.entries.some(entry => entry.type === 'exception' && entry.text.includes('worker rejection')));
  assert.ok(logs.entries.every(entry => entry.workerId && entry.source === 'worker'));
  const { frames } = await run('frames', { tabId });
  const remote = frames.find(frame => frame.url.endsWith('/remote'));
  assert.ok(remote);
  const child = await run('console_logs', { tabId, frameId: remote.frameId, source: 'worker' });
  assert.ok(child.entries.some(entry => entry.text === 'dedicated /remote'));
  assert.ok(!child.entries.some(entry => entry.text.includes('/main')));
}

async function checkStandalone() {
  const { workers, scope } = await run('workers');
  assert.equal(scope, 'profile');
  assert.ok(workers.every(worker => !worker.url.startsWith('chrome-extension:')));
  for (const [file, text] of [['/shared.js', 'shared retained'], ['/sw.js', 'service retained']]) {
    const worker = workers.find(worker => worker.url === origin + file);
    assert.ok(worker, `Missing ${file}`);
    const logs = await run('console_logs', { workerId: worker.workerId });
    assert.ok(logs.entries.some(entry => entry.text === text));
    assert.ok(logs.entries.every(entry => entry.workerId === worker.workerId));
  }
}

async function checkLimitsAndShutdown(tabId) {
  const all = await run('console_logs', { tabId });
  assert.ok(['page', 'network', 'worker'].every(source => all.entries.some(entry => entry.source === source)));
  const timestamps = all.entries.map(entry => entry.timestamp);
  assert.deepEqual(timestamps, [...timestamps].sort((a,b)=>a-b));
  const limited = await run('console_logs', { tabId, limit: 2 });
  assert.deepEqual(limited.entries, all.entries.slice(-2));
  assert.equal(limited.truncated, true);
  const snapshot = await run('snapshot', { tabId });
  const line = snapshot.text.split('\n').find(line => line.includes('button "Stop workers"'));
  await run('click', { tabId, ref: line.match(/^\[([^\]]+)\]/)[1] });
  const retained = await run('console_logs', { tabId, source: 'worker' });
  assert.ok(retained.entries.some(entry => entry.text === 'dedicated /main'), 'retain terminated-worker logs');
  await run('navigate', { tabId, url: origin + '/next' });
  try { await run('wait', { tabId, text: 'Ready' }); }
  catch (error) {
    console.log('Navigation diagnostics', JSON.stringify(await run('console_logs', { tabId })));
    console.log('Navigation snapshot', JSON.stringify(await run('snapshot', { tabId })));
    throw error;
  }
  const next = await run('console_logs', { tabId });
  assert.ok(!next.entries.some(entry => entry.text.includes('/main') || entry.url.includes('?/main')));
}

try {
  browser = await launchExtensionTest({ executable: process.env.CSW_CHROME_TEST_BROWSER ?? chromium.executablePath(),
    extension, profile, extensionId: (await fs.readFile(path.join(source, 'extension-id.txt'), 'utf8')).trim() });
  const window = await browser.evaluate('chrome.windows.create({url:"about:blank",focused:false,state:"minimized"})');
  const unrelated = await readyTab('/unrelated');
  const tabId = await readyTab('/main');
  await browser.evaluate(`chrome.windows.update(${window.id},{state:'minimized'})`);
  const selected = await browser.evaluate(`chrome.tabs.query({active:true,windowId:${window.id}})`);
  await checkNetwork(tabId);
  await assertMinimized(window, 'network logs');
  await checkWorkers(tabId);
  await assertMinimized(window, 'related worker logs');
  await checkStandalone();
  await assertMinimized(window, 'standalone worker logs');
  await checkLimitsAndShutdown(tabId);
  assert.equal((await browser.evaluate(`chrome.windows.get(${window.id})`)).state, 'minimized');
  const afterSelected = await browser.evaluate(`chrome.tabs.query({active:true,windowId:${window.id}})`);
  assert.equal(afterSelected[0].id, selected[0].id);
  await run('close', { tabId });
  await run('close', { tabId: unrelated });
  console.log('Passed network, dedicated/nested/blob/shared/service worker logs, isolation, limits and shutdown.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
