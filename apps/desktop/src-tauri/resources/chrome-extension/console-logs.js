import { documentFrame } from './snapshot.js';
import { createLogBuffer } from './console-buffer.js';
import { runtimeCollector, browserCollector } from './console-runtime.js';
import { browserLogEntry } from './console-format.js';
import { relatedWorkers } from './console-workers.js';
import { rendererScope, verifyRendererScope } from './console-scope.js';
import { readWorkerLogs } from './console-target.js';
import { authorize } from './permissions.js';
import { workerWebsite } from './worker-driver.js';

export async function consoleLogs(driver, args) {
  const frame = await documentFrame(driver, args.frameId);
  const buffer = createLogBuffer(args);
  const runtime = runtimeCollector({ frameId: frame.id, add: buffer.add,
    send: (method, params) => driver.send(method, params, frame.id) });
  const dispose = driver.listen(frame.id, runtime.onEvent);
  try {
    if (!args.source || ['all', 'page'].includes(args.source)) await driver.send('Runtime.enable', {}, frame.id);
    const extra = args.source === 'page' ? {} : await diagnostics(driver, { frameId: frame.id, args, add: buffer.add });
    await runtime.flush();
    const current = await documentFrame(driver, frame.id);
    if (current.loaderId !== frame.loaderId || runtime.contextChanged()) {
      throw new Error('页面已变化，请重新读取日志。');
    }
    const result = buffer.result();
    return { tabId: driver.tab.id, frameId: frame.id, ...result, ...extra,
      truncated: result.truncated || Boolean(extra.workersTruncated || extra.forwardedTruncated) };
  } finally { dispose(); }
}

async function diagnostics(driver, { frameId, args, add }) {
  const scope = await rendererScope(driver, frameId);
  const workers = relatedWorkers(driver, frameId);
  const forwarded = createLogBuffer({ ...args, source: 'worker' });
  const browser = browserCollector(add);
  const dispose = driver.listen(frameId, (method, params) => {
    browser(method, params);
    if (method === 'Log.entryAdded' && params.entry.source === 'worker') forwarded.add(browserLogEntry(params.entry));
  });
  try {
    await workers.initialize();
    await driver.send('Log.enable', {}, frameId);
    const { readIds, ...status } = await workers.read({ ...args, add });
    const unattributedWorkerMessages = ['network', 'browser'].includes(args.source) ? 0
      : await addForwarded(driver, { entries: forwarded.result().entries, readIds, add });
    await verifyRendererScope(driver, scope, frameId);
    return { ...status, unattributedWorkerMessages, forwardedTruncated: forwarded.result().truncated,
      rendererFrameIds: scope.map(frame => frame.id) };
  } finally { dispose(); workers.dispose(); }
}

async function addForwarded(driver, { entries, readIds, add }) {
  let unattributed = 0;
  for (const entry of entries) {
    if (readIds.has(entry.workerId)) continue;
    // A terminated dedicated worker can retain forwarded messages in the owning renderer.
    let url;
    try { url = workerWebsite(entry.url); }
    catch { unattributed++; continue; }
    await authorize(url, driver.context.clientId, driver.context.signal);
    add(entry);
  }
  return unattributed;
}

export async function standaloneWorkerLogs(connection, args) {
  const buffer = createLogBuffer(args);
  await readWorkerLogs(connection, { source: args.source, add: buffer.add });
  return { workerId: connection.worker.targetId, ...buffer.result() };
}
