import { authorize, assertRunning } from './permissions.js';
import { website } from './validation.js';

const queues = new Map();
const attached = new Set();
const MAX_LIST_WORKERS = 100;
const MAX_WORKER_URL = 2000;
const MAX_WORKER_TITLE = 200;

export function workerWebsite(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('无法确认这个 Worker 所属的网站，请重新查看可用的 Worker。'); }
  return website(url.protocol === 'blob:' ? url.origin : value).href;
}

function isWebsiteWorker(target) {
  if (target.type !== 'worker') return false;
  try { workerWebsite(target.url); return true; }
  catch { return false; }
}

export async function listWorkers() {
  const targets = (await chrome.debugger.getTargets()).filter(isWebsiteWorker);
  const workers = targets.slice(0, MAX_LIST_WORKERS).map(target => ({
    workerId: target.id, url: target.url.slice(0, MAX_WORKER_URL),
    title: (target.title ?? '').slice(0, MAX_WORKER_TITLE),
    truncated: target.url.length > MAX_WORKER_URL || (target.title ?? '').length > MAX_WORKER_TITLE,
  }));
  return { workers, scope: 'profile',
    truncated: targets.length > MAX_LIST_WORKERS || workers.some(item => item.truncated) };
}

export async function withWorker(context, args, operation) {
  const previous = queues.get(args.workerId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => run(context, args.workerId, operation));
  queues.set(args.workerId, current);
  try { return await current; }
  finally { if (queues.get(args.workerId) === current) queues.delete(args.workerId); }
}

async function findWorker(context, workerId) {
  assertRunning(context.signal);
  const worker = (await chrome.debugger.getTargets()).find(target => target.id === workerId && isWebsiteWorker(target));
  if (!worker) throw new Error('这个 Worker 已停止，请重新查看可用的 Worker。');
  await authorize(workerWebsite(worker.url), context.clientId, context.signal);
  return worker;
}

async function run(context, workerId, operation) {
  const worker = await findWorker(context, workerId);
  const workerUrl = worker.url;
  const target = { targetId: workerId };
  const guard = async () => {
    const current = await findWorker(context, workerId);
    if (current.url !== workerUrl) throw new Error('这个 Worker 已变化，请重新读取日志。');
  };
  try { await chrome.debugger.attach(target, '1.3'); }
  catch { throw new Error('无法连接这个 Worker，请关闭其开发者工具后重试。'); }
  attached.add(workerId);
  // Cancellation must release a debugger command awaiting a worker that is shutting down.
  const abort = () => { void chrome.debugger.detach(target).catch(() => {}); };
  context.signal?.addEventListener('abort', abort, { once: true });
  try {
    await guard();
    const result = await operation({ target, guard, worker: { targetId: workerId, url: workerUrl, type: 'worker' } });
    await guard();
    return result;
  } finally {
    context.signal?.removeEventListener('abort', abort);
    attached.delete(workerId);
    // Chrome may already have detached a terminated worker or a cancelled request.
    await chrome.debugger.detach(target).catch(() => {});
  }
}

export async function stopWorkers() {
  // Worker termination can race pause/revoke cleanup.
  await Promise.all([...attached].map(targetId => chrome.debugger.detach({ targetId }).catch(() => {})));
  attached.clear();
}
