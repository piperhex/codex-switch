import { runtimeCollector, networkCollector } from './console-runtime.js';

export function listenTarget(target, listener) {
  const handler = (source, method, params) => {
    if (source.tabId !== target.tabId || source.targetId !== target.targetId) return;
    if (source.sessionId === target.sessionId) listener(method, params);
  };
  chrome.debugger.onEvent.addListener(handler);
  return () => chrome.debugger.onEvent.removeListener(handler);
}

export async function readWorkerLogs(connection, options) {
  const { target, guard, worker } = connection;
  const runtime = runtimeCollector({ worker, add: options.add });
  const network = networkCollector(options.add, worker);
  const dispose = listenTarget(target, (method, params) => {
    if (options.source !== 'network') runtime.onEvent(method, params);
    if (options.source !== 'worker') network(method, params);
  });
  try {
    await guard();
    if (options.source !== 'network') await chrome.debugger.sendCommand(target, 'Runtime.enable');
    await guard();
    if (options.source !== 'worker') await chrome.debugger.sendCommand(target, 'Log.enable');
    await guard();
    if (runtime.contextChanged()) throw new Error('这个 Worker 已变化，请重新读取日志。');
  } finally { dispose(); }
}
