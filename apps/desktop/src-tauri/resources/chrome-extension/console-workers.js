import { authorize } from './permissions.js';
import { workerWebsite } from './worker-driver.js';
import { listenTarget, readWorkerLogs } from './console-target.js';
import { createLogBuffer } from './console-buffer.js';

const MAX_WORKERS = 32;
const WORKER_TYPES = new Set(['worker', 'shared_worker', 'service_worker']);
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
  filter: [{ type: 'iframe' }, ...[...WORKER_TYPES].map(type => ({ type }))] };

export function relatedWorkers(driver, frameId) {
  const root = driver.debuggee(frameId);
  const state = { driver, workers: new Map(), pending: new Set(), disposers: [],
    error: null, truncated: false, disposed: false };
  state.disposers.push(listenTarget(root, (method, params) => onEvent(state, root, method, params)));
  return {
    initialize: async () => { await driver.guard(); await attach(state, root); await settle(state); },
    read: (options) => read(state, options),
    dispose: () => { state.disposed = true; state.disposers.forEach(dispose => dispose()); },
  };
}

function onEvent(state, parent, method, params) {
  if (method === 'Target.detachedFromTarget') {
    const worker = state.workers.get(params.sessionId);
    if (worker) worker.active = false;
  }
  if (method !== 'Target.attachedToTarget' || !WORKER_TYPES.has(params.targetInfo.type)) return;
  if (state.workers.has(params.sessionId)) return;
  if (state.workers.size >= MAX_WORKERS) { state.truncated = true; return; }
  const target = { ...parent, sessionId: params.sessionId };
  const record = { target, info: params.targetInfo, active: true };
  state.workers.set(params.sessionId, record);
  state.disposers.push(listenTarget(target, (method, params) => onEvent(state, target, method, params)));
  const task = attach(state, target).catch(error => { if (record.active) state.error = error; })
    .finally(() => state.pending.delete(task));
  state.pending.add(task);
}

async function attach(state, target) {
  await state.driver.guard();
  if (state.disposed) return;
  await chrome.debugger.sendCommand(target, 'Target.setAutoAttach', AUTO_ATTACH);
}

async function settle(state) {
  while (state.pending.size) await Promise.all([...state.pending]);
  if (state.error) throw state.error;
}

async function read(state, options) {
  const readIds = new Set();
  let unavailableWorkers = 0;
  await settle(state);
  for (const record of state.workers.values()) {
    if (!record.active) { unavailableWorkers++; continue; }
    let url;
    try { url = workerWebsite(record.info.url); }
    catch { unavailableWorkers++; continue; }
    const guard = async () => {
      await state.driver.guard();
      const { clientId, signal } = state.driver.context;
      await authorize(url, clientId, signal);
    };
    await guard();
    const buffer = createLogBuffer(options);
    try {
      await readWorkerLogs({ target: record.target, worker: record.info, guard }, { ...options, add: buffer.add });
      const result = buffer.result();
      result.entries.forEach(options.add);
      state.truncated ||= result.truncated;
      readIds.add(record.info.targetId);
    } catch (error) {
      await state.driver.guard();
      if (record.active) throw error;
      unavailableWorkers++;
    }
    await settle(state);
  }
  return { readIds, unavailableWorkers, workersTruncated: state.truncated };
}
