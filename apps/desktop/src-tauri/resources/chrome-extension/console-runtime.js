import { consoleEntry, browserLogEntry } from './console-format.js';

export function runtimeCollector({ frameId, worker, add }) {
  const contexts = new Set();
  let changed = false;
  function onEvent(method, params) {
    if (method === 'Runtime.executionContextCreated') {
      const { id, auxData } = params.context;
      const matches = worker ? !auxData?.frameId : auxData?.frameId === frameId && auxData.isDefault === true;
      if (matches) contexts.add(id);
    }
    if (method === 'Runtime.executionContextDestroyed' && contexts.delete(params.executionContextId)) changed = true;
    if (method === 'Runtime.executionContextsCleared') {
      changed ||= contexts.size > 0;
      contexts.clear();
    }
    if (!['Runtime.exceptionThrown', 'Runtime.consoleAPICalled'].includes(method)) return;
    const details = method === 'Runtime.exceptionThrown' ? params.exceptionDetails : params;
    if (contexts.has(details.executionContextId)) add(consoleEntry(method, params, worker));
  }
  return { onEvent, contextChanged: () => changed };
}

export function networkCollector(add, worker) {
  return (method, params) => {
    if (method === 'Log.entryAdded' && params.entry.source === 'network') {
      add(browserLogEntry(params.entry, worker));
    }
  };
}
