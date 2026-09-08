import { authorize, assertRunning } from './permissions.js';
import { createFrameSessions } from './frame-sessions.js';

const queues = new Map();
const attached = new Set();

export async function withTab(context, args, operation) {
  const previous = queues.get(args.tabId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => run(context, args, operation));
  queues.set(args.tabId, current);
  try { return await current; }
  finally { if (queues.get(args.tabId) === current) queues.delete(args.tabId); }
}

async function run(context, args, operation) {
  const tab = await chrome.tabs.get(args.tabId);
  await authorize(tab.url, context.clientId, context.signal);
  const target = { tabId: tab.id };
  try { await chrome.debugger.attach(target, '1.3'); }
  catch { throw new Error('无法连接这个标签页。请关闭其开发者工具或其他浏览器控制工具后重试。'); }
  attached.add(tab.id);
  // Detaching also releases commands held open by a page dialog when the user cancels.
  const abort = () => { void chrome.debugger.detach(target).catch(() => {}); };
  context.signal?.addEventListener('abort', abort, { once: true });
  if (context.signal?.aborted) abort();
  const guard = async () => {
    assertRunning(context.signal);
    const current = await chrome.tabs.get(tab.id);
    await authorize(current.url, context.clientId, context.signal);
  };
  const sessions = createFrameSessions(target, guard);
  try {
    await sessions.initialize();
    const driver = { tab, send: sessions.send, documents: sessions.documents, context, guard };
    return await operation(driver);
  } finally {
    context.signal?.removeEventListener('abort', abort);
    sessions.dispose();
    attached.delete(tab.id);
    // The browser can detach first when the tab closes or the user stops debugging.
    await chrome.debugger.detach(target).catch(() => {});
  }
}

export async function stopDebugging() {
  await Promise.all([...attached].map((tabId) => chrome.debugger.detach({ tabId }).catch(() => {})));
  attached.clear();
}

export async function pageCall(driver, ref, functionDeclaration, args = []) {
  const resolved = await driver.send('DOM.resolveNode', { backendNodeId: ref.nodeId }, ref.frameId);
  const objectId = resolved.object.objectId;
  try {
    const response = await driver.send('Runtime.callFunctionOn', { objectId, functionDeclaration,
      arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true }, ref.frameId);
    if (response.exceptionDetails) throw new Error('页面内容已变化，或该元素不能完成此操作。请重新读取页面。');
    return response.result.value;
  } finally {
    await driver.send('Runtime.releaseObject', { objectId }, ref.frameId).catch(() => {});
  }
}
