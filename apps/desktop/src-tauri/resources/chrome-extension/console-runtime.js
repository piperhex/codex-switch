import { consoleEntry, browserLogEntry } from './console-format.js';
import { createObjectReader } from './console-objects.js';

export function runtimeCollector({ frameId, worker, add, send }) {
  const contexts = new Set();
  const readObject = createObjectReader(send);
  const pending = new Set();
  let error;
  let changed = false;
  let collecting = true;
  function collect(method, params) {
    if (method === 'Runtime.exceptionThrown') { add(consoleEntry(method, params, worker)); return; }
    const values = (params.args ?? []).map(readObject);
    const task = Promise.all(values).then(args => add(consoleEntry(method, { ...params, args }, worker)))
      .catch(failure => { error ??= failure; }).finally(() => pending.delete(task));
    pending.add(task);
  }
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
    if (collecting && contexts.has(details.executionContextId)) collect(method, params);
  }
  return { onEvent, contextChanged: () => changed, flush: async () => {
    collecting = false;
    await Promise.all([...pending]);
    if (error) throw error;
  } };
}

export function browserCollector(add, worker) {
  return (method, params) => {
    // Worker console forwarding is merged separately to avoid duplicates and authorize its origin.
    if (method === 'Log.entryAdded' && params.entry.source !== 'worker') {
      add(browserLogEntry(params.entry, worker));
    }
  };
}
