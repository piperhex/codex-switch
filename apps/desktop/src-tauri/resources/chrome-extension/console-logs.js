import { documentFrame } from './snapshot.js';
import { consoleEntry } from './console-format.js';

const DEFAULT_LIMIT = 100;
// JSON escaping and UTF-8 encoding must still fit Chrome's 1 MiB native-message limit.
const MAX_RESULT_CHARACTERS = 100000;

export async function consoleLogs(driver, args) {
  const frame = await documentFrame(driver, args.frameId);
  const collector = createCollector(frame.id, args);
  const dispose = driver.listen(frame.id, collector.onEvent);
  try {
    // Runtime.enable replays Chrome's retained console messages and exceptions after reporting contexts.
    await driver.send('Runtime.enable', {}, frame.id);
    const current = await documentFrame(driver, frame.id);
    if (current.loaderId !== frame.loaderId || collector.contextChanged()) {
      throw new Error('页面已变化，请重新读取日志。');
    }
    return { tabId: driver.tab.id, frameId: frame.id, ...collector.result() };
  } finally {
    // withTab detaches the debugger even if enabling Runtime or the permission check fails.
    dispose();
  }
}

function createCollector(frameId, args) {
  const state = { contexts: new Set(), entries: [], size: 0, truncated: false, changed: false,
    limit: args.limit ?? DEFAULT_LIMIT, level: args.level ?? 'all' };
  return {
    onEvent: (method, params) => collect(state, { method, params, frameId }),
    contextChanged: () => state.changed,
    result: () => ({ entries: state.entries.map(item => item.entry), truncated: state.truncated }),
  };
}

function updateContexts(state, { method, params, frameId }) {
  if (method === 'Runtime.executionContextCreated') {
    const { id, auxData } = params.context;
    // Ignore extension isolated worlds and other frames sharing this renderer/session.
    if (auxData?.frameId === frameId && auxData.isDefault === true) state.contexts.add(id);
  }
  if (method === 'Runtime.executionContextDestroyed') {
    if (state.contexts.delete(params.executionContextId)) state.changed = true;
  }
  if (method === 'Runtime.executionContextsCleared') {
    if (state.contexts.size) state.changed = true;
    state.contexts.clear();
  }
}

function collect(state, event) {
  updateContexts(state, event);
  const { method, params } = event;
  if (!['Runtime.exceptionThrown', 'Runtime.consoleAPICalled'].includes(method)) return;
  const details = method === 'Runtime.exceptionThrown' ? params.exceptionDetails : params;
  if (!state.contexts.has(details.executionContextId)) return;
  const entry = consoleEntry(method, params);
  if (!entry || (state.level !== 'all' && entry.level !== state.level)) return;
  append(state, entry);
}

function append(state, entry) {
  const size = JSON.stringify(entry).length + 1;
  state.entries.push({ entry, size });
  state.size += size;
  state.truncated ||= entry.truncated;
  while (state.entries.length > state.limit || state.size > MAX_RESULT_CHARACTERS) {
    state.size -= state.entries.shift().size;
    state.truncated = true;
  }
}
