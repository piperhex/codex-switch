import { runtimeCollector, browserCollector } from './console-runtime.js';

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
  const runtime = runtimeCollector({ worker, add: options.add, send: async (method, params) => {
    await guard();
    return chrome.debugger.sendCommand(target, method, params);
  } });
  const browser = browserCollector(options.add, worker);
  const includeRuntime = !options.source || ['all', 'worker'].includes(options.source);
  const dispose = listenTarget(target, (method, params) => {
    if (includeRuntime) runtime.onEvent(method, params);
    if (options.source !== 'worker') browser(method, params);
  });
  try {
    await guard();
    if (includeRuntime) await chrome.debugger.sendCommand(target, 'Runtime.enable');
    await guard();
    if (options.source !== 'worker') await chrome.debugger.sendCommand(target, 'Log.enable');
    await runtime.flush();
    await guard();
    if (runtime.contextChanged()) throw new Error('这个 Worker 已变化，请重新读取日志。');
  } finally { dispose(); }
}
